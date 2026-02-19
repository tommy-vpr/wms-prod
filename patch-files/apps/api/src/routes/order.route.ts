/**
 * Order Routes
 * Uses domain services for business logic
 *
 * Save to: apps/api/src/routes/order.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma, orderRepository, Prisma } from "@wms/db";
import {
  OrderService,
  orderAllocationService,
  OrderPackageService,
  BoxRecommendationService,
} from "@wms/domain";
import { orderPackageRepository } from "@wms/db";

const orderPackageService = new OrderPackageService(
  orderPackageRepository,
  new BoxRecommendationService(),
);
// Adapter to match OrderService's OrderRepository interface
const orderServiceRepo = {
  async findById(id: string) {
    const order = await orderRepository.findByIdWithItems(id);
    if (!order) return null;

    return {
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      warehouseId: order.warehouseId ?? undefined,
      customerId: order.customerId ?? "",
      holdReason: order.holdReason ?? undefined,
      items: order.items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
      createdAt: order.createdAt,
    };
  },

  async findByIds(ids: string[]) {
    const orders = await orderRepository.findByIds(ids);
    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      warehouseId: order.warehouseId ?? undefined,
      customerId: order.customerId ?? "",
      holdReason: order.holdReason ?? undefined,
      items: order.items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
      createdAt: order.createdAt,
    }));
  },

  updateStatus: orderRepository.updateStatus,

  async setHold(id: string, reason: string) {
    await orderRepository.setHold(id, reason);
  },

  async releaseHold(id: string) {
    // Determine target status
    const allocations = await prisma.allocation.count({
      where: { orderId: id, status: "ALLOCATED" },
    });
    const targetStatus = allocations > 0 ? "ALLOCATED" : "PENDING";
    await orderRepository.releaseHold(id, targetStatus as any);
  },
};

// Initialize order service with adapter
const orderService = new OrderService({
  orderRepo: orderServiceRepo,
});

export const orderRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /orders
   * List orders with pagination and filters
   */
  app.get<{
    Querystring: {
      skip?: string;
      take?: string;
      status?: string;
      q?: string;
    };
  }>("/", async (request, reply) => {
    const { skip = "0", take = "20", status, q } = request.query;

    const where: Prisma.OrderWhereInput = {};

    if (status) {
      const statuses = status
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        where.status = statuses[0] as any;
      } else if (statuses.length > 1) {
        where.status = { in: statuses as any };
      }
    }

    if (q) {
      where.OR = [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { shopifyOrderId: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: true,
        },
        orderBy: { createdAt: "desc" },
        skip: Number(skip),
        take: Number(take),
      }),
      prisma.order.count({ where }),
    ]);

    // Transform for frontend
    const transformedOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      externalId: order.shopifyOrderId,
      source: order.shopifyOrderId ? "SHOPIFY" : "MANUAL",
      status: order.status,
      priority: order.priority,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      shippingAddress: order.shippingAddress,
      totalAmount: Number(order.totalAmount),
      unmatchedItems: order.unmatchedItems,
      holdReason: order.holdReason,
      lineItems: order.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.sku,
        quantity: item.quantity,
        quantityAllocated: item.quantityAllocated,
        quantityPicked: item.quantityPicked,
        quantityShipped: item.quantityShipped ?? 0,
        unitPrice: Number(item.unitPrice),
        matched: item.matched,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    }));

    return reply.send({ orders: transformedOrders, total });
  });

  /**
   * GET /orders/stats
   * Get order statistics
   */
  app.get("/stats", async (request, reply) => {
    const [
      total,
      pending,
      allocated,
      picking,
      packed,
      shipped,
      onHold,
      backordered,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({
        where: { status: { in: ["PENDING", "CONFIRMED"] } },
      }),
      prisma.order.count({
        where: {
          status: {
            in: ["ALLOCATED", "PARTIALLY_ALLOCATED", "READY_TO_PICK"],
          },
        },
      }),
      prisma.order.count({
        where: { status: { in: ["PICKING", "PICKED"] } },
      }),
      prisma.order.count({
        where: { status: { in: ["PACKING", "PACKED"] } },
      }),
      prisma.order.count({ where: { status: "SHIPPED" } }),
      prisma.order.count({ where: { status: "ON_HOLD" } }),
      prisma.order.count({ where: { status: "BACKORDERED" } }),
    ]);

    return reply.send({
      total,
      pending,
      allocated,
      picking,
      packed,
      shipped,
      onHold,
      backordered,
    });
  });

  /**
   * GET /orders/unmatched
   * Get orders with unmatched items
   */
  app.get("/unmatched", async (request, reply) => {
    const orders = await orderRepository.findWithUnmatchedItems();

    return reply.send({
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        unmatchedItems: order.unmatchedItems,
        items: order.items
          .filter((item) => !item.matched)
          .map((item) => ({
            id: item.id,
            sku: item.sku,
            quantity: item.quantity,
            matchError: item.matchError,
          })),
        createdAt: order.createdAt,
      })),
      total: orders.length,
    });
  });

  /**
   * GET /orders/counts
   * Get count of orders per status (for fulfillment filter tabs)
   */
  app.get("/counts", async (request, reply) => {
    const statuses = [
      "PENDING",
      "CONFIRMED",
      "ALLOCATED",
      "PARTIALLY_ALLOCATED",
      "READY_TO_PICK",
      "PICKING",
      "PICKED",
      "PACKING",
      "PACKED",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "ON_HOLD",
    ];

    const results = await Promise.all(
      statuses.map(async (status) => {
        const count = await prisma.order.count({
          where: { status: status as any },
        });
        return [status, count] as const;
      }),
    );

    const counts: Record<string, number> = {};
    for (const [status, count] of results) {
      counts[status] = count;
    }

    return reply.send({ counts });
  });

  /**
   * GET /orders/:id
   * Get order by ID with items and tasks
   */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        packingImages: {
          include: {
            uploader: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        items: {
          include: {
            productVariant: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        },
        allocations: {
          include: {
            location: {
              select: { id: true, name: true },
            },
          },
        },
        shippingPackages: {
          include: {
            items: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({ error: "Order not found" });
    }

    // Fetch fulfillment events separately (not on Order model directly)
    const [fulfillmentEvents, workTasks] = await Promise.all([
      prisma.fulfillmentEvent.findMany({
        where: { orderId: id },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
      // Query WorkTasks directly by orderIds array — catches both PICKING and PACKING
      prisma.workTask.findMany({
        where: { orderIds: { has: id } },
        include: {
          assignedUser: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // Parse shipping address from JSON
    const shippingAddr = order.shippingAddress as any;

    // Transform response
    const response = {
      id: order.id,
      orderNumber: order.orderNumber,
      externalId: order.shopifyOrderId,
      source: order.shopifyOrderId ? "SHOPIFY" : "MANUAL",
      status: order.status,
      priority: order.priority,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      // Shipping address fields
      shippingName: shippingAddr?.name || order.customerName,
      shippingAddress1: shippingAddr?.address1,
      shippingAddress2: shippingAddr?.address2,
      shippingCity: shippingAddr?.city,
      shippingState: shippingAddr?.province || shippingAddr?.state,
      shippingZip: shippingAddr?.zip || shippingAddr?.postalCode,
      shippingCountry: shippingAddr?.country,
      shippingPhone: shippingAddr?.phone,
      // Hold info
      holdReason: order.holdReason,
      holdAt: order.holdAt,
      // Tracking
      trackingNumber: order.trackingNumber,
      shippedAt: order.shippedAt,
      // Totals
      totalAmount: Number(order.totalAmount),
      unmatchedItems: order.unmatchedItems,
      // Packing images
      packingImages: order.packingImages.map((img) => ({
        id: img.id,
        url: img.url,
        filename: img.filename,
        size: img.size,
        contentType: img.contentType,
        notes: img.notes,
        reference: img.reference,
        uploadedAt: img.createdAt,
        uploadedBy: {
          id: img.uploader.id,
          name: img.uploader.name,
        },
      })),
      // Line items with allocation status
      lineItems: order.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.productVariant?.name || item.sku,
        quantity: item.quantity,
        quantityAllocated: item.quantityAllocated,
        quantityPicked: item.quantityPicked,
        quantityShipped: item.quantityShipped ?? 0,
        unitPrice: Number(item.unitPrice),
        productVariantId: item.productVariantId,
        allocationStatus: getAllocationStatus(item, order.status), // ← Pass order.status
        matched: item.matched,
        matchError: item.matchError,
      })),
      // Allocations for detail view
      allocations: order.allocations.map((alloc) => ({
        id: alloc.id,
        quantity: alloc.quantity,
        status: alloc.status,
        location: alloc.location,
        lotNumber: alloc.lotNumber,
      })),
      // Work tasks (queried directly by orderIds)
      workTasks: workTasks.map((task) => ({
        id: task.id,
        taskNumber: task.taskNumber,
        type: task.type,
        status: task.status,
        assignedTo: task.assignedUser,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        totalItems: task.totalItems,
        completedItems: task.completedItems,
        shortItems: task.shortItems,
        createdAt: task.createdAt,
      })),
      // Shipping packages + items
      shippingPackages: (order.shippingPackages || []).map((pkg) => ({
        id: pkg.id,
        carrierCode: pkg.carrierCode,
        serviceCode: pkg.serviceCode,
        packageCode: pkg.packageCode,
        trackingNumber: pkg.trackingNumber,
        labelUrl: pkg.labelUrl,
        cost: Number(pkg.cost),
        weight: pkg.weight ? Number(pkg.weight) : null,
        dimensions: pkg.dimensions as any,
        voidedAt: pkg.voidedAt,
        shippedAt: pkg.shippedAt,
        items: pkg.items.map((item) => ({
          id: item.id,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
        })),
        createdAt: pkg.createdAt,
      })),
      // Fulfillment events
      fulfillmentEvents: fulfillmentEvents.map((evt) => ({
        id: evt.id,
        type: evt.type,
        payload: evt.payload,
        correlationId: evt.correlationId,
        createdAt: evt.createdAt,
      })),
      // Timestamps
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };

    return reply.send(response);
  });

  /**
   * POST /orders/:id/check-eligibility
   * Check if order is eligible for picking
   */
  app.post<{ Params: { id: string } }>(
    "/:id/check-eligibility",
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await orderService.checkEligibility(id);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/allocate
   * Allocate inventory for an order
   */
  app.post<{ Params: { id: string }; Body: { allowPartial?: boolean } }>(
    "/:id/allocate",
    async (request, reply) => {
      const { id } = request.params;
      const { allowPartial = true } = request.body || {};

      try {
        const result = await orderAllocationService.allocateOrder(
          id,
          allowPartial,
        );

        // Generate box recommendations after successful allocation
        if (result.status === "ALLOCATED") {
          try {
            const { recommendation, packages } =
              await orderPackageService.recommendAndSave(id);
            console.log(
              `[Orders] Box recommendation for order: ${packages.length} package(s)`,
            );
          } catch (err) {
            console.error("[Orders] Box recommendation failed:", err);
          }
        }

        return reply.send({
          success: true,
          status: result.status,
          totalItems: result.totalItems,
          allocatedItems: result.allocatedItems,
          backorderedItems: result.backorderedItems,
          unmatchedItems: result.unmatchedItems,
          allocations: result.allocations,
        });
      } catch (error: any) {
        app.log.error(error, "Allocation failed");
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/ready-to-pick
   * Mark order as ready to pick (after eligibility check)
   */
  app.post<{ Params: { id: string } }>(
    "/:id/ready-to-pick",
    async (request, reply) => {
      const { id } = request.params;

      try {
        // Check eligibility first
        const eligibility = await orderService.checkEligibility(id);
        if (!eligibility.eligible) {
          return reply.status(400).send({
            error: "Order not eligible for picking",
            reasons: eligibility.reasons,
          });
        }

        // Use service for state transition
        await orderService.markReadyToPick(id);

        return reply.send({ success: true });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/tasks/pick
   * Create a pick task for an order
   */
  app.post<{ Params: { id: string } }>(
    "/:id/tasks/pick",
    async (request, reply) => {
      const { id } = request.params;

      try {
        // Get order with allocations
        const order = await prisma.order.findUnique({
          where: { id },
          include: {
            items: true,
            allocations: {
              where: { status: "ALLOCATED" },
              include: {
                location: true,
                productVariant: true,
              },
            },
          },
        });

        if (!order) {
          return reply.status(404).send({ error: "Order not found" });
        }

        // Validate state transition via service
        await orderService.markPicking(id);

        // Check if pick task already exists
        const existingTask = await prisma.workTask.findFirst({
          where: {
            orderIds: { has: id },
            type: "PICKING",
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
        });

        if (existingTask) {
          return reply.status(400).send({
            error: "A pick task already exists for this order",
            taskId: existingTask.id,
            taskNumber: existingTask.taskNumber,
          });
        }

        // Generate task number
        const taskCount = await prisma.workTask.count();
        const taskNumber = `PICK-${String(taskCount + 1).padStart(6, "0")}`;

        // Sort allocations by pick sequence for optimized path
        const sortedAllocations = order.allocations.sort((a, b) => {
          const seqA = a.location?.pickSequence ?? 9999;
          const seqB = b.location?.pickSequence ?? 9999;
          return seqA - seqB;
        });

        // Create pick task with task items
        const task = await prisma.workTask.create({
          data: {
            taskNumber,
            type: "PICKING",
            status: "PENDING",
            priority:
              order.priority === "EXPRESS"
                ? 10
                : order.priority === "RUSH"
                  ? 5
                  : 0,
            orderIds: [order.id],
            totalOrders: 1,
            totalItems: sortedAllocations.length,
            taskItems: {
              create: sortedAllocations.map((alloc, index) => ({
                orderId: order.id,
                orderItemId: alloc.orderItemId,
                productVariantId: alloc.productVariantId,
                locationId: alloc.locationId,
                allocationId: alloc.id,
                sequence: index + 1,
                quantityRequired: alloc.quantity,
                status: "PENDING",
              })),
            },
          },
          include: {
            taskItems: true,
          },
        });

        // Create task event
        await prisma.taskEvent.create({
          data: {
            taskId: task.id,
            eventType: "TASK_CREATED",
            userId: request.user?.sub,
            data: {
              orderNumber: order.orderNumber,
              itemCount: task.taskItems.length,
            },
          },
        });

        return reply.status(201).send({
          success: true,
          taskId: task.id,
          taskNumber: task.taskNumber,
          itemCount: task.taskItems.length,
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/hold
   * Put order on hold
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/:id/hold",
    async (request, reply) => {
      const { id } = request.params;
      const { reason } = request.body || {};

      try {
        // Use service for state transition and business logic
        await orderService.placeOnHold(id, reason || "Manually placed on hold");
        return reply.send({ success: true });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/release
   * Release order from hold
   */
  app.post<{ Params: { id: string }; Body: { targetStatus?: string } }>(
    "/:id/release",
    async (request, reply) => {
      const { id } = request.params;
      const { targetStatus } = request.body || {};

      try {
        // Determine target status if not provided
        let target = targetStatus;
        if (!target) {
          const allocations = await prisma.allocation.count({
            where: { orderId: id, status: "ALLOCATED" },
          });
          target = allocations > 0 ? "ALLOCATED" : "PENDING";
        }

        // Use service for state transition
        await orderService.releaseHold(id, target as any);

        return reply.send({ success: true, status: target });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/cancel
   * Cancel an order
   */
  app.post<{ Params: { id: string } }>(
    "/:id/cancel",
    async (request, reply) => {
      const { id } = request.params;

      try {
        const order = await orderRepository.findById(id);
        if (!order) {
          return reply.status(404).send({ error: "Order not found" });
        }

        if (["SHIPPED", "DELIVERED", "CANCELLED"].includes(order.status)) {
          return reply.status(400).send({
            error: `Cannot cancel order in ${order.status} status`,
          });
        }

        // Release allocations via service
        await orderAllocationService.releaseAllocations(id);

        // Cancel any pending tasks
        await prisma.workTask.updateMany({
          where: {
            orderIds: { has: id },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          data: { status: "CANCELLED" },
        });

        // Update order status
        await orderRepository.updateStatus(id, "CANCELLED");

        return reply.send({ success: true });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:id/split-backorder
   * Split a partially allocated order: ship what's allocated, backorder the rest
   */
  app.post<{ Params: { id: string } }>(
    "/:id/split-backorder",
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await orderAllocationService.splitBackorder(id);

        return reply.send({
          success: true,
          ...result,
        });
      } catch (error: any) {
        console.error("[Orders] Split backorder error:", error);
        const status = error.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: error.message });
      }
    },
  );

  /**
   * POST /orders/:orderId/items/:itemId/match
   * Manually match an order item to a product variant
   */
  app.post<{
    Params: { orderId: string; itemId: string };
    Body: { productVariantId: string };
  }>("/:orderId/items/:itemId/match", async (request, reply) => {
    const { orderId, itemId } = request.params;
    const { productVariantId } = request.body;

    if (!productVariantId) {
      return reply.status(400).send({ error: "productVariantId required" });
    }

    // Verify order and item exist
    const orderItem = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });

    if (!orderItem) {
      return reply.status(404).send({ error: "Order item not found" });
    }

    // Verify product variant exists
    const variant = await prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });

    if (!variant) {
      return reply.status(404).send({ error: "Product variant not found" });
    }

    // Update the order item
    await orderRepository.matchOrderItem(itemId, productVariantId);

    // Update unmatched count on order
    const unmatchedCount = await prisma.orderItem.count({
      where: { orderId, matched: false },
    });

    await orderRepository.updateUnmatchedCount(orderId, unmatchedCount);

    return reply.send({
      success: true,
      matched: {
        orderItemId: itemId,
        productVariantId,
        sku: variant.sku,
        name: variant.name,
      },
    });
  });

  /**
   * POST /orders/allocate-batch
   * Allocate inventory for multiple orders
   */
  app.post<{ Body: { orderIds: string[]; allowPartial?: boolean } }>(
    "/allocate-batch",
    async (request, reply) => {
      const { orderIds, allowPartial = true } = request.body;

      if (!orderIds || orderIds.length === 0) {
        return reply.status(400).send({ error: "orderIds required" });
      }

      try {
        const result = await orderAllocationService.allocateOrders({
          orderIds,
          allowPartial,
        });

        // Generate box recommendations for fully allocated orders
        for (const allocated of result.fullyAllocated) {
          try {
            await orderPackageService.recommendAndSave(allocated.orderId);
          } catch (err) {
            console.error(
              `[Orders] Box recommendation failed for ${allocated.orderId}:`,
              err,
            );
          }
        }

        return reply.send({
          success: true,
          fullyAllocated: result.fullyAllocated.length,
          partiallyAllocated: result.partiallyAllocated.length,
          backordered: result.backordered.length,
          onHold: result.onHold.length,
          errors: result.errors,
          details: {
            fullyAllocated: result.fullyAllocated,
            partiallyAllocated: result.partiallyAllocated,
            backordered: result.backordered,
            onHold: result.onHold,
          },
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );
};

// Helper function
function getAllocationStatus(
  item: {
    quantity: number;
    quantityAllocated: number;
    matched: boolean;
  },
  orderStatus: string,
): "ALLOCATED" | "PARTIAL" | "UNALLOCATED" | "BACKORDERED" | "UNMATCHED" {
  if (!item.matched) return "UNMATCHED";
  if (item.quantityAllocated >= item.quantity) return "ALLOCATED";
  if (item.quantityAllocated > 0) return "PARTIAL";

  // Only show BACKORDERED if order actually tried allocation
  if (orderStatus === "BACKORDERED") return "BACKORDERED";
  return "UNALLOCATED";
}
