/**
 * Packing Repository
 * Persistence layer for pack list generation, item verification, and packing completion
 *
 * Save to: packages/db/src/repositories/packing.repo.ts
 */

import { prisma } from "../client.js";
import { Prisma } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

export interface PackingRepository {
  findOrderForPacking(orderId: string): Promise<OrderForPacking | null>;
  findActivePackTask(orderId: string): Promise<{ taskNumber: string } | null>;
  findCompletedPickTask(orderId: string): Promise<CompletedPickTask | null>;
  createPackTask(params: CreatePackTaskParams): Promise<PackTaskResult>;
  findTaskItemForVerify(taskItemId: string): Promise<TaskItemForVerify | null>;
  verifyPackItem(
    taskItemId: string,
    params: VerifyPackParams,
  ): Promise<VerifyPackDbResult>;
  completePacking(taskId: string, params: CompletePackingParams): Promise<void>;
  findPickBinForVerification(
    binId: string,
  ): Promise<PickBinForVerification | null>;
  incrementBinItemVerifiedQty(
    itemId: string,
    userId?: string,
  ): Promise<{ verifiedQty: number }>;
  findPickBinItems(
    binId: string,
  ): Promise<Array<{ id: string; verifiedQty: number; quantity: number }>>;
  findPickBinForCompletion(binId: string): Promise<PickBinForCompletion | null>;
  completeBin(binId: string, userId?: string): Promise<void>;
  completePackingFromBin(params: CompletePackingFromBinParams): Promise<void>;
}

export interface OrderForPacking {
  id: string;
  orderNumber: string;
  status: string;
  items: Array<{
    id: string;
    productVariantId: string | null;
    productVariant: { id: string; sku: string; name: string } | null;
  }>;
}

export interface CompletedPickTask {
  id: string;
  taskItems: Array<{
    id: string;
    sequence: number;
    orderItemId: string | null;
    productVariantId: string | null;
    locationId: string | null;
    quantityCompleted: number;
    productVariant: { sku: string; name: string } | null;
  }>;
}

export interface CreatePackTaskParams {
  taskNumber: string;
  orderId: string;
  pickItems: Array<{
    orderItemId: string | null;
    productVariantId: string | null;
    locationId: string | null;
    quantityCompleted: number;
  }>;
  userId?: string;
  orderNumber: string;
}

export interface PackTaskResult {
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
}

export interface TaskItemForVerify {
  id: string;
  taskId: string;
  orderId: string | null;
  quantityRequired: number;
  status: string;
  task: {
    taskNumber: string;
    type: string;
    status: string;
    totalItems: number;
    startedAt: Date | null;
  };
  productVariant: { sku: string } | null;
  order: { orderNumber: string } | null;
}

export interface VerifyPackParams {
  userId?: string;
}

export interface VerifyPackDbResult {
  completedCount: number;
  allVerified: boolean;
}

export interface CompletePackingParams {
  weight: number;
  weightUnit: string;
  dimensions?: { length: number; width: number; height: number; unit: string };
  userId?: string;
  orderId: string;
}

export interface PickBinForVerification {
  id: string;
  binNumber: string;
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
    };
  }>;
}

export interface PickBinForCompletion {
  id: string;
  binNumber: string;
  status: string;
  orderId: string;
  items: Array<{
    id: string;
    sku: string;
    quantity: number;
    verifiedQty: number;
  }>;
}

export interface CompletePackingFromBinParams {
  orderId: string;
  binId: string;
  binNumber: string;
  orderNumber: string;
  weight: number;
  weightUnit: string;
  dimensions?: { length: number; width: number; height: number; unit: string };
  userId?: string;
  binItems: Array<{ productVariantId: string; quantity: number }>;
  orderItems: Array<{ id: string; productVariantId: string | null }>;
  taskNumber: string;
}

// =============================================================================
// Repository Implementation
// =============================================================================

export const packingRepository: PackingRepository = {
  async findOrderForPacking(orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { productVariant: true } } },
    });
    if (!order) return null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map((i) => ({
        id: i.id,
        productVariantId: i.productVariantId,
        productVariant: i.productVariant
          ? {
              id: i.productVariant.id,
              sku: i.productVariant.sku,
              name: i.productVariant.name,
            }
          : null,
      })),
    };
  },

  async findActivePackTask(orderId) {
    return prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PACKING",
        status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
      select: { taskNumber: true },
    });
  },

  async findCompletedPickTask(orderId) {
    const pickTask = await prisma.workTask.findFirst({
      where: {
        orderIds: { has: orderId },
        type: "PICKING",
        status: "COMPLETED",
      },
      include: {
        taskItems: {
          where: { status: "COMPLETED" },
          orderBy: { sequence: "asc" },
          include: { productVariant: true },
        },
      },
      orderBy: { completedAt: "desc" },
    });
    if (!pickTask) return null;
    return {
      id: pickTask.id,
      taskItems: pickTask.taskItems.map((ti) => ({
        id: ti.id,
        sequence: ti.sequence,
        orderItemId: ti.orderItemId,
        productVariantId: ti.productVariantId,
        locationId: ti.locationId,
        quantityCompleted: ti.quantityCompleted,
        productVariant: ti.productVariant
          ? { sku: ti.productVariant.sku, name: ti.productVariant.name }
          : null,
      })),
    };
  },

  async createPackTask(params) {
    const { taskNumber, orderId, pickItems, userId, orderNumber } = params;
    return prisma.$transaction(async (tx) => {
      const workTask = await tx.workTask.create({
        data: {
          taskNumber,
          type: "PACKING",
          status: "PENDING",
          orderIds: [orderId],
          totalOrders: 1,
          totalItems: pickItems.length,
          taskItems: {
            create: pickItems.map((pi, idx) => ({
              orderId,
              orderItemId: pi.orderItemId,
              productVariantId: pi.productVariantId,
              locationId: pi.locationId,
              sequence: idx + 1,
              quantityRequired: pi.quantityCompleted,
            })),
          },
          events: {
            create: {
              eventType: "TASK_CREATED",
              userId,
              data: {
                orderNumber,
                itemCount: pickItems.length,
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
      await tx.order.update({
        where: { id: orderId },
        data: { status: "PACKING" },
      });
      return workTask as unknown as PackTaskResult;
    });
  },

  async findTaskItemForVerify(taskItemId) {
    const item = await prisma.taskItem.findUnique({
      where: { id: taskItemId },
      include: { task: true, productVariant: true, order: true },
    });
    if (!item) return null;
    return {
      id: item.id,
      taskId: item.taskId,
      orderId: item.orderId,
      quantityRequired: item.quantityRequired,
      status: item.status,
      task: {
        taskNumber: item.task.taskNumber,
        type: item.task.type,
        status: item.task.status,
        totalItems: item.task.totalItems,
        startedAt: item.task.startedAt,
      },
      productVariant: item.productVariant
        ? { sku: item.productVariant.sku }
        : null,
      order: item.order ? { orderNumber: item.order.orderNumber } : null,
    };
  },

  async verifyPackItem(taskItemId, params) {
    const taskItem = await prisma.taskItem.findUnique({
      where: { id: taskItemId },
      include: { task: true, productVariant: true },
    });
    if (!taskItem) throw new Error(`TaskItem ${taskItemId} not found`);
    return prisma.$transaction(async (tx) => {
      await tx.taskItem.update({
        where: { id: taskItemId },
        data: {
          status: "COMPLETED",
          quantityCompleted: taskItem.quantityRequired,
          completedBy: params.userId,
          completedAt: new Date(),
          itemScanned: true,
        },
      });
      const completedCount = await tx.taskItem.count({
        where: { taskId: taskItem.taskId, status: "COMPLETED" },
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
          userId: params.userId,
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
  },

  async completePacking(taskId, params) {
    const { weight, weightUnit, dimensions, userId, orderId } = params;
    await prisma.$transaction(async (tx) => {
      await tx.workTask.update({
        where: { id: taskId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedOrders: 1,
          packedWeight: weight,
          packedWeightUnit: weightUnit,
          packedDimensions:
            (dimensions as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          verifiedAt: new Date(),
          verifiedBy: userId,
        },
      });
      if (orderId)
        await tx.order.update({
          where: { id: orderId },
          data: { status: "PACKED" },
        });
      await tx.taskEvent.create({
        data: {
          taskId,
          eventType: "TASK_COMPLETED",
          userId,
          data: { weight, weightUnit, dimensions, type: "PACKING_COMPLETED" },
        },
      });
    });
  },

  async findPickBinForVerification(binId) {
    return prisma.pickBin.findUnique({
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
    }) as Promise<PickBinForVerification | null>;
  },

  async incrementBinItemVerifiedQty(itemId, userId) {
    const updated = await prisma.pickBinItem.update({
      where: { id: itemId },
      data: {
        verifiedQty: { increment: 1 },
        verifiedAt: new Date(),
        verifiedBy: userId,
      },
    });
    return { verifiedQty: updated.verifiedQty };
  },

  async findPickBinItems(binId) {
    return prisma.pickBinItem.findMany({
      where: { pickBinId: binId },
      select: { id: true, verifiedQty: true, quantity: true },
    });
  },

  async findPickBinForCompletion(binId) {
    return prisma.pickBin.findUnique({
      where: { id: binId },
      include: { items: true },
    }) as Promise<PickBinForCompletion | null>;
  },

  async completeBin(binId, userId) {
    await prisma.pickBin.update({
      where: { id: binId },
      data: { status: "COMPLETED", packedBy: userId, packedAt: new Date() },
    });
  },

  async completePackingFromBin(params) {
    const {
      orderId,
      binId,
      binNumber,
      orderNumber,
      weight,
      weightUnit,
      dimensions,
      userId,
      binItems,
      orderItems,
      taskNumber,
    } = params;
    await prisma.$transaction(async (tx) => {
      await tx.allocation.updateMany({
        where: { orderItem: { orderId }, status: "ALLOCATED" },
        data: { status: "PICKED", pickedAt: new Date() },
      });
      for (const binItem of binItems) {
        const orderItem = orderItems.find(
          (oi) => oi.productVariantId === binItem.productVariantId,
        );
        if (orderItem)
          await tx.orderItem.update({
            where: { id: orderItem.id },
            data: { quantityPicked: binItem.quantity },
          });
      }
      await tx.pickBin.update({
        where: { id: binId },
        data: { status: "COMPLETED", packedBy: userId, packedAt: new Date() },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: "PACKED" },
      });
      await tx.workTask.create({
        data: {
          taskNumber,
          type: "PACKING",
          status: "COMPLETED",
          orderIds: [orderId],
          totalOrders: 1,
          totalItems: binItems.length,
          completedItems: binItems.length,
          completedOrders: 1,
          completedAt: new Date(),
          startedAt: new Date(),
          packedWeight: weight,
          packedWeightUnit: weightUnit ?? "ounce",
          packedDimensions:
            (dimensions as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          verifiedAt: new Date(),
          verifiedBy: userId,
          events: {
            create: {
              eventType: "TASK_COMPLETED",
              userId,
              data: {
                binId,
                binNumber,
                weight,
                weightUnit: weightUnit ?? "ounce",
                dimensions,
                type: "PACKING_FROM_BIN",
              },
            },
          },
        },
      });
    });
  },
};
