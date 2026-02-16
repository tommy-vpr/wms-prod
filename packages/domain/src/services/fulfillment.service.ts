/**
 * FulfillmentService
 * Orchestrates the fulfillment pipeline: pick → pack → ship
 *
 * Save to: packages/domain/src/services/fulfillment.service.ts
 *
 * Each step:
 *  1. Validates current state
 *  2. Performs DB operations in a transaction
 *  3. Persists FulfillmentEvent to DB (audit trail + SSE replay)
 *  4. Publishes to Redis pub/sub (real-time SSE delivery)
 */

import { PrismaClient, Prisma } from "@wms/db"; // Adjust import to your prisma client path
import { publish, EVENT_TYPES, type FulfillmentEvent } from "@wms/pubsub";
import { randomUUID } from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface PackingImageDetail {
  id: string;
  url: string;
  filename: string;
  notes: string | null;
  uploadedAt: Date;
  uploadedBy: {
    id: string;
    name: string | null;
  };
}

interface PickListResult {
  task: WorkTaskWithItems;
  order: { id: string; orderNumber: string; status: string };
}

interface ConfirmPickResult {
  taskItem: { id: string; status: string; quantityCompleted: number };
  taskComplete: boolean;
  allItemsPicked: boolean;
}

interface PackListResult {
  task: WorkTaskWithItems;
}

interface VerifyPackResult {
  taskItem: { id: string; status: string };
  allVerified: boolean;
}

interface CompletePackingResult {
  task: { id: string; packedWeight: number | null; packedDimensions: unknown };
}

interface ShipResult {
  label: {
    id: string;
    trackingNumber: string;
    carrier: string;
    service: string;
    labelUrl: string | null;
  };
  order: { id: string; status: string; trackingNumber: string | null };
}

interface CreateLabelInput {
  carrier: string;
  service: string;
  trackingNumber: string;
  trackingUrl?: string;
  rate: number;
  estimatedDays?: number;
  estimatedDelivery?: Date;
  labelUrl?: string;
  labelFormat?: string;
  weight?: number;
  weightUnit?: string;
  dimensions?: { length: number; width: number; height: number; unit: string };
  shipEngineId?: string;
  shipmentId?: string;
  rawResponse?: Record<string, unknown>;
}

type WorkTaskWithItems = {
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
    orderId: string;
  }>;
};

// ── Fulfillment Status Return Types ───────────────────────────────────────

export interface ScanItemDetail {
  taskItemId: string;
  sequence: number;
  status: string;
  quantityRequired: number;
  quantityCompleted: number;
  expectedItemBarcodes: string[];
  sku: string | null;
  variantName: string | null;
  imageUrl: string | null;
}

export interface PickScanDetail extends ScanItemDetail {
  expectedLocationBarcode: string | null;
  locationName: string | null;
  locationDetail: {
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    bin: string | null;
  } | null;
}

export interface ScanLookup {
  pick: Record<string, PickScanDetail>;
  pack: Record<string, ScanItemDetail>;
  barcodeLookup: Record<string, { taskItemId: string; type: "pick" | "pack" }>;
}

interface TaskItemWithRelations {
  id: string;
  sequence: number;
  status: string;
  quantityRequired: number;
  quantityCompleted: number;
  productVariant: {
    id: string;
    sku: string;
    upc: string | null;
    barcode: string | null;
    name: string;
    imageUrl: string | null;
  } | null;
  location?: {
    id: string;
    name: string;
    barcode: string | null;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    bin: string | null;
  } | null;
  [key: string]: unknown;
}

interface WorkTaskWithRelations {
  id: string;
  taskNumber: string;
  type: string;
  status: string;
  totalItems: number;
  completedItems: number;
  taskItems: TaskItemWithRelations[];
  [key: string]: unknown;
}

interface ShippingLabelDetail {
  id: string;
  orderId: string;
  carrier: string;
  service: string;
  trackingNumber: string;
  trackingUrl: string | null;
  rate: unknown;
  labelUrl: string | null;
  status: string;
  createdAt: Date;
  [key: string]: unknown;
}

interface FulfillmentEventDetail {
  id: string;
  orderId: string | null;
  type: string;
  payload: unknown;
  correlationId: string | null;
  userId: string | null;
  createdAt: Date;
}

export interface FulfillmentStatusResult {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    trackingNumber: string | null;
    shippedAt: Date | null;
    createdAt: Date;
    customerName: string;
    shippingAddress: unknown;
    priority: string;
    items: Array<{
      id: string;
      sku: string;
      quantity: number;
      quantityPicked: number;
      productVariant: {
        id: string;
        sku: string;
        upc: string | null;
        barcode: string | null;
        name: string;
        imageUrl: string | null;
      } | null;
    }>;
  };
  packingImages: PackingImageDetail[];

  currentStep: string;
  picking: WorkTaskWithRelations | null;
  packing: WorkTaskWithRelations | null;
  shipping: ShippingLabelDetail[];
  events: FulfillmentEventDetail[];
  scanLookup: ScanLookup;
  pickBin: {
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
        imageUrl: string | null;
      };
    }>;
  } | null;
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

/**
 * Persist event to DB for replay, then publish to Redis for real-time delivery.
 * DB write is source of truth; Redis is fire-and-forget for live clients.
 */
async function emitEvent(
  prisma: PrismaClient,
  event: FulfillmentEvent,
): Promise<void> {
  // 1. Persist
  await prisma.fulfillmentEvent.create({
    data: {
      id: event.id,
      orderId: event.orderId,
      type: event.type,
      payload: event.payload as Prisma.InputJsonValue,
      correlationId: event.correlationId,
      userId: event.userId,
    },
  });

  // 2. Publish (don't let pub/sub failure block the flow)
  try {
    await publish(event);
  } catch (err) {
    console.error("[FulfillmentService] Pub/sub publish failed:", err);
  }
}

// =============================================================================
// Task Number Generator
// =============================================================================

function generateTaskNumber(prefix: string, orderNumber: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${orderNumber}-${ts}`;
}

// =============================================================================
// FulfillmentService
// =============================================================================

export class FulfillmentService {
  constructor(private prisma: PrismaClient) {}

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1: Generate Pick List
  // ───────────────────────────────────────────────────────────────────────────

  async generatePickList(
    orderId: string,
    userId?: string,
  ): Promise<PickListResult> {
    // 1. Load order with allocations
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        allocations: {
          where: { status: "ALLOCATED" },
          include: {
            productVariant: true,
            location: true,
          },
        },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    // 2. Validate state
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

    // 3. Check for existing active pick task
    const existingTask = await this.prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PICKING",
        status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
    });

    if (existingTask) {
      throw new Error(
        `Active pick task ${existingTask.taskNumber} already exists for this order`,
      );
    }

    // 4. Sort allocations by location pick sequence for optimal path
    const sortedAllocations = [...order.allocations].sort((a, b) => {
      const seqA = a.location?.pickSequence ?? 9999;
      const seqB = b.location?.pickSequence ?? 9999;
      return seqA - seqB;
    });

    // 5. Create WorkTask + TaskItems in transaction
    const correlationId = randomUUID();
    const taskNumber = generateTaskNumber("PICK", order.orderNumber);

    const task = await this.prisma.$transaction(async (tx) => {
      const workTask = await tx.workTask.create({
        data: {
          taskNumber,
          type: "PICKING",
          status: "PENDING",
          priority:
            order.priority === "EXPRESS"
              ? 2
              : order.priority === "RUSH"
                ? 1
                : 0,
          orderIds: [orderId],
          totalOrders: 1,
          totalItems: sortedAllocations.length,
          taskItems: {
            create: sortedAllocations.map((alloc, idx) => ({
              orderId,
              orderItemId: alloc.orderItemId,
              productVariantId: alloc.productVariantId,
              locationId: alloc.locationId,
              sequence: idx + 1,
              quantityRequired: alloc.quantity,
              // Link allocation to task item
            })),
          },
          events: {
            create: {
              eventType: "TASK_CREATED",
              userId,
              data: {
                orderNumber: order.orderNumber,
                itemCount: sortedAllocations.length,
              },
            },
          },
        },
        include: {
          taskItems: {
            orderBy: { sequence: "asc" },
          },
        },
      });

      // Link allocations to task items by matching order
      for (let i = 0; i < sortedAllocations.length; i++) {
        const alloc = sortedAllocations[i];
        const taskItem = workTask.taskItems[i];

        await tx.allocation.update({
          where: { id: alloc.id },
          data: { taskItemId: taskItem.id },
        });
      }

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: "PICKING" },
      });

      return workTask;
    });

    // 6. Emit events (after transaction commits)
    const picklistItems = task.taskItems.map((ti, idx) => ({
      taskItemId: ti.id,
      sequence: ti.sequence,
      sku: sortedAllocations[idx]?.productVariant?.sku,
      variantName: sortedAllocations[idx]?.productVariant?.name,
      locationName: sortedAllocations[idx]?.location?.name,
      quantity: ti.quantityRequired,
    }));

    await emitEvent(
      this.prisma,
      createEventPayload(
        EVENT_TYPES.ORDER_PROCESSING,
        orderId,
        { orderNumber: order.orderNumber, taskId: task.id },
        { correlationId, userId },
      ),
    );

    await emitEvent(
      this.prisma,
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
      task: task as unknown as WorkTaskWithItems,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: "PICKING",
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2: Confirm Pick Item
  // ───────────────────────────────────────────────────────────────────────────

  async confirmPickItem(
    taskItemId: string,
    opts?: {
      quantity?: number;
      locationScanned?: boolean;
      itemScanned?: boolean;
      userId?: string;
    },
  ): Promise<ConfirmPickResult> {
    // 1. Load task item with relations
    const taskItem = await this.prisma.taskItem.findUnique({
      where: { id: taskItemId },
      include: {
        task: true,
        allocation: true,
        productVariant: true,
        location: true,
        order: true,
      },
    });

    if (!taskItem) throw new Error(`TaskItem ${taskItemId} not found`);
    if (taskItem.task.type !== "PICKING") {
      throw new Error(
        `TaskItem belongs to ${taskItem.task.type} task, not PICKING`,
      );
    }
    if (taskItem.status === "COMPLETED") {
      throw new Error(`TaskItem ${taskItemId} already completed`);
    }

    const quantity = opts?.quantity ?? taskItem.quantityRequired;
    const isShort = quantity < taskItem.quantityRequired;
    const correlationId = randomUUID();

    // 2. Update in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Update task item
      const updatedItem = await tx.taskItem.update({
        where: { id: taskItemId },
        data: {
          status: isShort ? "SHORT" : "COMPLETED",
          quantityCompleted: quantity,
          completedBy: opts?.userId,
          completedAt: new Date(),
          locationScanned: opts?.locationScanned ?? false,
          itemScanned: opts?.itemScanned ?? false,
          shortReason: isShort
            ? `Short pick: ${quantity}/${taskItem.quantityRequired}`
            : null,
        },
      });

      // Update allocation status → PICKED
      if (taskItem.allocation) {
        await tx.allocation.update({
          where: { id: taskItem.allocation.id },
          data: {
            status: isShort ? "PARTIALLY_PICKED" : "PICKED",
            pickedAt: new Date(),
          },
        });
      }

      // Update order item picked quantity
      if (taskItem.orderItemId) {
        await tx.orderItem.update({
          where: { id: taskItem.orderItemId },
          data: {
            quantityPicked: { increment: quantity },
          },
        });
      }

      // Update inventory unit status - only if fully consumed
      if (taskItem.allocation?.inventoryUnitId) {
        const unit = await tx.inventoryUnit.findUnique({
          where: { id: taskItem.allocation.inventoryUnitId },
        });
        // Only set to PICKED if no quantity remains
        if (unit && unit.quantity <= 0) {
          await tx.inventoryUnit.update({
            where: { id: taskItem.allocation.inventoryUnitId },
            data: { status: "PICKED" },
          });
        }
      }

      // Update task progress
      const completedCount = await tx.taskItem.count({
        where: {
          taskId: taskItem.taskId,
          status: { in: ["COMPLETED", "SHORT", "SKIPPED"] },
        },
      });

      const shortCount = await tx.taskItem.count({
        where: {
          taskId: taskItem.taskId,
          status: "SHORT",
        },
      });

      await tx.workTask.update({
        where: { id: taskItem.taskId },
        data: {
          completedItems: completedCount,
          shortItems: shortCount,
          status: "IN_PROGRESS",
          startedAt: taskItem.task.startedAt ?? new Date(),
        },
      });

      // Create task event
      await tx.taskEvent.create({
        data: {
          taskId: taskItem.taskId,
          eventType: isShort ? "ITEM_SHORT" : "ITEM_COMPLETED",
          userId: opts?.userId,
          taskItemId: taskItem.id,
          data: {
            quantity,
            sku: taskItem.productVariant?.sku,
            locationName: taskItem.location?.name,
            isShort,
          },
        },
      });

      const taskComplete = completedCount >= taskItem.task.totalItems;

      // If all items done, complete the task
      if (taskComplete) {
        await tx.workTask.update({
          where: { id: taskItem.taskId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedOrders: 1,
          },
        });

        // Update order status
        await tx.order.update({
          where: { id: taskItem.orderId ?? undefined },
          data: { status: "PICKED" },
        });

        await tx.taskEvent.create({
          data: {
            taskId: taskItem.taskId,
            eventType: "TASK_COMPLETED",
            userId: opts?.userId,
            data: { completedItems: completedCount, shortItems: shortCount },
          },
        });
      }

      return { completedCount, taskComplete, shortCount };
    });

    // 3. Emit events
    await emitEvent(
      this.prisma,
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
        this.prisma,
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
        this.prisma,
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

      // Include bin info in the completed event
      await emitEvent(
        this.prisma,
        createEventPayload(
          EVENT_TYPES.PICKLIST_COMPLETED,
          taskItem.orderId ?? undefined,
          {
            taskId: taskItem.taskId,
            taskNumber: taskItem.task.taskNumber,
            completedItems: result.completedCount,
            shortItems: result.shortCount,
            bin: {
              id: bin.id,
              binNumber: bin.binNumber,
              barcode: bin.barcode,
            },
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

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2b: Confirm All Remaining Pick Items (Batch Mode)
  // ───────────────────────────────────────────────────────────────────────────

  async confirmAllPickItems(
    orderId: string,
    opts?: { userId?: string },
  ): Promise<{
    confirmed: number;
    taskComplete: boolean;
  }> {
    // Find the active pick task for this order
    const task = await this.prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PICKING",
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      include: {
        taskItems: {
          where: {
            status: { notIn: ["COMPLETED", "SHORT", "SKIPPED"] },
          },
        },
      },
    });

    if (!task) {
      throw new Error("No active pick task found for this order");
    }

    if (task.taskItems.length === 0) {
      return { confirmed: 0, taskComplete: true };
    }

    // Confirm each remaining item by calling confirmPickItem
    let confirmed = 0;
    let taskComplete = false;

    for (const item of task.taskItems) {
      const result = await this.confirmPickItem(item.id, {
        quantity: item.quantityRequired,
        locationScanned: false,
        itemScanned: false,
        userId: opts?.userId,
      });
      confirmed++;
      taskComplete = result.taskComplete;
    }

    return { confirmed, taskComplete };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3: Generate Pack List
  // ───────────────────────────────────────────────────────────────────────────

  async generatePackList(
    orderId: string,
    userId?: string,
  ): Promise<PackListResult> {
    // 1. Validate order state
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { productVariant: true },
        },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status !== "PICKED") {
      throw new Error(
        `Cannot start packing: order is ${order.status}, expected PICKED`,
      );
    }

    // 2. Check for existing active pack task
    const existingTask = await this.prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PACKING",
        status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
    });

    if (existingTask) {
      throw new Error(
        `Active pack task ${existingTask.taskNumber} already exists for this order`,
      );
    }

    // 3. Get picked items from the completed pick task
    const pickTask = await this.prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PICKING",
        status: "COMPLETED",
      },
      include: {
        taskItems: {
          where: { status: "COMPLETED" },
          orderBy: { sequence: "asc" },
          include: {
            productVariant: true,
          },
        },
      },
      orderBy: { completedAt: "desc" },
    });

    if (!pickTask || pickTask.taskItems.length === 0) {
      throw new Error("No completed pick items found for packing");
    }

    // 4. Create packing task with verification items
    const correlationId = randomUUID();
    const taskNumber = generateTaskNumber("PACK", order.orderNumber);

    const task = await this.prisma.$transaction(async (tx) => {
      const workTask = await tx.workTask.create({
        data: {
          taskNumber,
          type: "PACKING",
          status: "PENDING",
          orderIds: [orderId],
          totalOrders: 1,
          totalItems: pickTask.taskItems.length,
          taskItems: {
            create: pickTask.taskItems.map((pickItem, idx) => ({
              orderId,
              orderItemId: pickItem.orderItemId,
              productVariantId: pickItem.productVariantId,
              locationId: pickItem.locationId,
              sequence: idx + 1,
              quantityRequired: pickItem.quantityCompleted,
            })),
          },
          events: {
            create: {
              eventType: "TASK_CREATED",
              userId,
              data: {
                orderNumber: order.orderNumber,
                itemCount: pickTask.taskItems.length,
                type: "PACKING",
              },
            },
          },
        },
        include: {
          taskItems: {
            orderBy: { sequence: "asc" },
            include: { productVariant: true },
          },
        },
      });

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: "PACKING" },
      });

      return workTask;
    });

    // 5. Emit events
    const packItems = task.taskItems.map((ti) => ({
      taskItemId: ti.id,
      sequence: ti.sequence,
      sku: ti.productVariant?.sku,
      variantName: ti.productVariant?.name,
      quantity: ti.quantityRequired,
    }));

    await emitEvent(
      this.prisma,
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

    return { task: task as unknown as WorkTaskWithItems };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Create Pick Bin (called when picking completes)
  // ─────────────────────────────────────────────────────────────────────────────
  private generateBinBarcode(): string {
    // Format: BIN-YYYYMMDD-XXXXX (easy to scan, includes date for sorting)
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `BIN-${date}-${random}`;
  }

  private async generateBinNumber(): Promise<string> {
    const count = await this.prisma.pickBin.count();
    return `BIN-${String(count + 1).padStart(6, "0")}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Create Pick Bin (called when picking completes)
  // ─────────────────────────────────────────────────────────────────────────────

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
    // Get completed pick task items
    const pickTask = await this.prisma.workTask.findUnique({
      where: { id: pickTaskId },
      include: {
        taskItems: {
          where: { status: "COMPLETED" },
          include: {
            productVariant: {
              select: { id: true, sku: true, name: true },
            },
          },
        },
      },
    });

    if (!pickTask) {
      throw new Error(`Pick task ${pickTaskId} not found`);
    }

    const binNumber = await this.generateBinNumber();
    const barcode = this.generateBinBarcode();

    // Aggregate items by SKU (in case same product from multiple locations)
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

    // Create bin with items
    const bin = await this.prisma.pickBin.create({
      data: {
        binNumber,
        barcode,
        orderId,
        pickTaskId,
        status: "STAGED",
        pickedBy: userId,
        pickedAt: new Date(),
        items: {
          create: items.map((item) => ({
            productVariantId: item.productVariantId,
            sku: item.sku,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Emit event
    await emitEvent(
      this.prisma,
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

    return {
      id: bin.id,
      binNumber: bin.binNumber,
      barcode: bin.barcode,
      items: items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lookup Order by Bin Barcode (for pack station)
  // ─────────────────────────────────────────────────────────────────────────────

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
    const bin = await this.prisma.pickBin.findUnique({
      where: { barcode },
      include: {
        order: {
          select: { id: true, orderNumber: true, status: true },
        },
        items: {
          include: {
            productVariant: {
              select: {
                id: true,
                sku: true,
                upc: true,
                barcode: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!bin) {
      throw new Error(`Bin with barcode "${barcode}" not found`);
    }

    if (bin.status === "COMPLETED") {
      throw new Error(`Bin ${bin.binNumber} has already been packed`);
    }

    if (bin.status === "CANCELLED") {
      throw new Error(`Bin ${bin.binNumber} was cancelled`);
    }

    // Update bin status to PACKING if it was STAGED
    if (bin.status === "STAGED") {
      await this.prisma.pickBin.update({
        where: { id: bin.id },
        data: { status: "PACKING" },
      });
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Verify Bin Item (scan UPC at pack station)
  // ─────────────────────────────────────────────────────────────────────────────

  async verifyBinItem(
    binId: string,
    barcode: string, // UPC/SKU scanned
    userId?: string,
    quantity?: number, // How many to verify (default 1, for bulk verify)
  ): Promise<{
    verified: boolean;
    item: { sku: string; verifiedQty: number; quantity: number };
    allVerified: boolean;
  }> {
    // Find the bin item matching this barcode
    const bin = await this.prisma.pickBin.findUnique({
      where: { id: binId },
      include: {
        items: {
          include: {
            productVariant: {
              select: { id: true, sku: true, upc: true, barcode: true },
            },
          },
        },
      },
    });

    if (!bin) {
      throw new Error(`Bin ${binId} not found`);
    }

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

    if (!matchingItem) {
      throw new Error(`Item with barcode "${barcode}" not in this bin`);
    }

    // Check if already fully verified
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

    // Increment verified quantity (clamp to remaining)
    const remaining = matchingItem.quantity - matchingItem.verifiedQty;
    const incrementBy = Math.min(Math.max(quantity ?? 1, 1), remaining);

    const updated = await this.prisma.pickBinItem.update({
      where: { id: matchingItem.id },
      data: {
        verifiedQty: { increment: incrementBy },
        verifiedAt: new Date(),
        verifiedBy: userId,
      },
    });

    // Check if all items verified
    const allItems = await this.prisma.pickBinItem.findMany({
      where: { pickBinId: binId },
    });
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Complete Bin (all items verified)
  // ─────────────────────────────────────────────────────────────────────────────

  async completeBin(binId: string, userId?: string): Promise<void> {
    const bin = await this.prisma.pickBin.findUnique({
      where: { id: binId },
      include: { items: true },
    });

    if (!bin) {
      throw new Error(`Bin ${binId} not found`);
    }

    // Verify all items are verified
    const unverified = bin.items.filter((i) => i.verifiedQty < i.quantity);
    if (unverified.length > 0) {
      throw new Error(
        `${unverified.length} item(s) not fully verified: ${unverified.map((i) => i.sku).join(", ")}`,
      );
    }

    await this.prisma.pickBin.update({
      where: { id: binId },
      data: {
        status: "COMPLETED",
        packedBy: userId,
        packedAt: new Date(),
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4: Verify Pack Item
  // ───────────────────────────────────────────────────────────────────────────

  async verifyPackItem(
    taskItemId: string,
    opts?: { userId?: string },
  ): Promise<VerifyPackResult> {
    const taskItem = await this.prisma.taskItem.findUnique({
      where: { id: taskItemId },
      include: {
        task: true,
        productVariant: true,
        order: true,
      },
    });

    if (!taskItem) throw new Error(`TaskItem ${taskItemId} not found`);
    if (taskItem.task.type !== "PACKING") {
      throw new Error(
        `TaskItem belongs to ${taskItem.task.type} task, not PACKING`,
      );
    }
    if (taskItem.status === "COMPLETED") {
      return {
        taskItem: { id: taskItemId, status: "COMPLETED" },
        allVerified: false, // Already done, caller can check
      };
    }

    const correlationId = randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.taskItem.update({
        where: { id: taskItemId },
        data: {
          status: "COMPLETED",
          quantityCompleted: taskItem.quantityRequired,
          completedBy: opts?.userId,
          completedAt: new Date(),
          itemScanned: true,
        },
      });

      const completedCount = await tx.taskItem.count({
        where: {
          taskId: taskItem.taskId,
          status: "COMPLETED",
        },
      });

      await tx.workTask.update({
        where: { id: taskItem.taskId },
        data: {
          completedItems: completedCount,
          status: "IN_PROGRESS",
          startedAt: taskItem.task.startedAt ?? new Date(),
        },
      });

      await tx.taskEvent.create({
        data: {
          taskId: taskItem.taskId,
          eventType: "ITEM_COMPLETED",
          userId: opts?.userId,
          taskItemId: taskItem.id,
          data: {
            sku: taskItem.productVariant?.sku,
            quantity: taskItem.quantityRequired,
            type: "PACK_VERIFY",
          },
        },
      });

      return {
        completedCount,
        allVerified: completedCount >= taskItem.task.totalItems,
      };
    });

    // Emit event
    await emitEvent(
      this.prisma,
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

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5: Complete Packing (weight + dimensions)
  // ───────────────────────────────────────────────────────────────────────────

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
    const task = await this.prisma.workTask.findUnique({
      where: { id: taskId },
      include: {
        taskItems: true,
      },
    });

    if (!task) throw new Error(`WorkTask ${taskId} not found`);
    if (task.type !== "PACKING") {
      throw new Error(`Task ${taskId} is ${task.type}, not PACKING`);
    }

    // Ensure all items are verified
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

    // Fetch order for orderNumber
    const order = orderId
      ? await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { orderNumber: true },
        })
      : null;

    await this.prisma.$transaction(async (tx) => {
      // ══════════════════════════════════════════════════════════════════════
      // Ensure allocations are PICKED (required for shipping inventory consumption)
      // ══════════════════════════════════════════════════════════════════════
      if (orderId) {
        await tx.allocation.updateMany({
          where: {
            orderItem: { orderId },
            status: "ALLOCATED",
          },
          data: {
            status: "PICKED",
            pickedAt: new Date(),
          },
        });
      }

      // Update task with packing data
      await tx.workTask.update({
        where: { id: taskId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedOrders: 1,
          packedWeight: data.weight,
          packedWeightUnit: data.weightUnit ?? "ounce",
          packedDimensions:
            (data.dimensions as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          verifiedAt: new Date(),
          verifiedBy: data.userId,
        },
      });

      // Update order status
      if (orderId) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "PACKED" },
        });
      }

      await tx.taskEvent.create({
        data: {
          taskId,
          eventType: "TASK_COMPLETED",
          userId: data.userId,
          data: {
            weight: data.weight,
            weightUnit: data.weightUnit ?? "ounce",
            dimensions: data.dimensions,
            type: "PACKING_COMPLETED",
          },
        },
      });
    });

    // Emit events
    await emitEvent(
      this.prisma,
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
      this.prisma,
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

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6: Create Shipping Label + Ship
  // ───────────────────────────────────────────────────────────────────────────

  async createShippingLabel(
    orderId: string,
    labelData: CreateLabelInput,
    userId?: string,
  ): Promise<ShipResult> {
    // 🚨 FulfillmentService DOES NOT mutate inventory or allocations
    // It delegates shipping to ShippingService

    throw new Error(
      "Shipping is handled by ShippingService. Use shipping.service.ts for label creation.",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // QUERY: Get fulfillment status for an order
  // ───────────────────────────────────────────────────────────────────────────

  async getFulfillmentStatus(
    orderId: string,
  ): Promise<FulfillmentStatusResult> {
    const [order, pickTasks, packTasks, labels, events, pickBin] =
      await Promise.all([
        this.prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            trackingNumber: true,
            shippedAt: true,
            createdAt: true,
            customerName: true,
            shippingAddress: true,
            priority: true,

            packingImages: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                url: true,
                filename: true,
                notes: true,
                createdAt: true,
                uploader: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },

            items: {
              select: {
                id: true,
                sku: true,
                quantity: true,
                quantityPicked: true,
                productVariant: {
                  select: {
                    id: true,
                    sku: true,
                    upc: true,
                    barcode: true,
                    name: true,
                    imageUrl: true,
                  },
                },
              },
            },
          },
        }),
        this.prisma.workTask.findMany({
          where: { orderIds: { has: orderId }, type: "PICKING" },
          include: {
            taskItems: {
              orderBy: { sequence: "asc" },
              include: {
                productVariant: {
                  select: {
                    id: true,
                    sku: true,
                    upc: true,
                    barcode: true,
                    name: true,
                    imageUrl: true,
                  },
                },
                location: {
                  select: {
                    id: true,
                    name: true,
                    barcode: true,
                    zone: true,
                    aisle: true,
                    rack: true,
                    shelf: true,
                    bin: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.workTask.findMany({
          where: { orderIds: { has: orderId }, type: "PACKING" },
          include: {
            taskItems: {
              orderBy: { sequence: "asc" },
              include: {
                productVariant: {
                  select: {
                    id: true,
                    sku: true,
                    upc: true,
                    barcode: true,
                    name: true,
                    imageUrl: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.shippingPackage.findMany({
          where: { orderId },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.fulfillmentEvent.findMany({
          where: { orderId },
          orderBy: { createdAt: "asc" },
          take: 100,
        }),
        this.prisma.pickBin.findFirst({
          where: { orderId, status: { not: "CANCELLED" } },
          include: {
            items: {
              include: {
                productVariant: {
                  select: {
                    id: true,
                    sku: true,
                    upc: true,
                    barcode: true,
                    name: true,
                    imageUrl: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    if (!order) throw new Error(`Order ${orderId} not found`);

    // Determine current step
    let currentStep: string;
    switch (order.status) {
      case "PENDING":
      case "CONFIRMED":
      case "READY_TO_PICK":
      case "ALLOCATED":
        currentStep = "awaiting_pick";
        break;
      case "PICKING":
        currentStep = "picking";
        break;
      case "PICKED":
        currentStep = "awaiting_pack";
        break;
      case "PACKING":
        currentStep = "packing";
        break;
      case "PACKED":
        currentStep = "awaiting_ship";
        break;
      case "SHIPPED":
        currentStep = "shipped";
        break;
      case "DELIVERED":
        currentStep = "delivered";
        break;
      default:
        currentStep = order.status.toLowerCase();
    }

    // ── Build scan lookup maps for client-side barcode validation ──────
    // Frontend loads this once, validates scans locally with zero API calls.
    //
    // scanLookup.pick[taskItemId] = {
    //   expectedItemBarcodes: ["upc", "barcode", "sku"],
    //   expectedLocationBarcode: "A-01-02-03",
    //   ...display info
    // }

    const activePickTask = pickTasks.find((t) => t.status !== "CANCELLED");
    const activePackTask = packTasks.find((t) => t.status !== "CANCELLED");

    const pickScanLookup: Record<
      string,
      {
        taskItemId: string;
        sequence: number;
        status: string;
        quantityRequired: number;
        quantityCompleted: number;
        expectedItemBarcodes: string[];
        expectedLocationBarcode: string | null;
        sku: string | null;
        variantName: string | null;
        imageUrl: string | null;
        locationName: string | null;
        locationDetail: {
          zone: string | null;
          aisle: string | null;
          rack: string | null;
          shelf: string | null;
          bin: string | null;
        } | null;
      }
    > = {};

    if (activePickTask) {
      for (const ti of activePickTask.taskItems) {
        // Collect all valid barcodes for this item (UPC, barcode field, SKU as fallback)
        const barcodes: string[] = [];
        if (ti.productVariant?.upc) barcodes.push(ti.productVariant.upc);
        if (ti.productVariant?.barcode)
          barcodes.push(ti.productVariant.barcode);
        if (ti.productVariant?.sku) barcodes.push(ti.productVariant.sku);

        pickScanLookup[ti.id] = {
          taskItemId: ti.id,
          sequence: ti.sequence,
          status: ti.status,
          quantityRequired: ti.quantityRequired,
          quantityCompleted: ti.quantityCompleted,
          expectedItemBarcodes: barcodes,
          expectedLocationBarcode: ti.location?.barcode ?? null,
          sku: ti.productVariant?.sku ?? null,
          variantName: ti.productVariant?.name ?? null,
          imageUrl: ti.productVariant?.imageUrl ?? null,
          locationName: ti.location?.name ?? null,
          locationDetail: ti.location
            ? {
                zone: ti.location.zone,
                aisle: ti.location.aisle,
                rack: ti.location.rack,
                shelf: ti.location.shelf,
                bin: ti.location.bin,
              }
            : null,
        };
      }
    }

    const packScanLookup: Record<
      string,
      {
        taskItemId: string;
        sequence: number;
        status: string;
        quantityRequired: number;
        quantityCompleted: number;
        expectedItemBarcodes: string[];
        sku: string | null;
        variantName: string | null;
        imageUrl: string | null;
      }
    > = {};

    if (activePackTask) {
      for (const ti of activePackTask.taskItems) {
        const barcodes: string[] = [];
        if (ti.productVariant?.upc) barcodes.push(ti.productVariant.upc);
        if (ti.productVariant?.barcode)
          barcodes.push(ti.productVariant.barcode);
        if (ti.productVariant?.sku) barcodes.push(ti.productVariant.sku);

        packScanLookup[ti.id] = {
          taskItemId: ti.id,
          sequence: ti.sequence,
          status: ti.status,
          quantityRequired: ti.quantityRequired,
          quantityCompleted: ti.quantityCompleted,
          expectedItemBarcodes: barcodes,
          sku: ti.productVariant?.sku ?? null,
          variantName: ti.productVariant?.name ?? null,
          imageUrl: ti.productVariant?.imageUrl ?? null,
        };
      }
    }

    // Build reverse lookup: barcode → taskItemId (for instant scan matching)
    const barcodeLookup: Record<
      string,
      { taskItemId: string; type: "pick" | "pack" }
    > = {};

    for (const [taskItemId, data] of Object.entries(pickScanLookup)) {
      if (
        data.status !== "COMPLETED" &&
        data.status !== "SKIPPED" &&
        data.status !== "SHORT"
      ) {
        for (const bc of data.expectedItemBarcodes) {
          barcodeLookup[bc] = { taskItemId, type: "pick" };
        }
      }
    }

    for (const [taskItemId, data] of Object.entries(packScanLookup)) {
      if (data.status !== "COMPLETED") {
        for (const bc of data.expectedItemBarcodes) {
          barcodeLookup[bc] = { taskItemId, type: "pack" };
        }
      }
    }

    return {
      order,
      packingImages: order.packingImages.map((img) => ({
        id: img.id,
        url: img.url,
        filename: img.filename,
        notes: img.notes,
        uploadedAt: img.createdAt,
        uploadedBy: {
          id: img.uploader.id,
          name: img.uploader.name,
        },
      })),
      currentStep,
      picking: activePickTask ?? null,
      packing: activePackTask ?? null,
      shipping: labels
        .filter((l) => !l.voidedAt)
        .map((label) => ({
          id: label.id,
          orderId: label.orderId,
          carrier: label.carrierCode,
          service: label.serviceCode,
          trackingNumber: label.trackingNumber || "",
          trackingUrl: null,
          rate: Number(label.cost) || 0,
          labelUrl: label.labelUrl,
          status: label.voidedAt ? "VOIDED" : "PURCHASED",
          createdAt: label.createdAt,
        })),
      events,
      // ── Scan verification data ──────────────────────────────
      scanLookup: {
        pick: pickScanLookup,
        pack: packScanLookup,
        /**
         * Reverse lookup: scan a barcode → get the taskItemId + type
         * Usage: barcodeLookup["0123456789"] → { taskItemId: "abc", type: "pick" }
         * If not found → wrong item / not in this task
         */
        barcodeLookup,
      },
      pickBin: pickBin
        ? {
            id: pickBin.id,
            binNumber: pickBin.binNumber,
            barcode: pickBin.barcode,
            status: pickBin.status,
            items: pickBin.items.map((item) => ({
              id: item.id,
              sku: item.sku,
              quantity: item.quantity,
              verifiedQty: item.verifiedQty,
              productVariant: item.productVariant,
            })),
          }
        : null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Complete Packing from Bin (bin verification already done)
  // ─────────────────────────────────────────────────────────────────────────────

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
    // 1. Validate bin and order
    const bin = await this.prisma.pickBin.findUnique({
      where: { id: binId },
      include: {
        items: {
          include: {
            productVariant: true,
          },
        },
        order: {
          include: {
            items: {
              include: {
                productVariant: true,
              },
            },
            allocations: {
              where: { status: { in: ["ALLOCATED", "PICKED"] } },
            },
          },
        },
      },
    });

    if (!bin) {
      throw new Error(`Bin ${binId} not found`);
    }

    if (bin.orderId !== orderId) {
      throw new Error(`Bin ${bin.binNumber} does not belong to this order`);
    }

    if (bin.status === "COMPLETED") {
      throw new Error(`Bin ${bin.binNumber} already completed`);
    }

    // 2. Verify all items are verified
    const unverified = bin.items.filter((i) => i.verifiedQty < i.quantity);
    if (unverified.length > 0) {
      throw new Error(
        `${unverified.length} item(s) not fully verified: ${unverified.map((i) => i.sku).join(", ")}`,
      );
    }

    const correlationId = randomUUID();

    // 3. Complete in transaction
    await this.prisma.$transaction(async (tx) => {
      // ══════════════════════════════════════════════════════════════════════
      // FIX: Update allocations to PICKED status (required for shipping)
      // ══════════════════════════════════════════════════════════════════════
      await tx.allocation.updateMany({
        where: {
          orderItem: { orderId },
          status: "ALLOCATED",
        },
        data: {
          status: "PICKED",
          pickedAt: new Date(),
        },
      });

      // ══════════════════════════════════════════════════════════════════════
      // FIX: Update OrderItem.quantityPicked for each bin item
      // ══════════════════════════════════════════════════════════════════════
      for (const binItem of bin.items) {
        // Find the matching order item by productVariantId
        const orderItem = bin.order.items.find(
          (oi) => oi.productVariantId === binItem.productVariantId,
        );

        if (orderItem) {
          await tx.orderItem.update({
            where: { id: orderItem.id },
            data: {
              quantityPicked: binItem.quantity,
            },
          });
        }
      }

      // Complete the bin
      await tx.pickBin.update({
        where: { id: binId },
        data: {
          status: "COMPLETED",
          packedBy: data.userId,
          packedAt: new Date(),
        },
      });

      // Update order status to PACKED
      await tx.order.update({
        where: { id: orderId },
        data: { status: "PACKED" },
      });

      // Create a packing task record (for metrics/audit trail)
      const taskNumber = generateTaskNumber("PACK", bin.order.orderNumber);

      await tx.workTask.create({
        data: {
          taskNumber,
          type: "PACKING",
          status: "COMPLETED",
          orderIds: [orderId],
          totalOrders: 1,
          totalItems: bin.items.length,
          completedItems: bin.items.length,
          completedOrders: 1,
          completedAt: new Date(),
          startedAt: new Date(),
          packedWeight: data.weight,
          packedWeightUnit: data.weightUnit ?? "ounce",
          packedDimensions:
            (data.dimensions as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          verifiedAt: new Date(),
          verifiedBy: data.userId,
          events: {
            create: {
              eventType: "TASK_COMPLETED",
              userId: data.userId,
              data: {
                binId,
                binNumber: bin.binNumber,
                weight: data.weight,
                weightUnit: data.weightUnit ?? "ounce",
                dimensions: data.dimensions,
                type: "PACKING_FROM_BIN",
              },
            },
          },
        },
      });
    });

    // 4. Emit events
    await emitEvent(
      this.prisma,
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
      this.prisma,
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
      this.prisma,
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

  // ───────────────────────────────────────────────────────────────────────────
  // QUERY: Replay events for SSE catch-up
  // ───────────────────────────────────────────────────────────────────────────

  async getEventsSince(
    orderId: string,
    sinceEventId?: string,
  ): Promise<FulfillmentEvent[]> {
    let since: Date | undefined;

    if (sinceEventId) {
      const ref = await this.prisma.fulfillmentEvent.findUnique({
        where: { id: sinceEventId },
        select: { createdAt: true },
      });
      since = ref?.createdAt;
    }

    const events = await this.prisma.fulfillmentEvent.findMany({
      where: {
        orderId,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    return events.map((e) => ({
      id: e.id,
      type: e.type as FulfillmentEvent["type"],
      orderId: e.orderId ?? undefined,
      payload: e.payload as Record<string, unknown>,
      correlationId: e.correlationId ?? undefined,
      userId: e.userId ?? undefined,
      timestamp: e.createdAt.toISOString(),
    }));
  }
}
