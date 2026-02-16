/**
 * PackingService
 * Orchestrates pack list generation, item verification, and packing completion
 * Supports both direct packing and bin-based packing workflows
 *
 * Save to: packages/domain/src/services/packing.service.ts
 */

import { publish, EVENT_TYPES, type FulfillmentEvent } from "@wms/pubsub";
import { randomUUID } from "crypto";
import type { PackingRepository } from "@wms/db";

// =============================================================================
// Types
// =============================================================================

interface PackListResult {
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
      productVariant: { sku: string; name: string } | null;
    }>;
  };
}

interface VerifyPackResult {
  taskItem: { id: string; status: string };
  allVerified: boolean;
}

interface CompletePackingResult {
  task: { id: string; packedWeight: number | null; packedDimensions: unknown };
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
  const { prisma } = await import("@wms/db");
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
    console.error("[PackingService] Pub/sub publish failed:", err);
  }
}

function generateTaskNumber(prefix: string, orderNumber: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${orderNumber}-${ts}`;
}

// =============================================================================
// Service
// =============================================================================

export interface PackingServiceDeps {
  packingRepo: PackingRepository;
}

export class PackingService {
  private repo: PackingRepository;

  constructor(deps: PackingServiceDeps) {
    this.repo = deps.packingRepo;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generate Pack List (direct packing mode)
  // ─────────────────────────────────────────────────────────────────────────

  async generatePackList(
    orderId: string,
    userId?: string,
  ): Promise<PackListResult> {
    const order = await this.repo.findOrderForPacking(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status !== "PICKED") {
      throw new Error(
        `Cannot start packing: order is ${order.status}, expected PICKED`,
      );
    }

    const existingTask = await this.repo.findActivePackTask(orderId);
    if (existingTask) {
      throw new Error(
        `Active pack task ${existingTask.taskNumber} already exists for this order`,
      );
    }

    const pickTask = await this.repo.findCompletedPickTask(orderId);
    if (!pickTask || pickTask.taskItems.length === 0) {
      throw new Error("No completed pick items found for packing");
    }

    const correlationId = randomUUID();
    const taskNumber = generateTaskNumber("PACK", order.orderNumber);

    const task = await this.repo.createPackTask({
      taskNumber,
      orderId,
      pickItems: pickTask.taskItems,
      userId,
      orderNumber: order.orderNumber,
    });

    // Emit events
    const packItems = task.taskItems.map((ti) => ({
      taskItemId: ti.id,
      sequence: ti.sequence,
      sku: ti.productVariant?.sku,
      variantName: ti.productVariant?.name,
      quantity: ti.quantityRequired,
    }));

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PACKING_STARTED,
        orderId,
        {
          taskId: task.id,
          taskNumber: task.taskNumber,
          items: packItems,
          totalItems: task.totalItems,
          orderNumber: order.orderNumber,
        },
        { correlationId, userId },
      ),
    );

    return { task };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Verify Pack Item (direct packing mode)
  // ─────────────────────────────────────────────────────────────────────────

  async verifyPackItem(
    taskItemId: string,
    opts?: { userId?: string },
  ): Promise<VerifyPackResult> {
    const taskItem = await this.repo.findTaskItemForVerify(taskItemId);
    if (!taskItem) throw new Error(`TaskItem ${taskItemId} not found`);
    if (taskItem.task.type !== "PACKING") {
      throw new Error(
        `TaskItem belongs to ${taskItem.task.type} task, not PACKING`,
      );
    }
    if (taskItem.status === "COMPLETED") {
      return {
        taskItem: { id: taskItemId, status: "COMPLETED" },
        allVerified: false,
      };
    }

    const correlationId = randomUUID();

    const result = await this.repo.verifyPackItem(taskItemId, {
      userId: opts?.userId,
    });

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PACKING_ITEM_VERIFIED,
        taskItem.orderId ?? undefined,
        {
          taskId: taskItem.taskId,
          taskItemId,
          sku: taskItem.productVariant?.sku,
          quantity: taskItem.quantityRequired,
          progress: `${result.completedCount}/${taskItem.task.totalItems}`,
        },
        { correlationId, userId: opts?.userId },
      ),
    );

    return {
      taskItem: { id: taskItemId, status: "COMPLETED" },
      allVerified: result.allVerified,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Complete Packing (direct mode — weight + dimensions)
  // ─────────────────────────────────────────────────────────────────────────

  async completePacking(
    taskId: string,
    data: {
      weight: number;
      weightUnit?: string;
      dimensions?: {
        length: number;
        width: number;
        height: number;
        unit: string;
      };
      userId?: string;
    },
  ): Promise<CompletePackingResult> {
    // Validate task — need to load it to check items
    const { prisma } = await import("@wms/db");
    const task = await prisma.workTask.findUnique({
      where: { id: taskId },
      include: { taskItems: true },
    });

    if (!task) throw new Error(`WorkTask ${taskId} not found`);
    if (task.type !== "PACKING")
      throw new Error(`Task ${taskId} is ${task.type}, not PACKING`);

    const pendingItems = task.taskItems.filter(
      (ti) => ti.status !== "COMPLETED",
    );
    if (pendingItems.length > 0) {
      throw new Error(
        `${pendingItems.length} items still pending verification. Complete all items before finishing packing.`,
      );
    }

    const orderId = task.orderIds[0];
    const correlationId = randomUUID();

    const order = orderId
      ? await prisma.order.findUnique({
          where: { id: orderId },
          select: { orderNumber: true },
        })
      : null;

    await this.repo.completePacking(taskId, {
      weight: data.weight,
      weightUnit: data.weightUnit ?? "ounce",
      dimensions: data.dimensions,
      userId: data.userId,
      orderId: orderId ?? "",
    });

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PACKING_COMPLETED,
        orderId,
        {
          taskId,
          taskNumber: task.taskNumber,
          orderNumber: order?.orderNumber,
          weight: data.weight,
          weightUnit: data.weightUnit ?? "ounce",
          dimensions: data.dimensions,
        },
        { correlationId, userId: data.userId },
      ),
    );

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.ORDER_PACKED,
        orderId,
        { taskId, orderNumber: order?.orderNumber },
        { correlationId, userId: data.userId },
      ),
    );

    return {
      task: {
        id: taskId,
        packedWeight: data.weight,
        packedDimensions: data.dimensions ?? null,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Verify Bin Item (bin packing mode — scan UPC at pack station)
  // ─────────────────────────────────────────────────────────────────────────

  async verifyBinItem(
    binId: string,
    barcode: string,
    userId?: string,
  ): Promise<{
    verified: boolean;
    item: { sku: string; verifiedQty: number; quantity: number };
    allVerified: boolean;
  }> {
    const bin = await this.repo.findPickBinForVerification(binId);
    if (!bin) throw new Error(`Bin ${binId} not found`);

    // Find matching item by UPC, barcode, or SKU
    const matchingItem = bin.items.find((item) => {
      const pv = item.productVariant;
      return (
        pv.upc === barcode ||
        pv.barcode === barcode ||
        pv.sku === barcode ||
        pv.sku.toUpperCase() === barcode.toUpperCase()
      );
    });

    if (!matchingItem)
      throw new Error(`Item with barcode "${barcode}" not in this bin`);

    // Already fully verified?
    if (matchingItem.verifiedQty >= matchingItem.quantity) {
      return {
        verified: false,
        item: {
          sku: matchingItem.sku,
          verifiedQty: matchingItem.verifiedQty,
          quantity: matchingItem.quantity,
        },
        allVerified: bin.items.every((i) => i.verifiedQty >= i.quantity),
      };
    }

    // Increment
    const updated = await this.repo.incrementBinItemVerifiedQty(
      matchingItem.id,
      userId,
    );

    // Check all items
    const allItems = await this.repo.findPickBinItems(binId);
    const allVerified = allItems.every((i) =>
      i.id === matchingItem.id
        ? updated.verifiedQty >= i.quantity
        : i.verifiedQty >= i.quantity,
    );

    return {
      verified: true,
      item: {
        sku: matchingItem.sku,
        verifiedQty: updated.verifiedQty,
        quantity: matchingItem.quantity,
      },
      allVerified,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Complete Bin (all items verified)
  // ─────────────────────────────────────────────────────────────────────────

  async completeBin(binId: string, userId?: string): Promise<void> {
    const bin = await this.repo.findPickBinForCompletion(binId);
    if (!bin) throw new Error(`Bin ${binId} not found`);

    const unverified = bin.items.filter((i) => i.verifiedQty < i.quantity);
    if (unverified.length > 0) {
      throw new Error(
        `${unverified.length} item(s) not fully verified: ${unverified.map((i) => i.sku).join(", ")}`,
      );
    }

    await this.repo.completeBin(binId, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Complete Packing from Bin (bin verification already done)
  // ─────────────────────────────────────────────────────────────────────────

  async completePackingFromBin(
    orderId: string,
    binId: string,
    data: {
      weight: number;
      weightUnit?: string;
      dimensions?: {
        length: number;
        width: number;
        height: number;
        unit: string;
      };
      userId?: string;
    },
  ): Promise<{
    order: { id: string; status: string };
    bin: { id: string; status: string };
  }> {
    // Load bin with order data for validation
    const { prisma } = await import("@wms/db");
    const bin = await prisma.pickBin.findUnique({
      where: { id: binId },
      include: {
        items: { include: { productVariant: true } },
        order: {
          include: {
            items: { include: { productVariant: true } },
            allocations: { where: { status: { in: ["ALLOCATED", "PICKED"] } } },
          },
        },
      },
    });

    if (!bin) throw new Error(`Bin ${binId} not found`);
    if (bin.orderId !== orderId)
      throw new Error(`Bin ${bin.binNumber} does not belong to this order`);
    if (bin.status === "COMPLETED")
      throw new Error(`Bin ${bin.binNumber} already completed`);

    const unverified = bin.items.filter((i) => i.verifiedQty < i.quantity);
    if (unverified.length > 0) {
      throw new Error(
        `${unverified.length} item(s) not fully verified: ${unverified.map((i) => i.sku).join(", ")}`,
      );
    }

    const correlationId = randomUUID();
    const taskNumber = generateTaskNumber("PACK", bin.order.orderNumber);

    await this.repo.completePackingFromBin({
      orderId,
      binId,
      binNumber: bin.binNumber,
      orderNumber: bin.order.orderNumber,
      weight: data.weight,
      weightUnit: data.weightUnit ?? "ounce",
      dimensions: data.dimensions,
      userId: data.userId,
      binItems: bin.items.map((i) => ({
        productVariantId: i.productVariantId,
        quantity: i.quantity,
      })),
      orderItems: bin.order.items.map((oi) => ({
        id: oi.id,
        productVariantId: oi.productVariantId,
      })),
      taskNumber,
    });

    // Emit events
    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PICKBIN_COMPLETED,
        orderId,
        {
          binId,
          binNumber: bin.binNumber,
          orderNumber: bin.order.orderNumber,
          packedBy: data.userId,
          itemCount: bin.items.length,
        },
        { correlationId, userId: data.userId },
      ),
    );

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.PACKING_COMPLETED,
        orderId,
        {
          binId,
          binNumber: bin.binNumber,
          orderNumber: bin.order.orderNumber,
          weight: data.weight,
          weightUnit: data.weightUnit ?? "ounce",
          dimensions: data.dimensions,
        },
        { correlationId, userId: data.userId },
      ),
    );

    await emitEvent(
      createEventPayload(
        EVENT_TYPES.ORDER_PACKED,
        orderId,
        { orderNumber: bin.order.orderNumber },
        { correlationId, userId: data.userId },
      ),
    );

    return {
      order: { id: orderId, status: "PACKED" },
      bin: { id: binId, status: "COMPLETED" },
    };
  }
}
