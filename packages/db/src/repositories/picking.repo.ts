/**
 * Picking Repository
 * Persistence layer for pick list generation, confirmation, and bin operations
 *
 * Save to: packages/db/src/repositories/picking.repo.ts
 */

import { prisma } from "../client.js";
import type { Prisma } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

export interface PickingRepository {
  findOrderWithAllocations(
    orderId: string,
  ): Promise<OrderWithAllocations | null>;
  findActivePickTask(orderId: string): Promise<{ taskNumber: string } | null>;
  createPickTask(params: CreatePickTaskParams): Promise<PickTaskResult>;
  findTaskItemForPick(taskItemId: string): Promise<TaskItemForPick | null>;
  confirmPickItem(
    taskItemId: string,
    params: ConfirmPickParams,
  ): Promise<ConfirmPickDbResult>;
  findPickTaskWithCompletedItems(
    pickTaskId: string,
  ): Promise<PickTaskWithItems | null>;
  createPickBin(params: CreatePickBinParams): Promise<PickBinResult>;
  findPickBinByBarcode(barcode: string): Promise<PickBinWithDetails | null>;
  updatePickBinStatus(binId: string, status: string): Promise<void>;
  generateBinNumber(): Promise<string>;
}

export interface OrderWithAllocations {
  id: string;
  orderNumber: string;
  status: string;
  priority: string;
  items: Array<{ id: string }>;
  allocations: Array<{
    id: string;
    orderItemId: string | null;
    productVariantId: string;
    locationId: string;
    quantity: number;
    inventoryUnitId: string;
    productVariant: { id: string; sku: string; name: string };
    location: { id: string; name: string; pickSequence: number | null };
  }>;
}

export interface CreatePickTaskParams {
  taskNumber: string;
  orderId: string;
  priority: number;
  sortedAllocations: Array<{
    id: string;
    orderItemId: string | null;
    productVariantId: string;
    locationId: string;
    quantity: number;
  }>;
  userId?: string;
  orderNumber: string;
}

export interface PickTaskResult {
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
}

export interface TaskItemForPick {
  id: string;
  taskId: string;
  orderId: string | null;
  orderItemId: string | null;
  productVariantId: string | null;
  quantityRequired: number;
  quantityCompleted: number;
  status: string;
  task: {
    taskNumber: string;
    type: string;
    status: string;
    totalItems: number;
    startedAt: Date | null;
  };
  allocation: { id: string; inventoryUnitId: string } | null;
  productVariant: { sku: string; name: string } | null;
  location: { name: string } | null;
  order: { orderNumber: string } | null;
}

export interface ConfirmPickParams {
  quantity: number;
  isShort: boolean;
  userId?: string;
  locationScanned: boolean;
  itemScanned: boolean;
}

export interface ConfirmPickDbResult {
  completedCount: number;
  shortCount: number;
  taskComplete: boolean;
}

export interface PickTaskWithItems {
  id: string;
  taskItems: Array<{
    productVariantId: string | null;
    quantityCompleted: number;
    productVariant: { id: string; sku: string; name: string } | null;
  }>;
}

export interface CreatePickBinParams {
  binNumber: string;
  barcode: string;
  orderId: string;
  pickTaskId: string;
  userId?: string;
  items: Array<{ productVariantId: string; sku: string; quantity: number }>;
}

export interface PickBinResult {
  id: string;
  binNumber: string;
  barcode: string;
  items: Array<{ sku: string; quantity: number }>;
}

export interface PickBinWithDetails {
  id: string;
  binNumber: string;
  barcode: string;
  status: string;
  orderId: string;
  order: { id: string; orderNumber: string; status: string };
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
}

// =============================================================================
// Repository Implementation
// =============================================================================

export const pickingRepository: PickingRepository = {
  async findOrderWithAllocations(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        allocations: {
          where: { status: "ALLOCATED" },
          include: { productVariant: true, location: true },
        },
      },
    });
    if (!order) return null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      priority: order.priority,
      items: order.items.map((i) => ({ id: i.id })),
      allocations: order.allocations.map((a) => ({
        id: a.id,
        orderItemId: a.orderItemId,
        productVariantId: a.productVariantId,
        locationId: a.locationId,
        quantity: a.quantity,
        inventoryUnitId: a.inventoryUnitId,
        productVariant: {
          id: a.productVariant.id,
          sku: a.productVariant.sku,
          name: a.productVariant.name,
        },
        location: {
          id: a.location.id,
          name: a.location.name,
          pickSequence: a.location.pickSequence,
        },
      })),
    };
  },

  async findActivePickTask(orderId) {
    return prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PICKING",
        status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
      select: { taskNumber: true },
    });
  },

  async createPickTask(params) {
    const {
      taskNumber,
      orderId,
      priority,
      sortedAllocations,
      userId,
      orderNumber,
    } = params;
    return prisma.$transaction(async (tx) => {
      const workTask = await tx.workTask.create({
        data: {
          taskNumber,
          type: "PICKING",
          status: "PENDING",
          priority,
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
            })),
          },
          events: {
            create: {
              eventType: "TASK_CREATED",
              userId,
              data: { orderNumber, itemCount: sortedAllocations.length },
            },
          },
        },
        include: { taskItems: { orderBy: { sequence: "asc" } } },
      });

      // Link allocations to task items
      for (let i = 0; i < sortedAllocations.length; i++) {
        await tx.allocation.update({
          where: { id: sortedAllocations[i].id },
          data: { taskItemId: workTask.taskItems[i].id },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: "PICKING" },
      });
      return workTask as unknown as PickTaskResult;
    });
  },

  async findTaskItemForPick(taskItemId) {
    const item = await prisma.taskItem.findUnique({
      where: { id: taskItemId },
      include: {
        task: true,
        allocation: true,
        productVariant: true,
        location: true,
        order: true,
      },
    });
    if (!item) return null;
    return {
      id: item.id,
      taskId: item.taskId,
      orderId: item.orderId,
      orderItemId: item.orderItemId,
      productVariantId: item.productVariantId,
      quantityRequired: item.quantityRequired,
      quantityCompleted: item.quantityCompleted,
      status: item.status,
      task: {
        taskNumber: item.task.taskNumber,
        type: item.task.type,
        status: item.task.status,
        totalItems: item.task.totalItems,
        startedAt: item.task.startedAt,
      },
      allocation: item.allocation
        ? {
            id: item.allocation.id,
            inventoryUnitId: item.allocation.inventoryUnitId,
          }
        : null,
      productVariant: item.productVariant
        ? { sku: item.productVariant.sku, name: item.productVariant.name }
        : null,
      location: item.location ? { name: item.location.name } : null,
      order: item.order ? { orderNumber: item.order.orderNumber } : null,
    };
  },

  async confirmPickItem(taskItemId, params) {
    const { quantity, isShort, userId, locationScanned, itemScanned } = params;
    const taskItem = await prisma.taskItem.findUnique({
      where: { id: taskItemId },
      include: {
        task: true,
        allocation: true,
        productVariant: true,
        location: true,
      },
    });
    if (!taskItem) throw new Error(`TaskItem ${taskItemId} not found`);

    return prisma.$transaction(async (tx) => {
      await tx.taskItem.update({
        where: { id: taskItemId },
        data: {
          status: isShort ? "SHORT" : "COMPLETED",
          quantityCompleted: quantity,
          completedBy: userId,
          completedAt: new Date(),
          locationScanned,
          itemScanned,
          shortReason: isShort
            ? `Short pick: ${quantity}/${taskItem.quantityRequired}`
            : null,
        },
      });

      if (taskItem.allocation) {
        await tx.allocation.update({
          where: { id: taskItem.allocation.id },
          data: {
            status: isShort ? "PARTIALLY_PICKED" : "PICKED",
            pickedAt: new Date(),
          },
        });
      }

      if (taskItem.orderItemId) {
        await tx.orderItem.update({
          where: { id: taskItem.orderItemId },
          data: { quantityPicked: { increment: quantity } },
        });
      }

      if (taskItem.allocation?.inventoryUnitId) {
        const unit = await tx.inventoryUnit.findUnique({
          where: { id: taskItem.allocation.inventoryUnitId },
        });
        if (unit && unit.quantity <= 0) {
          await tx.inventoryUnit.update({
            where: { id: taskItem.allocation.inventoryUnitId },
            data: { status: "PICKED" },
          });
        }
      }

      const completedCount = await tx.taskItem.count({
        where: {
          taskId: taskItem.taskId,
          status: { in: ["COMPLETED", "SHORT", "SKIPPED"] },
        },
      });
      const shortCount = await tx.taskItem.count({
        where: { taskId: taskItem.taskId, status: "SHORT" },
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

      await tx.taskEvent.create({
        data: {
          taskId: taskItem.taskId,
          eventType: isShort ? "ITEM_SHORT" : "ITEM_COMPLETED",
          userId,
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

      if (taskComplete) {
        await tx.workTask.update({
          where: { id: taskItem.taskId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedOrders: 1,
          },
        });
        await tx.order.update({
          where: { id: taskItem.orderId ?? undefined },
          data: { status: "PICKED" },
        });
        await tx.taskEvent.create({
          data: {
            taskId: taskItem.taskId,
            eventType: "TASK_COMPLETED",
            userId,
            data: { completedItems: completedCount, shortItems: shortCount },
          },
        });
      }

      return { completedCount, shortCount, taskComplete };
    });
  },

  async findPickTaskWithCompletedItems(pickTaskId) {
    return prisma.workTask.findUnique({
      where: { id: pickTaskId },
      include: {
        taskItems: {
          where: { status: "COMPLETED" },
          include: {
            productVariant: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
  },

  async createPickBin(params) {
    const { binNumber, barcode, orderId, pickTaskId, userId, items } = params;
    const bin = await prisma.pickBin.create({
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
      include: { items: true },
    });
    return {
      id: bin.id,
      binNumber: bin.binNumber,
      barcode: bin.barcode,
      items: bin.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
    };
  },

  async findPickBinByBarcode(barcode) {
    return prisma.pickBin.findUnique({
      where: { barcode },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
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
    }) as Promise<PickBinWithDetails | null>;
  },

  async updatePickBinStatus(binId, status) {
    await prisma.pickBin.update({
      where: { id: binId },
      data: { status: status as any },
    });
  },

  async generateBinNumber() {
    const count = await prisma.pickBin.count();
    return `BIN-${String(count + 1).padStart(6, "0")}`;
  },
};
