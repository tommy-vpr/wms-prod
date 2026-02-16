/**
 * Fulfillment Repository
 * Read-only persistence layer for fulfillment status queries and event replay
 *
 * Save to: packages/db/src/repositories/fulfillment.repo.ts
 */

import { prisma } from "../client.js";

// =============================================================================
// Types
// =============================================================================

export interface FulfillmentRepository {
  getFulfillmentStatusData(orderId: string): Promise<FulfillmentStatusData>;
  findEventById(eventId: string): Promise<{ createdAt: Date } | null>;
  findEventsSince(
    orderId: string,
    since?: Date,
  ): Promise<FulfillmentEventRow[]>;
}

export interface FulfillmentStatusData {
  order: FulfillmentOrder | null;
  pickTasks: FulfillmentWorkTask[];
  packTasks: FulfillmentWorkTask[];
  labels: FulfillmentShippingPackage[];
  events: FulfillmentEventRow[];
  pickBin: FulfillmentPickBin | null;
}

export interface FulfillmentOrder {
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
  packingImages: Array<{
    id: string;
    url: string;
    filename: string;
    notes: string | null;
    createdAt: Date;
    uploader: { id: string; name: string | null };
  }>;
}

export interface FulfillmentWorkTask {
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
  }>;
  [key: string]: unknown;
}

export interface FulfillmentShippingPackage {
  id: string;
  orderId: string;
  carrierCode: string;
  serviceCode: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  cost: unknown;
  voidedAt: Date | null;
  createdAt: Date;
}

export interface FulfillmentEventRow {
  id: string;
  orderId: string | null;
  type: string;
  payload: unknown;
  correlationId: string | null;
  userId: string | null;
  createdAt: Date;
}

export interface FulfillmentPickBin {
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
}

// =============================================================================
// Repository Implementation
// =============================================================================

export const fulfillmentRepository: FulfillmentRepository = {
  async getFulfillmentStatusData(orderId) {
    const [order, pickTasks, packTasks, labels, events, pickBin] =
      await Promise.all([
        prisma.order.findUnique({
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
                uploader: { select: { id: true, name: true } },
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
        prisma.workTask.findMany({
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
        prisma.workTask.findMany({
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
        prisma.shippingPackage.findMany({
          where: { orderId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.fulfillmentEvent.findMany({
          where: { orderId },
          orderBy: { createdAt: "asc" },
          take: 100,
        }),
        prisma.pickBin.findFirst({
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

    return {
      order: order as FulfillmentOrder | null,
      pickTasks: pickTasks as unknown as FulfillmentWorkTask[],
      packTasks: packTasks as unknown as FulfillmentWorkTask[],
      labels: labels as unknown as FulfillmentShippingPackage[],
      events: events as FulfillmentEventRow[],
      pickBin: pickBin as unknown as FulfillmentPickBin | null,
    };
  },

  async findEventById(eventId) {
    return prisma.fulfillmentEvent.findUnique({
      where: { id: eventId },
      select: { createdAt: true },
    });
  },

  async findEventsSince(orderId, since) {
    return prisma.fulfillmentEvent.findMany({
      where: { orderId, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  },
};
