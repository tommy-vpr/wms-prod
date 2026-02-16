/**
 * OrderPackage Repository
 * Persistence layer for order package recommendations, packing assignments, and lifecycle
 *
 * Save to: packages/db/src/repositories/order-package.repo.ts
 */

import { prisma } from "../client.js";

// =============================================================================
// Types
// =============================================================================

export interface OrderPackageRepository {
  findOrderItemsWithDimensions(
    orderId: string,
  ): Promise<OrderItemWithDimensions[]>;
  deleteDraftPackages(orderId: string): Promise<number>;
  createPackages(
    orderId: string,
    packages: CreatePackageInput[],
  ): Promise<OrderPackageRecord[]>;
  findByOrderId(orderId: string): Promise<OrderPackageRecord[]>;
  updatePackage(
    packageId: string,
    data: UpdatePackageInput,
  ): Promise<OrderPackageRecord>;
  replacePackageItems(
    packageId: string,
    items: CreatePackageItemInput[],
  ): Promise<void>;
  markPacked(orderId: string, packData: PackedPackageInput[]): Promise<void>;
  markShipped(orderId: string): Promise<void>;
  deletePackage(packageId: string): Promise<void>;
  addPackage(orderId: string, sequence: number): Promise<OrderPackageRecord>;
}

export interface OrderItemWithDimensions {
  productVariantId: string;
  sku: string;
  name: string;
  quantity: number;
  weight: number | null;
  weightUnit: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string | null;
}

export interface CreatePackageInput {
  sequence: number;
  boxId: string | null;
  boxLabel: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string;
  estimatedWeight: number | null;
  weightUnit: string;
  items: CreatePackageItemInput[];
}

export interface CreatePackageItemInput {
  productVariantId: string;
  sku: string;
  quantity: number;
  unitWeight: number | null;
  unitWeightUnit: string | null;
}

export interface UpdatePackageInput {
  boxId?: string | null;
  boxLabel?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  actualWeight?: number | null;
  weightUnit?: string;
}

export interface PackedPackageInput {
  packageId: string;
  actualWeight: number;
  weightUnit?: string;
  length?: number;
  width?: number;
  height?: number;
}

export interface OrderPackageRecord {
  id: string;
  orderId: string;
  sequence: number;
  boxId: string | null;
  boxLabel: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string | null;
  estimatedWeight: number | null;
  actualWeight: number | null;
  weightUnit: string | null;
  status: string;
  items: OrderPackageItemRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderPackageItemRecord {
  id: string;
  orderPackageId: string;
  productVariantId: string;
  sku: string;
  quantity: number;
  unitWeight: number | null;
  unitWeightUnit: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

const includeItems = { items: true } as const;

function toRecord(row: any): OrderPackageRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    sequence: row.sequence,
    boxId: row.boxId,
    boxLabel: row.boxLabel,
    length: row.length ? Number(row.length) : null,
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
    dimensionUnit: row.dimensionUnit,
    estimatedWeight: row.estimatedWeight ? Number(row.estimatedWeight) : null,
    actualWeight: row.actualWeight ? Number(row.actualWeight) : null,
    weightUnit: row.weightUnit,
    status: row.status,
    items: (row.items ?? []).map(toItemRecord),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toItemRecord(row: any): OrderPackageItemRecord {
  return {
    id: row.id,
    orderPackageId: row.orderPackageId,
    productVariantId: row.productVariantId,
    sku: row.sku,
    quantity: row.quantity,
    unitWeight: row.unitWeight ? Number(row.unitWeight) : null,
    unitWeightUnit: row.unitWeightUnit,
  };
}

// =============================================================================
// Repository Implementation
// =============================================================================

export const orderPackageRepository: OrderPackageRepository = {
  async findOrderItemsWithDimensions(orderId) {
    const items = await prisma.orderItem.findMany({
      where: { orderId, matched: true, productVariantId: { not: null } },
      include: {
        productVariant: {
          select: {
            id: true,
            sku: true,
            name: true,
            weight: true,
            weightUnit: true,
            length: true,
            width: true,
            height: true,
            dimensionUnit: true,
          },
        },
      },
    });

    return items
      .filter((i) => i.productVariant)
      .map((i) => ({
        productVariantId: i.productVariant!.id,
        sku: i.productVariant!.sku,
        name: i.productVariant!.name,
        quantity: i.quantity,
        weight: i.productVariant!.weight
          ? Number(i.productVariant!.weight)
          : null,
        weightUnit: i.productVariant!.weightUnit,
        length: i.productVariant!.length
          ? Number(i.productVariant!.length)
          : null,
        width: i.productVariant!.width ? Number(i.productVariant!.width) : null,
        height: i.productVariant!.height
          ? Number(i.productVariant!.height)
          : null,
        dimensionUnit: i.productVariant!.dimensionUnit,
      }));
  },

  async deleteDraftPackages(orderId) {
    const result = await prisma.orderPackage.deleteMany({
      where: { orderId, status: "DRAFT" },
    });
    return result.count;
  },

  async createPackages(orderId, packages) {
    const created = await prisma.$transaction(
      packages.map((pkg) =>
        prisma.orderPackage.create({
          data: {
            orderId,
            sequence: pkg.sequence,
            boxId: pkg.boxId,
            boxLabel: pkg.boxLabel,
            length: pkg.length,
            width: pkg.width,
            height: pkg.height,
            dimensionUnit: pkg.dimensionUnit,
            estimatedWeight: pkg.estimatedWeight,
            weightUnit: pkg.weightUnit,
            status: "DRAFT",
            items: {
              create: pkg.items.map((item) => ({
                productVariantId: item.productVariantId,
                sku: item.sku,
                quantity: item.quantity,
                unitWeight: item.unitWeight,
                unitWeightUnit: item.unitWeightUnit,
              })),
            },
          },
          include: includeItems,
        }),
      ),
    );

    return created.map(toRecord);
  },

  async findByOrderId(orderId) {
    const packages = await prisma.orderPackage.findMany({
      where: { orderId },
      include: includeItems,
      orderBy: { sequence: "asc" },
    });

    return packages.map(toRecord);
  },

  async updatePackage(packageId, data) {
    const updated = await prisma.orderPackage.update({
      where: { id: packageId },
      data: {
        ...(data.boxId !== undefined && { boxId: data.boxId }),
        ...(data.boxLabel !== undefined && { boxLabel: data.boxLabel }),
        ...(data.length !== undefined && { length: data.length }),
        ...(data.width !== undefined && { width: data.width }),
        ...(data.height !== undefined && { height: data.height }),
        ...(data.actualWeight !== undefined && {
          actualWeight: data.actualWeight,
        }),
        ...(data.weightUnit !== undefined && { weightUnit: data.weightUnit }),
      },
      include: includeItems,
    });

    return toRecord(updated);
  },

  async replacePackageItems(packageId, items) {
    await prisma.$transaction([
      prisma.orderPackageItem.deleteMany({
        where: { orderPackageId: packageId },
      }),
      ...items.map((item) =>
        prisma.orderPackageItem.create({
          data: {
            orderPackageId: packageId,
            productVariantId: item.productVariantId,
            sku: item.sku,
            quantity: item.quantity,
            unitWeight: item.unitWeight,
            unitWeightUnit: item.unitWeightUnit,
          },
        }),
      ),
    ]);
  },

  async markPacked(orderId, packData) {
    await prisma.$transaction(
      packData.map((pd) =>
        prisma.orderPackage.update({
          where: { id: pd.packageId },
          data: {
            status: "PACKED",
            actualWeight: pd.actualWeight,
            weightUnit: pd.weightUnit ?? "oz",
            ...(pd.length != null && { length: pd.length }),
            ...(pd.width != null && { width: pd.width }),
            ...(pd.height != null && { height: pd.height }),
          },
        }),
      ),
    );
  },

  async markShipped(orderId) {
    await prisma.orderPackage.updateMany({
      where: { orderId, status: "PACKED" },
      data: { status: "SHIPPED" },
    });
  },

  async deletePackage(packageId) {
    await prisma.orderPackage.delete({
      where: { id: packageId },
    });
  },

  async addPackage(orderId, sequence) {
    const created = await prisma.orderPackage.create({
      data: {
        orderId,
        sequence,
        status: "DRAFT",
        weightUnit: "oz",
        dimensionUnit: "in",
      },
      include: includeItems,
    });

    return toRecord(created);
  },
};
