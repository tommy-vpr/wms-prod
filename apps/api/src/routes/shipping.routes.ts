/**
 * Shipping Routes
 * REST endpoints for shipping operations
 *
 * Save to: apps/api/src/routes/shipping.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { ShippingService } from "@wms/domain";
import { prisma } from "@wms/db";
import { getShippingQueue, SHIPPING_JOBS } from "@wms/queue";

// =============================================================================
// Route Plugin
// =============================================================================

export const shippingRoutes: FastifyPluginAsync = async (app) => {
  const service = new ShippingService(prisma);

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /shipping/carriers
  // Get available carriers, presets, and box definitions
  // ─────────────────────────────────────────────────────────────────────────────

  app.get("/carriers", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await service.getCarriersAndPresets();
      return reply.send(data);
    } catch (err: any) {
      console.error("[Shipping] Failed to load carriers:", err);
      return reply
        .status(500)
        .send({ error: err.message || "Failed to load carriers" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /shipping/create-label
  // Create shipping label(s) synchronously
  // ─────────────────────────────────────────────────────────────────────────────

  app.post(
    "/create-label",
    async (
      request: FastifyRequest<{
        Body: {
          orderId: string;
          carrierCode: string;
          serviceCode: string;
          packages: Array<{
            packageCode: string;
            weight: number;
            length?: number;
            width?: number;
            height?: number;
            items?: Array<{
              sku: string;
              quantity: number;
              productName?: string;
              unitPrice?: number;
            }>;
          }>;
          shippingAddress?: {
            name: string;
            company?: string;
            address1: string;
            address2?: string;
            city: string;
            state: string;
            zip: string;
            country?: string;
            phone?: string;
          };
          items?: Array<{
            sku: string;
            quantity: number;
            productName?: string;
            unitPrice?: number;
          }>;
          notes?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const {
        orderId,
        carrierCode,
        serviceCode,
        packages,
        shippingAddress,
        items,
        notes,
      } = request.body;

      // Basic validation
      if (!orderId || !packages || packages.length === 0) {
        return reply
          .status(400)
          .send({ error: "Order ID and at least one package are required" });
      }
      if (!carrierCode || !serviceCode) {
        return reply
          .status(400)
          .send({ error: "Carrier code and service code are required" });
      }
      for (const [idx, pkg] of packages.entries()) {
        if (!pkg?.weight || pkg.weight <= 0) {
          return reply
            .status(400)
            .send({ error: `Package ${idx + 1} must have a valid weight` });
        }
      }

      try {
        const result = await service.createLabels(
          {
            orderId,
            carrierCode,
            serviceCode,
            packages,
            shippingAddress,
            items,
            notes,
          },
          userId,
        );

        return reply.send({
          success: true,
          label: result.labels[0],
          labels: result.labels,
          totalCost: result.totalCost,
          orderId: result.orderId,
          orderNumber: result.orderNumber,
          isTestLabel: process.env.SHIPENGINE_SANDBOX === "true",
        });
      } catch (err: any) {
        console.error("[Shipping] Create label error:", err);

        const status = err.message.includes("not found")
          ? 404
          : err.message.includes("must be packed")
            ? 400
            : 500;

        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /shipping/create-label-async
  // Queue label creation as a background job (for long-running operations)
  // ─────────────────────────────────────────────────────────────────────────────

  app.post(
    "/create-label-async",
    async (
      request: FastifyRequest<{
        Body: {
          orderId: string;
          carrierCode: string;
          serviceCode: string;
          packages: Array<{
            packageCode: string;
            weight: number;
            length?: number;
            width?: number;
            height?: number;
            items?: Array<{
              sku: string;
              quantity: number;
              productName?: string;
              unitPrice?: number;
            }>;
          }>;
          shippingAddress?: any;
          items?: Array<{
            sku: string;
            quantity: number;
            productName?: string;
            unitPrice?: number;
          }>;
          notes?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = (request as any).user?.id;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const {
        orderId,
        carrierCode,
        serviceCode,
        packages,
        shippingAddress,
        items,
        notes,
      } = request.body;

      // Basic validation
      if (!orderId || !packages || packages.length === 0) {
        return reply
          .status(400)
          .send({ error: "Order ID and at least one package are required" });
      }

      try {
        const queue = getShippingQueue();

        const job = await queue.add(
          SHIPPING_JOBS.CREATE_LABEL,
          {
            orderId,
            carrierCode,
            serviceCode,
            packages,
            shippingAddress,
            items,
            notes,
            userId,
          },
          {
            jobId: `create-label-${orderId}-${Date.now()}`,
          },
        );

        return reply.status(202).send({
          success: true,
          message: "Label creation queued",
          jobId: job.id,
          orderId,
        });
      } catch (err: any) {
        console.error("[Shipping] Queue label error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /shipping/void-label
  // Void a shipping label
  // ─────────────────────────────────────────────────────────────────────────────

  app.post(
    "/void-label",
    async (
      request: FastifyRequest<{
        Body: {
          labelId: string;
          packageId?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = (request as any).user?.id;
      const { labelId, packageId } = request.body;

      if (!labelId) {
        return reply.status(400).send({ error: "Label ID is required" });
      }

      try {
        const result = await service.voidLabel(labelId, packageId, userId);
        return reply.send({
          success: true,
          approved: result.approved,
          message: result.message,
        });
      } catch (err: any) {
        console.error("[Shipping] Void label error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /shipping/track/:trackingNumber
  // Track a shipment
  // ─────────────────────────────────────────────────────────────────────────────

  app.get(
    "/track/:trackingNumber",
    async (
      request: FastifyRequest<{
        Params: { trackingNumber: string };
        Querystring: { carrier?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { trackingNumber } = request.params;
      const carrierCode = (request.query as any).carrier || "ups";

      try {
        const tracking = await service.trackShipment(
          carrierCode,
          trackingNumber,
        );
        return reply.send(tracking);
      } catch (err: any) {
        console.error("[Shipping] Track shipment error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /shipping/order/:orderId/packages
  // Get all shipping packages for an order
  // ─────────────────────────────────────────────────────────────────────────────

  app.get(
    "/order/:orderId/packages",
    async (
      request: FastifyRequest<{
        Params: { orderId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;

      try {
        const packages = await service.getOrderShippingPackages(orderId);
        return reply.send({ packages });
      } catch (err: any) {
        console.error("[Shipping] Get packages error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );
};
