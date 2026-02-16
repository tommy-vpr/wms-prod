/**
 * Work Task Repository
 * Persistence layer for work tasks (picking, packing, etc.) and task items
 */

import { prisma } from "../client.js";
import type {
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskBlockReason,
  WorkTaskItemStatus,
  WorkTaskEventType,
  Prisma,
} from "@prisma/client";

export type {
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskBlockReason,
  WorkTaskItemStatus,
  WorkTaskEventType,
};

export interface WorkTask {
  id: string;
  taskNumber: string;
  type: WorkTaskType;
  status: WorkTaskStatus;
  priority: number;
  idempotencyKey: string | null;
  assignedTo: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  blockReason: WorkTaskBlockReason | null;
  blockedAt: Date | null;
  orderIds: string[];
  totalOrders: number;
  completedOrders: number;
  totalItems: number;
  completedItems: number;
  shortItems: number;
  skippedItems: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskItem {
  id: string;
  taskId: string;
  orderId: string | null; // ← CHANGED: Now optional for putaway tasks
  orderItemId: string | null;
  productVariantId: string | null;
  locationId: string | null;
  allocationId: string | null;
  sequence: number;
  quantityRequired: number;
  quantityCompleted: number;
  status: WorkTaskItemStatus;
  completedBy: string | null;
  completedAt: Date | null;
  shortReason: string | null;
  locationScanned: boolean;
  itemScanned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskItemWithDetails extends TaskItem {
  productVariant: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
  } | null;
  location: {
    id: string;
    name: string;
    barcode: string | null;
    zone: string | null;
  } | null;
  order: {
    // ← CHANGED: Now optional for putaway tasks
    id: string;
    orderNumber: string;
  } | null;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  eventType: WorkTaskEventType;
  userId: string | null;
  taskItemId: string | null;
  data: Prisma.JsonValue | null;
  createdAt: Date;
}

// ============================================================================
// Work Task Repository
// ============================================================================

export const workTaskRepository = {
  async create(data: {
    taskNumber: string;
    type: WorkTaskType;
    orderIds: string[];
    totalOrders: number;
    totalItems: number;
    priority?: number;
    idempotencyKey?: string;
    notes?: string;
  }): Promise<WorkTask> {
    return prisma.workTask.create({
      data: {
        ...data,
        status: "PENDING",
        priority: data.priority ?? 0,
      },
    });
  },

  async findById(id: string): Promise<WorkTask | null> {
    return prisma.workTask.findUnique({
      where: { id },
    });
  },

  async findByTaskNumber(taskNumber: string): Promise<WorkTask | null> {
    return prisma.workTask.findUnique({
      where: { taskNumber },
    });
  },

  async findByIdempotencyKey(key: string): Promise<WorkTask | null> {
    return prisma.workTask.findUnique({
      where: { idempotencyKey: key },
    });
  },

  async findByIdWithItems(
    id: string,
  ): Promise<(WorkTask & { taskItems: TaskItemWithDetails[] }) | null> {
    return prisma.workTask.findUnique({
      where: { id },
      include: {
        taskItems: {
          orderBy: { sequence: "asc" },
          include: {
            productVariant: {
              select: { id: true, sku: true, name: true, barcode: true },
            },
            location: {
              select: { id: true, name: true, barcode: true, zone: true },
            },
            order: {
              select: { id: true, orderNumber: true },
            },
          },
        },
      },
    });
  },

  async findByOrderId(orderId: string): Promise<WorkTask[]> {
    return prisma.workTask.findMany({
      where: {
        orderIds: { has: orderId },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async findByTypeAndStatus(
    type: WorkTaskType,
    status: WorkTaskStatus,
  ): Promise<WorkTask[]> {
    return prisma.workTask.findMany({
      where: { type, status },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  },

  async findByAssignee(userId: string, activeOnly = true): Promise<WorkTask[]> {
    return prisma.workTask.findMany({
      where: {
        assignedTo: userId,
        ...(activeOnly && {
          status: { in: ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "PAUSED"] },
        }),
      },
      orderBy: { assignedAt: "desc" },
    });
  },

  async findAvailableForAssignment(type: WorkTaskType): Promise<WorkTask[]> {
    return prisma.workTask.findMany({
      where: {
        type,
        status: "PENDING",
        assignedTo: null,
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  },

  async updateStatus(id: string, status: WorkTaskStatus): Promise<void> {
    const updateData: Prisma.WorkTaskUpdateInput = { status };

    if (status === "IN_PROGRESS") {
      updateData.startedAt = new Date();
    } else if (status === "COMPLETED" || status === "CANCELLED") {
      updateData.completedAt = new Date();
    }

    await prisma.workTask.update({
      where: { id },
      data: updateData,
    });
  },

  async assign(id: string, userId: string): Promise<void> {
    await prisma.workTask.update({
      where: { id },
      data: {
        assignedTo: userId,
        assignedAt: new Date(),
        status: "ASSIGNED",
      },
    });
  },

  async unassign(id: string): Promise<void> {
    await prisma.workTask.update({
      where: { id },
      data: {
        assignedTo: null,
        assignedAt: null,
        status: "PENDING",
      },
    });
  },

  async block(id: string, reason: WorkTaskBlockReason): Promise<void> {
    await prisma.workTask.update({
      where: { id },
      data: {
        status: "BLOCKED",
        blockReason: reason,
        blockedAt: new Date(),
      },
    });
  },

  async unblock(id: string): Promise<void> {
    await prisma.workTask.update({
      where: { id },
      data: {
        status: "IN_PROGRESS",
        blockReason: null,
        blockedAt: null,
      },
    });
  },

  async incrementProgress(
    id: string,
    field: "completedItems" | "shortItems" | "skippedItems" | "completedOrders",
  ): Promise<void> {
    await prisma.workTask.update({
      where: { id },
      data: {
        [field]: { increment: 1 },
      },
    });
  },

  async generateTaskNumber(type: WorkTaskType): Promise<string> {
    const prefix = type.substring(0, 3).toUpperCase();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await prisma.workTask.count({
      where: {
        taskNumber: { startsWith: `${prefix}-${date}` },
      },
    });
    return `${prefix}-${date}-${String(count + 1).padStart(4, "0")}`;
  },
};

// ============================================================================
// Task Item Repository
// ============================================================================

export const taskItemRepository = {
  async createMany(
    items: Omit<TaskItem, "id" | "createdAt" | "updatedAt">[],
  ): Promise<TaskItem[]> {
    return prisma.$transaction(
      items.map((item) =>
        prisma.taskItem.create({
          data: item,
        }),
      ),
    );
  },

  async findById(id: string): Promise<TaskItem | null> {
    return prisma.taskItem.findUnique({
      where: { id },
    });
  },

  async findByIdWithDetails(id: string): Promise<TaskItemWithDetails | null> {
    return prisma.taskItem.findUnique({
      where: { id },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, barcode: true, zone: true },
        },
        order: {
          select: { id: true, orderNumber: true },
        },
      },
    });
  },

  async findByTaskId(taskId: string): Promise<TaskItem[]> {
    return prisma.taskItem.findMany({
      where: { taskId },
      orderBy: { sequence: "asc" },
    });
  },

  async findByTaskIdWithDetails(
    taskId: string,
  ): Promise<TaskItemWithDetails[]> {
    return prisma.taskItem.findMany({
      where: { taskId },
      orderBy: { sequence: "asc" },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, barcode: true, zone: true },
        },
        order: {
          select: { id: true, orderNumber: true },
        },
      },
    });
  },

  async findPendingByTaskId(taskId: string): Promise<TaskItemWithDetails[]> {
    return prisma.taskItem.findMany({
      where: {
        taskId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      orderBy: { sequence: "asc" },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, barcode: true, zone: true },
        },
        order: {
          select: { id: true, orderNumber: true },
        },
      },
    });
  },

  async updateStatus(id: string, status: WorkTaskItemStatus): Promise<void> {
    await prisma.taskItem.update({
      where: { id },
      data: { status },
    });
  },

  async complete(
    id: string,
    data: {
      quantityCompleted: number;
      completedBy: string;
      status?: WorkTaskItemStatus;
      shortReason?: string;
    },
  ): Promise<void> {
    await prisma.taskItem.update({
      where: { id },
      data: {
        quantityCompleted: data.quantityCompleted,
        completedBy: data.completedBy,
        completedAt: new Date(),
        status: data.status ?? "COMPLETED",
        shortReason: data.shortReason,
      },
    });
  },

  async markLocationScanned(id: string): Promise<void> {
    await prisma.taskItem.update({
      where: { id },
      data: { locationScanned: true },
    });
  },

  async markItemScanned(id: string): Promise<void> {
    await prisma.taskItem.update({
      where: { id },
      data: { itemScanned: true },
    });
  },

  async getNextItem(taskId: string): Promise<TaskItemWithDetails | null> {
    return prisma.taskItem.findFirst({
      where: {
        taskId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      orderBy: { sequence: "asc" },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, barcode: true, zone: true },
        },
        order: {
          select: { id: true, orderNumber: true },
        },
      },
    });
  },
};

// ============================================================================
// Task Event Repository
// ============================================================================

export const taskEventRepository = {
  async create(data: {
    taskId: string;
    eventType: WorkTaskEventType;
    userId?: string;
    taskItemId?: string;
    data?: Prisma.InputJsonValue;
  }): Promise<TaskEvent> {
    return prisma.taskEvent.create({
      data,
    });
  },

  async findByTaskId(taskId: string): Promise<TaskEvent[]> {
    return prisma.taskEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
  },

  async findByTaskIdAndType(
    taskId: string,
    eventType: WorkTaskEventType,
  ): Promise<TaskEvent[]> {
    return prisma.taskEvent.findMany({
      where: { taskId, eventType },
      orderBy: { createdAt: "asc" },
    });
  },
};
