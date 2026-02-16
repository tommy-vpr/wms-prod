/**
 * Inventory Repository
 * Persistence layer for inventory units
 */

import { prisma } from "../client.js";
import type {
  InventoryStatus,
  Prisma,
} from "@prisma/client";

export type { InventoryStatus };

export interface InventoryUnit {
  id: string;
  productVariantId: string;
  locationId: string;
  quantity: number;
  status: InventoryStatus;
  lotNumber: string | null;
  expiryDate: Date | null;
  receivedAt: Date;
  receivedFrom: string | null;
  unitCost: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryUnitWithDetails extends InventoryUnit {
  productVariant: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
  };
  location: {
    id: string;
    name: string;
    zone: string | null;
    pickSequence: number | null;
  };
}

export const inventoryRepository = {
  async findById(id: string): Promise<InventoryUnit | null> {
    return prisma.inventoryUnit.findUnique({
      where: { id },
    });
  },

  async findByIdWithDetails(
    id: string,
  ): Promise<InventoryUnitWithDetails | null> {
    return prisma.inventoryUnit.findUnique({
      where: { id },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
    });
  },

  async findByProductVariant(
    productVariantId: string,
  ): Promise<InventoryUnit[]> {
    return prisma.inventoryUnit.findMany({
      where: { productVariantId },
      orderBy: { receivedAt: "asc" },
    });
  },

  async findAvailableByProductVariant(
    productVariantId: string,
  ): Promise<InventoryUnitWithDetails[]> {
    return prisma.inventoryUnit.findMany({
      where: {
        productVariantId,
        status: "AVAILABLE",
        quantity: { gt: 0 },
      },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
      orderBy: { receivedAt: "asc" }, // FIFO default
    });
  },

  async findAvailableBySku(sku: string): Promise<InventoryUnitWithDetails[]> {
    return prisma.inventoryUnit.findMany({
      where: {
        productVariant: { sku },
        status: "AVAILABLE",
        quantity: { gt: 0 },
      },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
      orderBy: { receivedAt: "asc" },
    });
  },

  async findByLocation(locationId: string): Promise<InventoryUnit[]> {
    return prisma.inventoryUnit.findMany({
      where: { locationId },
    });
  },

  async findByLocationWithDetails(
    locationId: string,
  ): Promise<InventoryUnitWithDetails[]> {
    return prisma.inventoryUnit.findMany({
      where: { locationId },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
    });
  },

  async updateStatus(id: string, status: InventoryStatus): Promise<void> {
    await prisma.inventoryUnit.update({
      where: { id },
      data: { status },
    });
  },

  async updateQuantity(id: string, quantity: number): Promise<void> {
    await prisma.inventoryUnit.update({
      where: { id },
      data: { quantity },
    });
  },

  async decrementQuantity(id: string, amount: number): Promise<void> {
    await prisma.inventoryUnit.update({
      where: { id },
      data: {
        quantity: { decrement: amount },
      },
    });
  },

  async incrementQuantity(id: string, amount: number): Promise<void> {
    await prisma.inventoryUnit.update({
      where: { id },
      data: {
        quantity: { increment: amount },
      },
    });
  },

  async create(data: {
    productVariantId: string;
    locationId: string;
    quantity: number;
    status?: InventoryStatus;
    lotNumber?: string;
    expiryDate?: Date;
    receivedFrom?: string;
    unitCost?: number;
  }): Promise<InventoryUnit> {
    return prisma.inventoryUnit.create({
      data: {
        ...data,
        status: data.status ?? "AVAILABLE",
        receivedAt: new Date(),
      },
    });
  },

  async getTotalAvailableByProductVariant(
    productVariantId: string,
  ): Promise<number> {
    const result = await prisma.inventoryUnit.aggregate({
      where: {
        productVariantId,
        status: "AVAILABLE",
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  },

  async getExpiringInventory(
    daysUntilExpiry: number,
  ): Promise<InventoryUnitWithDetails[]> {
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + daysUntilExpiry);

    return prisma.inventoryUnit.findMany({
      where: {
        status: "AVAILABLE",
        expiryDate: {
          lte: expiryThreshold,
          not: null,
        },
      },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
      orderBy: { expiryDate: "asc" },
    });
  },
};
