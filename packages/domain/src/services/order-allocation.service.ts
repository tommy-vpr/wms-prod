/**
 * Order Allocation Service
 * Handles inventory allocation for orders
 * Allocation is a logical reservation ONLY
 */

import { prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { randomUUID } from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface OrderAllocationResult {
  orderId: string;
  orderNumber: string;
  status: "ALLOCATED" | "PARTIALLY_ALLOCATED" | "BACKORDERED" | "ON_HOLD";
  previousStatus?: string;
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
          previousStatus: order.status,
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

      // ── Audit events for backorder transitions ──────────────────────────
      const previousStatus = order.status;
      const becameBackordered =
        newStatus === "BACKORDERED" && previousStatus !== "BACKORDERED";
      const resolvedFromBackorder =
        previousStatus === "BACKORDERED" && newStatus === "ALLOCATED";

      if (becameBackordered || resolvedFromBackorder) {
        await tx.fulfillmentEvent.create({
          data: {
            type: becameBackordered
              ? "order:backordered"
              : "order:backorder_resolved",
            payload: {
              orderId,
              orderNumber: order.orderNumber,
              previousStatus,
              newStatus,
              totalItems: order.items.length,
              allocatedItems: totalAllocated,
              backorderedItems: totalBackordered,
              timestamp: new Date().toISOString(),
            },
          },
        });
      }

      return {
        orderId,
        orderNumber: order.orderNumber,
        status: newStatus,
        previousStatus,
        totalItems: order.items.length,
        allocatedItems: totalAllocated,
        backorderedItems: totalBackordered,
        unmatchedItems: unmatchedItems.length,
        allocations,
      };
    });

    // ── Publish to real-time stream (outside transaction) ────────────────
    try {
      if (
        result.status === "BACKORDERED" &&
        result.previousStatus !== "BACKORDERED"
      ) {
        await publish({
          id: randomUUID(),
          type: EVENT_TYPES.ORDER_BACKORDERED,
          orderId: result.orderId,
          payload: {
            orderNumber: result.orderNumber,
            backorderedItems: result.backorderedItems,
          },
          timestamp: new Date().toISOString(),
        });
      } else if (
        result.previousStatus === "BACKORDERED" &&
        result.status === "ALLOCATED"
      ) {
        await publish({
          id: randomUUID(),
          type: EVENT_TYPES.ORDER_BACKORDER_RESOLVED,
          orderId: result.orderId,
          payload: {
            orderNumber: result.orderNumber,
            allocatedItems: result.allocatedItems,
          },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("[OrderAllocation] Pub/sub failed:", err);
    }

    return result;
  }

  /**
   * Find backordered/partially allocated orders that need a specific variant.
   * Called when new inventory arrives (receiving, adjustments).
   *
   * Escalates orders backordered for more than MAX_BACKORDER_DAYS to ON_HOLD
   * so they don't retry forever.  Returns only non-stale orders for retry.
   */
  async checkBackorderedOrders(productVariantId: string): Promise<string[]> {
    const MAX_BACKORDER_DAYS = 30;
    const MAX_RETRY_BATCH = 20; // prevent queue floods

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_BACKORDER_DAYS);

    // ── Escalate stale backorders to ON_HOLD ──────────────────────────────
    await prisma.order.updateMany({
      where: {
        status: "BACKORDERED",
        updatedAt: { lt: cutoffDate },
        items: {
          some: {
            productVariantId,
            matched: true,
          },
        },
      },
      data: {
        status: "ON_HOLD",
        holdReason: `Backordered for more than ${MAX_BACKORDER_DAYS} days — manual review required`,
        holdAt: new Date(),
      },
    });

    // ── Find eligible orders for retry ────────────────────────────────────
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
      orderBy: [
        { priority: "asc" }, // EXPRESS < RUSH < STANDARD (alphabetical = correct priority order)
        { createdAt: "asc" }, // FIFO within same priority
      ],
      take: MAX_RETRY_BATCH,
    });

    return orders.map((o) => o.id);
  }

  // ============================================================================
  // Split Backorder — ship what's allocated, backorder the rest
  // ============================================================================

  async splitBackorder(orderId: string): Promise<{
    originalOrderId: string;
    originalOrderNumber: string;
    originalStatus: string;
    backorderOrderId: string;
    backorderOrderNumber: string;
    shippableItems: number;
    backorderedItems: number;
  }> {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              allocations: {
                where: {
                  status: { in: ["ALLOCATED", "PARTIALLY_PICKED", "PICKED"] },
                },
              },
            },
          },
        },
      });

      if (!order) throw new Error(`Order not found: ${orderId}`);

      if (!["PARTIALLY_ALLOCATED", "BACKORDERED"].includes(order.status)) {
        throw new Error(
          `Order ${order.orderNumber} cannot be split (status: ${order.status}). ` +
            `Only PARTIALLY_ALLOCATED or BACKORDERED orders can be split.`,
        );
      }

      // Classify items: fully allocated vs needing backorder
      const allocatedItems = order.items.filter(
        (i) => i.quantityAllocated >= i.quantity,
      );
      const backorderItems = order.items.filter(
        (i) => i.quantityAllocated < i.quantity,
      );

      if (allocatedItems.length === 0) {
        throw new Error(
          `Order ${order.orderNumber} has no allocated items to ship`,
        );
      }
      if (backorderItems.length === 0) {
        throw new Error(
          `Order ${order.orderNumber} is fully allocated — no split needed`,
        );
      }

      // Generate backorder order number
      const backorderNumber = `${order.orderNumber}-BO1`;

      // Create the backorder order with unallocated items
      const backorderOrder = await tx.order.create({
        data: {
          orderNumber: backorderNumber,
          shopifyOrderId: order.shopifyOrderId
            ? `${order.shopifyOrderId}-BO`
            : null,
          customerId: order.customerId,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          shippingAddress: order.shippingAddress as any,
          billingAddress: order.billingAddress as any,
          shopifyLineItems: null,
          status: "BACKORDERED",
          paymentStatus: order.paymentStatus,
          priority: order.priority,
          totalAmount: 0, // Will recalculate below
          items: {
            create: backorderItems.map((item) => {
              const backorderQty = item.quantity - item.quantityAllocated;
              return {
                sku: item.sku,
                productVariantId: item.productVariantId,
                quantity: backorderQty,
                quantityAllocated: 0,
                quantityPicked: 0,
                quantityShipped: 0,
                unitPrice: item.unitPrice,
                totalPrice: item.unitPrice.mul(backorderQty),
                matched: item.matched,
                matchError: item.matchError,
                shopifyLineItemId: item.shopifyLineItemId,
              };
            }),
          },
        },
      });

      // Recalculate backorder total
      const backorderTotal = backorderItems.reduce((sum, item) => {
        const qty = item.quantity - item.quantityAllocated;
        return sum + Number(item.unitPrice) * qty;
      }, 0);

      await tx.order.update({
        where: { id: backorderOrder.id },
        data: { totalAmount: backorderTotal },
      });

      // Update original order: reduce quantities to only allocated amounts
      for (const item of backorderItems) {
        if (item.quantityAllocated > 0) {
          // Reduce quantity to what's allocated — item stays on original order
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              quantity: item.quantityAllocated,
              totalPrice: item.unitPrice.mul(item.quantityAllocated),
            },
          });
        } else {
          // Nothing allocated — remove from original order entirely
          // First release any allocations
          await tx.allocation.updateMany({
            where: { orderItemId: item.id },
            data: { status: "RELEASED", releasedAt: new Date() },
          });
          await tx.orderItem.delete({ where: { id: item.id } });
        }
      }

      // Recalculate original order total
      const remainingItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
      });
      const originalTotal = remainingItems.reduce(
        (sum, item) => sum + Number(item.unitPrice) * item.quantity,
        0,
      );

      // Move original order to ALLOCATED (everything remaining is allocated)
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "ALLOCATED",
          totalAmount: originalTotal,
          holdReason: null,
          holdAt: null,
        },
      });

      // Audit event
      await tx.fulfillmentEvent.create({
        data: {
          type: "order:split",
          payload: {
            originalOrderId: order.id,
            originalOrderNumber: order.orderNumber,
            backorderOrderId: backorderOrder.id,
            backorderOrderNumber: backorderNumber,
            shippableItems: allocatedItems.length,
            backorderedItems: backorderItems.length,
            timestamp: new Date().toISOString(),
          },
        },
      });

      return {
        originalOrderId: order.id,
        originalOrderNumber: order.orderNumber,
        originalStatus: "ALLOCATED",
        backorderOrderId: backorderOrder.id,
        backorderOrderNumber: backorderNumber,
        shippableItems: remainingItems.length,
        backorderedItems: backorderItems.length,
      };
    });

    // Publish real-time notification
    try {
      await publish({
        id: randomUUID(),
        type: EVENT_TYPES.ORDER_SPLIT,
        orderId: result.originalOrderId,
        payload: {
          originalOrderNumber: result.originalOrderNumber,
          backorderOrderNumber: result.backorderOrderNumber,
          backorderOrderId: result.backorderOrderId,
          shippableItems: result.shippableItems,
          backorderedItems: result.backorderedItems,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[OrderAllocation] Split pub/sub failed:", err);
    }

    return result;
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
