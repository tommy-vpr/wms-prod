/**
 * Order Allocation Service
 * Handles inventory allocation for orders
 * Allocation is a logical reservation ONLY
 */

import { prisma } from "@wms/db";

// ============================================================================
// Types
// ============================================================================

export interface OrderAllocationResult {
  orderId: string;
  orderNumber: string;
  status: "ALLOCATED" | "PARTIALLY_ALLOCATED" | "BACKORDERED" | "ON_HOLD";
  totalItems: number;
  allocatedItems: number;
  backorderedItems: number;
  unmatchedItems: number;
  allocations: OrderAllocationDetail[];
}

export interface OrderAllocationDetail {
  orderItemId: string;
  sku: string;
  quantityRequired: number;
  quantityAllocated: number;
  status: "FULL" | "PARTIAL" | "NONE" | "UNMATCHED";
}

export interface AllocateOrdersRequest {
  orderIds: string[];
  allowPartial?: boolean;
}

export interface AllocateOrdersResult {
  fullyAllocated: OrderAllocationResult[];
  partiallyAllocated: OrderAllocationResult[];
  backordered: OrderAllocationResult[];
  onHold: OrderAllocationResult[];
  errors: { orderId: string; error: string }[];
}

// ============================================================================
// Service
// ============================================================================

export class OrderAllocationService {
  async allocateOrders(
    request: AllocateOrdersRequest,
  ): Promise<AllocateOrdersResult> {
    const { orderIds, allowPartial = true } = request;

    const result: AllocateOrdersResult = {
      fullyAllocated: [],
      partiallyAllocated: [],
      backordered: [],
      onHold: [],
      errors: [],
    };

    for (const orderId of orderIds) {
      try {
        const allocation = await this.allocateOrder(orderId, allowPartial);

        switch (allocation.status) {
          case "ALLOCATED":
            result.fullyAllocated.push(allocation);
            break;
          case "PARTIALLY_ALLOCATED":
            result.partiallyAllocated.push(allocation);
            break;
          case "BACKORDERED":
            result.backordered.push(allocation);
            break;
          case "ON_HOLD":
            result.onHold.push(allocation);
            break;
        }
      } catch (err) {
        result.errors.push({
          orderId,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return result;
  }

  // ============================================================================
  // Allocate single order
  // ============================================================================

  async allocateOrder(
    orderId: string,
    allowPartial = true,
  ): Promise<OrderAllocationResult> {
    return prisma.$transaction(async (tx) => {
      // 1. Load order
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }

      if (
        ![
          "PENDING",
          "CONFIRMED",
          "BACKORDERED",
          "PARTIALLY_ALLOCATED",
        ].includes(order.status)
      ) {
        throw new Error(
          `Order ${order.orderNumber} cannot be allocated (status ${order.status})`,
        );
      }

      // 2. Unmatched handling
      const unmatchedItems = order.items.filter((i) => !i.matched);

      if (
        unmatchedItems.length > 0 &&
        unmatchedItems.length === order.items.length
      ) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: "ON_HOLD",
            holdReason: `All ${unmatchedItems.length} items unmatched`,
            holdAt: new Date(),
          },
        });

        return {
          orderId,
          orderNumber: order.orderNumber,
          status: "ON_HOLD",
          totalItems: order.items.length,
          allocatedItems: 0,
          backorderedItems: 0,
          unmatchedItems: unmatchedItems.length,
          allocations: order.items.map((i) => ({
            orderItemId: i.id,
            sku: i.sku,
            quantityRequired: i.quantity,
            quantityAllocated: 0,
            status: "UNMATCHED",
          })),
        };
      }

      // 3. Allocate items
      const allocations: OrderAllocationDetail[] = [];
      let totalAllocated = 0;
      let totalBackordered = 0;

      for (const item of order.items) {
        if (!item.matched || !item.productVariantId) {
          allocations.push({
            orderItemId: item.id,
            sku: item.sku,
            quantityRequired: item.quantity,
            quantityAllocated: 0,
            status: "UNMATCHED",
          });
          continue;
        }

        // 🔒 compute existing allocation from source of truth
        const existing = await tx.allocation.aggregate({
          where: {
            orderItemId: item.id,
            status: { in: ["ALLOCATED", "PARTIALLY_PICKED", "PICKED"] },
          },
          _sum: { quantity: true },
        });

        const alreadyAllocated = existing._sum.quantity ?? 0;
        const requiredQty = Math.max(0, item.quantity - alreadyAllocated);

        let remaining = requiredQty;
        let newlyAllocated = 0;

        if (remaining > 0) {
          const inventory = await tx.inventoryUnit.findMany({
            where: {
              productVariantId: item.productVariantId,
              status: "AVAILABLE",
            },
            orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
            include: {
              location: true,
              allocations: {
                where: {
                  status: { in: ["ALLOCATED", "PARTIALLY_PICKED", "PICKED"] },
                },
              },
            },
          });

          for (const inv of inventory) {
            if (remaining <= 0) break;
            if (!inv.location?.isPickable) continue;

            const reservedQty = inv.allocations.reduce(
              (sum, a) => sum + a.quantity,
              0,
            );

            const freeQty = inv.quantity - reservedQty;
            if (freeQty <= 0) continue;

            const allocateQty = Math.min(freeQty, remaining);

            await tx.allocation.create({
              data: {
                inventoryUnitId: inv.id,
                orderId: order.id,
                orderItemId: item.id,
                productVariantId: item.productVariantId,
                locationId: inv.locationId,
                quantity: allocateQty,
                lotNumber: inv.lotNumber,
                status: "ALLOCATED",
              },
            });

            remaining -= allocateQty;
            newlyAllocated += allocateQty;
          }
        }

        const finalAllocated = alreadyAllocated + newlyAllocated;
        totalAllocated += finalAllocated;

        if (remaining > 0) {
          totalBackordered += remaining;
        }

        const itemStatus: OrderAllocationDetail["status"] =
          finalAllocated >= item.quantity
            ? "FULL"
            : finalAllocated > 0
              ? "PARTIAL"
              : "NONE";

        allocations.push({
          orderItemId: item.id,
          sku: item.sku,
          quantityRequired: item.quantity,
          quantityAllocated: finalAllocated,
          status: itemStatus,
        });

        // overwrite cache
        await tx.orderItem.update({
          where: { id: item.id },
          data: { quantityAllocated: finalAllocated },
        });
      }

      // 4. Determine order status
      const matchedItems = order.items.filter((i) => i.matched);
      const totalRequired = matchedItems.reduce(
        (sum, i) => sum + i.quantity,
        0,
      );

      let newStatus: OrderAllocationResult["status"];

      if (unmatchedItems.length > 0) {
        newStatus = totalAllocated === 0 ? "ON_HOLD" : "PARTIALLY_ALLOCATED";
      } else if (totalAllocated === 0) {
        newStatus = "BACKORDERED";
      } else if (totalAllocated < totalRequired) {
        newStatus = allowPartial ? "PARTIALLY_ALLOCATED" : "BACKORDERED";
      } else {
        newStatus = "ALLOCATED";
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          ...(newStatus === "ON_HOLD" && {
            holdReason: `${unmatchedItems.length} unmatched, ${totalBackordered} backordered`,
            holdAt: new Date(),
          }),
        },
      });

      return {
        orderId,
        orderNumber: order.orderNumber,
        status: newStatus,
        totalItems: order.items.length,
        allocatedItems: totalAllocated,
        backorderedItems: totalBackordered,
        unmatchedItems: unmatchedItems.length,
        allocations,
      };
    });
  }

  /**
   * Find backordered/partially allocated orders that need a specific variant
   * Called when new inventory arrives (receiving, adjustments)
   */
  async checkBackorderedOrders(productVariantId: string): Promise<string[]> {
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ["BACKORDERED", "PARTIALLY_ALLOCATED"] },
        items: {
          some: {
            productVariantId,
            matched: true,
          },
        },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" }, // FIFO - oldest orders first
    });

    return orders.map((o) => o.id);
  }

  // ============================================================================
  // Release allocations
  // ============================================================================

  async releaseAllocations(orderId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const allocations = await tx.allocation.findMany({
        where: {
          orderId,
          status: { in: ["ALLOCATED", "PARTIALLY_PICKED", "PICKED"] },
        },
      });

      for (const alloc of allocations) {
        await tx.allocation.update({
          where: { id: alloc.id },
          data: {
            status: "RELEASED",
            releasedAt: new Date(),
          },
        });

        if (alloc.orderItemId) {
          const sum = await tx.allocation.aggregate({
            where: {
              orderItemId: alloc.orderItemId,
              status: { in: ["ALLOCATED", "PARTIALLY_PICKED", "PICKED"] },
            },
            _sum: { quantity: true },
          });

          await tx.orderItem.update({
            where: { id: alloc.orderItemId },
            data: { quantityAllocated: sum._sum.quantity ?? 0 },
          });
        }
      }
    });
  }
}

// Singleton
export const orderAllocationService = new OrderAllocationService();
