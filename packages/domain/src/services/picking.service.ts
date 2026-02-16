/**
 * PickingService
 * Orchestrates pick list generation, item confirmation, and bin creation
 *
 * Save to: packages/domain/src/services/picking.service.ts
 */

import { publish, EVENT_TYPES, type FulfillmentEvent } from "@wms/pubsub";
import { randomUUID } from "crypto";
import type { PickingRepository } from "@wms/db";

// =============================================================================
// Types
// =============================================================================

interface PickListResult {
  task: {
    id: string;
    taskNumber: string;
    type: string;
    status: string;
    totalItems: number;
    completedItems: number;
    taskItems: Array<{
      id: string;
      sequence: number;
      status: string;
      quantityRequired: number;
      quantityCompleted: number;
      productVariantId: string | null;
      locationId: string | null;
      orderId: string | null;
    }>;
  };
  order: { id: string; orderNumber: string; status: string };
}

interface ConfirmPickResult {
  taskItem: { id: string; status: string; quantityCompleted: number };
  taskComplete: boolean;
  allItemsPicked: boolean;
}

// =============================================================================
// Event Helpers
// =============================================================================

function createEventPayload(
  type: string,
  orderId: string | undefined,
  payload: Record<string, unknown>,
  opts?: { correlationId?: string; userId?: string },
): FulfillmentEvent {
  return {
    id: randomUUID(),
    type: type as FulfillmentEvent["type"],
    orderId,
    payload,
    correlationId: opts?.correlationId,
    userId: opts?.userId,
    timestamp: new Date().toISOString(),
  };
}

async function emitEvent(event: FulfillmentEvent): Promise<void> {
  const { prisma, Prisma } = await import("@wms/db");
  await prisma.fulfillmentEvent.create({
    data: {
      id: event.id,
      orderId: event.orderId,
      type: event.type,
      payload: event.payload as any,
      correlationId: event.correlationId,
      userId: event.userId,
    },
  });
  try {
    await publish(event);
  } catch (err) {
    console.error("[PickingService] Pub/sub publish failed:", err);
  }
}

function generateTaskNumber(prefix: string, orderNumber: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${orderNumber}-${ts}`;
}

function generateBinBarcode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `BIN-${date}-${random}`;
}

// =============================================================================
// Service
// =============================================================================

export interface PickingServiceDeps {
  pickingRepo: PickingRepository;
}

export class PickingService {
  private repo: PickingRepository;

  constructor(deps: PickingServiceDeps) {
    this.repo = deps.pickingRepo;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generate Pick List
  // ─────────────────────────────────────────────────────────────────────────

  async generatePickList(
    orderId: string,
    userId?: string,
  ): Promise<PickListResult> {
    const order = await this.repo.findOrderWithAllocations(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);

    const validStatuses = [
      "PENDING",
      "CONFIRMED",
      "READY_TO_PICK",
      "ALLOCATED",
    ];
    if (!validStatuses.includes(order.status)) {
      throw new Error(
        `Cannot start picking: order is ${order.status}. Expected one of: ${validStatuses.join(", ")}`,
      );
    }

    if (order.allocations.length === 0) {
      throw new Error(
        `No allocations found for order ${order.orderNumber}. Allocate inventory first.`,
      );
    }

    const existingTask = await this.repo.findActivePickTask(orderId);
    if (existingTask) {
      throw new Error(
        `Active pick task ${existingTask.taskNumber} already exists for this order`,
      );
    }

    // Sort allocations by location pick sequence for optimal path
    const sortedAllocations = [...order.allocations].sort((a, b) => {
      const seqA = a.location?.pickSequence ?? 9999;
      const seqB = b.location?.pickSequence ?? 9999;
      return seqA - seqB;
    });

    const correlationId = randomUUID();
    const taskNumber = generateTaskNumber("PICK", order.orderNumber);

    const task = await this.repo.createPickTask({
      taskNumber,
      orderId,
      priority:
        order.priority === "EXPRESS" ? 2 : order.priority === "RUSH" ? 1 : 0,
      sortedAllocations,
      userId,
      orderNumber: order.orderNumber,
    });

    // Emit events (after transaction commits)
    const picklistItems = task.taskItems.map((ti, idx) => ({
      taskItemId: ti.id,
      sequence: ti.sequence,
      sku: sortedAllocations[idx]?.productVariant?.sku,
      variantName: sortedAllocations[idx]?.productVariant?.name,
      locationName: sortedAllocations[idx]?.location?.name,
      quantity: ti.quantityRequired,
    }));

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.ORDER_PROCESSING,
        orderId,
        { orderNumber: order.orderNumber, taskId: task.id },
        { correlationId, userId },
      ),
    );

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PICKLIST_GENERATED,
        orderId,
        {
          taskId: task.id,
          taskNumber: task.taskNumber,
          items: picklistItems,
          totalItems: task.totalItems,
        },
        { correlationId, userId },
      ),
    );

    return {
      task,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: "PICKING",
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Confirm Pick Item
  // ─────────────────────────────────────────────────────────────────────────

  async confirmPickItem(
    taskItemId: string,
    opts?: {
      quantity?: number;
      locationScanned?: boolean;
      itemScanned?: boolean;
      userId?: string;
    },
  ): Promise<ConfirmPickResult> {
    const taskItem = await this.repo.findTaskItemForPick(taskItemId);
    if (!taskItem) throw new Error(`TaskItem ${taskItemId} not found`);
    if (taskItem.task.type !== "PICKING")
      throw new Error(
        `TaskItem belongs to ${taskItem.task.type} task, not PICKING`,
      );
    if (taskItem.status === "COMPLETED")
      throw new Error(`TaskItem ${taskItemId} already completed`);

    const quantity = opts?.quantity ?? taskItem.quantityRequired;
    const isShort = quantity < taskItem.quantityRequired;
    const correlationId = randomUUID();

    const result = await this.repo.confirmPickItem(taskItemId, {
      quantity,
      isShort,
      userId: opts?.userId,
      locationScanned: opts?.locationScanned ?? false,
      itemScanned: opts?.itemScanned ?? false,
    });

    // Emit events
    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PICKLIST_ITEM_PICKED,
        taskItem.orderId ?? undefined,
        {
          taskId: taskItem.taskId,
          taskItemId,
          sku: taskItem.productVariant?.sku,
          locationName: taskItem.location?.name,
          quantity,
          isShort,
          progress: `${result.completedCount}/${taskItem.task.totalItems}`,
        },
        { correlationId, userId: opts?.userId },
      ),
    );

    if (result.taskComplete) {
      await emitEvent(
        createEventPayload(
          EVENT_TYPES.PICKLIST_COMPLETED,
          taskItem.orderId ?? undefined,
          {
            taskId: taskItem.taskId,
            taskNumber: taskItem.task.taskNumber,
            completedItems: result.completedCount,
            shortItems: result.shortCount,
          },
          { correlationId, userId: opts?.userId },
        ),
      );

      await emitEvent(
        createEventPayload(
          EVENT_TYPES.ORDER_PICKED,
          taskItem.orderId ?? undefined,
          { orderNumber: taskItem.order?.orderNumber },
          { correlationId, userId: opts?.userId },
        ),
      );

      // Create pick bin for staging
      const bin = await this.createPickBin(
        taskItem.orderId!,
        taskItem.taskId,
        opts?.userId,
      );

      await emitEvent(
        createEventPayload(
          EVENT_TYPES.PICKLIST_COMPLETED,
          taskItem.orderId ?? undefined,
          {
            taskId: taskItem.taskId,
            taskNumber: taskItem.task.taskNumber,
            completedItems: result.completedCount,
            shortItems: result.shortCount,
            bin: { id: bin.id, binNumber: bin.binNumber, barcode: bin.barcode },
          },
          { correlationId, userId: opts?.userId },
        ),
      );
    }

    return {
      taskItem: {
        id: taskItemId,
        status: isShort ? "SHORT" : "COMPLETED",
        quantityCompleted: quantity,
      },
      taskComplete: result.taskComplete,
      allItemsPicked: result.taskComplete,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create Pick Bin
  // ─────────────────────────────────────────────────────────────────────────

  async createPickBin(
    orderId: string,
    pickTaskId: string,
    userId?: string,
  ): Promise<{
    id: string;
    binNumber: string;
    barcode: string;
    items: Array<{ sku: string; quantity: number }>;
  }> {
    const pickTask = await this.repo.findPickTaskWithCompletedItems(pickTaskId);
    if (!pickTask) throw new Error(`Pick task ${pickTaskId} not found`);

    const binNumber = await this.repo.generateBinNumber();
    const barcode = generateBinBarcode();

    // Aggregate items by SKU
    const itemMap = new Map<
      string,
      { productVariantId: string; sku: string; quantity: number }
    >();
    for (const ti of pickTask.taskItems) {
      if (!ti.productVariantId || !ti.productVariant) continue;
      const existing = itemMap.get(ti.productVariantId);
      if (existing) {
        existing.quantity += ti.quantityCompleted;
      } else {
        itemMap.set(ti.productVariantId, {
          productVariantId: ti.productVariantId,
          sku: ti.productVariant.sku,
          quantity: ti.quantityCompleted,
        });
      }
    }

    const items = Array.from(itemMap.values());
    const bin = await this.repo.createPickBin({
      binNumber,
      barcode,
      orderId,
      pickTaskId,
      userId,
      items,
    });

    await emitEvent(
      createEventPayload(
        "pickbin:created",
        orderId,
        {
          binId: bin.id,
          binNumber: bin.binNumber,
          barcode: bin.barcode,
          itemCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
        },
        { userId },
      ),
    );

    return bin;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lookup Order by Bin Barcode (for pack station)
  // ─────────────────────────────────────────────────────────────────────────

  async getOrderByBinBarcode(barcode: string): Promise<{
    orderId: string;
    orderNumber: string;
    bin: {
      id: string;
      binNumber: string;
      barcode: string;
      status: string;
      items: Array<{
        id: string;
        sku: string;
        quantity: number;
        verifiedQty: number;
        productVariant: {
          id: string;
          sku: string;
          upc: string | null;
          barcode: string | null;
          name: string;
        };
      }>;
    };
  }> {
    const bin = await this.repo.findPickBinByBarcode(barcode);
    if (!bin) throw new Error(`Bin with barcode "${barcode}" not found`);
    if (bin.status === "COMPLETED")
      throw new Error(`Bin ${bin.binNumber} has already been packed`);
    if (bin.status === "CANCELLED")
      throw new Error(`Bin ${bin.binNumber} was cancelled`);

    if (bin.status === "STAGED") {
      await this.repo.updatePickBinStatus(bin.id, "PACKING");
    }

    return {
      orderId: bin.order.id,
      orderNumber: bin.order.orderNumber,
      bin: {
        id: bin.id,
        binNumber: bin.binNumber,
        barcode: bin.barcode,
        status: bin.status,
        items: bin.items.map((item) => ({
          id: item.id,
          sku: item.sku,
          quantity: item.quantity,
          verifiedQty: item.verifiedQty,
          productVariant: item.productVariant,
        })),
      },
    };
  }
}
