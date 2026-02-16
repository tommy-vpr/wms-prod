/**
 * Allocation Repository
 * Persistence layer for inventory allocations
 */

import { prisma } from "../client.js";
import type {
  AllocationStatus,
  Prisma,
} from "@prisma/client";

export type { AllocationStatus };

export interface Allocation {
  id: string;
  inventoryUnitId: string;
  orderId: string;
  orderItemId: string | null;
  productVariantId: string;
  locationId: string;
  quantity: number;
  lotNumber: string | null;
  status: AllocationStatus;
  allocatedAt: Date;
  releasedAt: Date | null;
  pickedAt: Date | null;
  taskItemId: string | null;
}

export interface AllocationWithDetails extends Allocation {
  inventoryUnit: {
    id: string;
    quantity: number;
    status: string;
  };
  productVariant: {
    id: string;
    sku: string;
    name: string;
  };
  location: {
    id: string;
    name: string;
    zone: string | null;
    pickSequence: number | null;
  };
}

export const allocationRepository = {
  async create(
    data: Omit<Allocation, "id" | "allocatedAt" | "releasedAt" | "pickedAt">,
  ): Promise<Allocation> {
    return prisma.allocation.create({
      data: {
        ...data,
        allocatedAt: new Date(),
      },
    });
  },

  async createMany(
    allocations: Omit<
      Allocation,
      "id" | "allocatedAt" | "releasedAt" | "pickedAt"
    >[],
  ): Promise<Allocation[]> {
    const now = new Date();

    // Use transaction for atomicity
    return prisma.$transaction(
      allocations.map((allocation) =>
        prisma.allocation.create({
          data: {
            ...allocation,
            allocatedAt: now,
          },
        }),
      ),
    );
  },

  async findById(id: string): Promise<Allocation | null> {
    return prisma.allocation.findUnique({
      where: { id },
    });
  },

  async findByIdWithDetails(id: string): Promise<AllocationWithDetails | null> {
    return prisma.allocation.findUnique({
      where: { id },
      include: {
        inventoryUnit: {
          select: { id: true, quantity: true, status: true },
        },
        productVariant: {
          select: { id: true, sku: true, name: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
    });
  },

  async findByOrderId(orderId: string): Promise<Allocation[]> {
    return prisma.allocation.findMany({
      where: { orderId },
      orderBy: { allocatedAt: "asc" },
    });
  },

  async findByOrderIdWithDetails(
    orderId: string,
  ): Promise<AllocationWithDetails[]> {
    return prisma.allocation.findMany({
      where: { orderId },
      include: {
        inventoryUnit: {
          select: { id: true, quantity: true, status: true },
        },
        productVariant: {
          select: { id: true, sku: true, name: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
      orderBy: { allocatedAt: "asc" },
    });
  },

  async findByInventoryUnitId(inventoryUnitId: string): Promise<Allocation[]> {
    return prisma.allocation.findMany({
      where: { inventoryUnitId },
    });
  },

  async findActiveByInventoryUnitId(
    inventoryUnitId: string,
  ): Promise<Allocation[]> {
    return prisma.allocation.findMany({
      where: {
        inventoryUnitId,
        status: { in: ["PENDING", "ALLOCATED", "PARTIALLY_PICKED"] },
      },
    });
  },

  async updateStatus(id: string, status: AllocationStatus): Promise<void> {
    const updateData: Prisma.AllocationUpdateInput = { status };

    if (status === "RELEASED" || status === "CANCELLED") {
      updateData.releasedAt = new Date();
    } else if (status === "PICKED") {
      updateData.pickedAt = new Date();
    }

    await prisma.allocation.update({
      where: { id },
      data: updateData,
    });
  },

  async releaseByOrderId(orderId: string): Promise<void> {
    await prisma.allocation.updateMany({
      where: {
        orderId,
        status: { in: ["PENDING", "ALLOCATED"] },
      },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
      },
    });
  },

  async linkToTaskItem(
    allocationId: string,
    taskItemId: string,
  ): Promise<void> {
    await prisma.allocation.update({
      where: { id: allocationId },
      data: { taskItemId },
    });
  },

  async findByTaskItemId(taskItemId: string): Promise<Allocation | null> {
    return prisma.allocation.findFirst({
      where: { taskItemId },
    });
  },

  async getActiveAllocationsByLocation(
    locationId: string,
  ): Promise<AllocationWithDetails[]> {
    return prisma.allocation.findMany({
      where: {
        locationId,
        status: { in: ["PENDING", "ALLOCATED", "PARTIALLY_PICKED"] },
      },
      include: {
        inventoryUnit: {
          select: { id: true, quantity: true, status: true },
        },
        productVariant: {
          select: { id: true, sku: true, name: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
    });
  },

  async getOrderAllocationSummary(orderId: string): Promise<{
    totalAllocated: number;
    totalPicked: number;
    totalReleased: number;
  }> {
    const allocations = await prisma.allocation.findMany({
      where: { orderId },
      select: { quantity: true, status: true },
    });

    return allocations.reduce(
      (acc, a) => {
        if (a.status === "ALLOCATED" || a.status === "PARTIALLY_PICKED") {
          acc.totalAllocated += a.quantity;
        } else if (a.status === "PICKED") {
          acc.totalPicked += a.quantity;
        } else if (a.status === "RELEASED" || a.status === "CANCELLED") {
          acc.totalReleased += a.quantity;
        }
        return acc;
      },
      { totalAllocated: 0, totalPicked: 0, totalReleased: 0 },
    );
  },
};
