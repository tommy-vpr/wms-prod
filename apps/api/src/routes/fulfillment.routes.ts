/**
 * Fulfillment Routes
 * REST endpoints for the fulfillment pipeline
 *
 * Save to: apps/api/src/routes/fulfillment.routes.ts
 *
 * Register in your route index:
 *   import { fulfillmentRoutes } from "./fulfillment.routes.js";
 *   app.register(fulfillmentRoutes, { prefix: "/api/fulfillment" });
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { FulfillmentService } from "@wms/domain"; // Adjust import path
import { prisma } from "@wms/db"; // Adjust to your prisma singleton

// =============================================================================
// Route Plugin
// =============================================================================

export const fulfillmentRoutes: FastifyPluginAsync = async (app) => {
  const service = new FulfillmentService(prisma);

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/fulfillment/:orderId/status
  // Get current fulfillment status + events for an order
  // ─────────────────────────────────────────────────────────────────────────

  app.get(
    "/:orderId/status",
    async (
      request: FastifyRequest<{ Params: { orderId: string } }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;

      try {
        const status = await service.getFulfillmentStatus(orderId);
        return reply.send(status);
      } catch (err: any) {
        return reply.status(404).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/fulfillment/:orderId/events
  // Replay events for SSE catch-up (e.g., page refresh)
  // ─────────────────────────────────────────────────────────────────────────

  app.get(
    "/:orderId/events",
    async (
      request: FastifyRequest<{
        Params: { orderId: string };
        Querystring: { sinceEventId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;
      const { sinceEventId } = request.query;

      try {
        const events = await service.getEventsSince(orderId, sinceEventId);
        return reply.send({ events });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/:orderId/pick
  // Generate a pick list for the order
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:orderId/pick",
    async (
      request: FastifyRequest<{ Params: { orderId: string } }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;
      const userId = (request as any).user?.id; // Adjust to your auth pattern

      try {
        const result = await service.generatePickList(orderId, userId);
        return reply.status(201).send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/:orderId/pick/:taskItemId/confirm
  // Confirm a single pick item (barcode scan or manual)
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:orderId/pick/:taskItemId/confirm",
    async (
      request: FastifyRequest<{
        Params: { orderId: string; taskItemId: string };
        Body: {
          quantity?: number;
          locationScanned?: boolean;
          itemScanned?: boolean;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { taskItemId } = request.params;
      const body = (request.body ?? {}) as any;
      const userId = (request as any).user?.id;

      try {
        const result = await service.confirmPickItem(taskItemId, {
          quantity: body.quantity,
          locationScanned: body.locationScanned,
          itemScanned: body.itemScanned,
          userId,
        });
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/:orderId/pick/confirm-all
  // Bulk confirm all remaining pick items (batch mode for large orders)
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:orderId/pick/confirm-all",
    async (
      request: FastifyRequest<{ Params: { orderId: string } }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;
      const userId = (request as any).user?.id;

      try {
        const result = await service.confirmAllPickItems(orderId, { userId });
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // Complete packing from bin (called from pack station)
  app.post(
    "/:orderId/pack/complete-from-bin",
    async (
      request: FastifyRequest<{
        Params: { orderId: string };
        Body: {
          binId: string;
          weight: number;
          weightUnit?: string;
          dimensions?: {
            length: number;
            width: number;
            height: number;
            unit: string;
          };
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;
      const { binId, weight, weightUnit, dimensions } = request.body as any;
      const userId = (request as any).user?.id;

      try {
        // This creates the pack task and completes it in one step
        // since bin verification already happened
        const result = await service.completePackingFromBin(orderId, binId, {
          weight,
          weightUnit,
          dimensions,
          userId,
        });
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/:orderId/pack
  // Generate a packing verification list
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:orderId/pack",
    async (
      request: FastifyRequest<{ Params: { orderId: string } }>,
      reply: FastifyReply,
    ) => {
      const { orderId } = request.params;
      const userId = (request as any).user?.id;

      try {
        const result = await service.generatePackList(orderId, userId);
        return reply.status(201).send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/:orderId/pack/:taskItemId/verify
  // Verify a single pack item (scan check)
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:orderId/pack/:taskItemId/verify",
    async (
      request: FastifyRequest<{
        Params: { orderId: string; taskItemId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { taskItemId } = request.params;
      const userId = (request as any).user?.id;

      try {
        const result = await service.verifyPackItem(taskItemId, { userId });
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/:orderId/pack/complete
  // Complete packing with weight and dimensions
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:orderId/pack/complete",
    async (
      request: FastifyRequest<{
        Params: { orderId: string };
        Body: {
          taskId: string;
          weight: number;
          weightUnit?: string;
          dimensions?: {
            length: number;
            width: number;
            height: number;
            unit: string;
          };
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = request.body as any;
      const userId = (request as any).user?.id;

      if (!body.taskId || body.weight == null) {
        return reply
          .status(400)
          .send({ error: "taskId and weight are required" });
      }

      try {
        const result = await service.completePacking(body.taskId, {
          weight: body.weight,
          weightUnit: body.weightUnit,
          dimensions: body.dimensions,
          userId,
        });
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // Add to fulfillment.routes.ts

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/fulfillment/bin/:barcode
  // Lookup order by scanning bin barcode (for pack station)
  // ─────────────────────────────────────────────────────────────────────────────

  app.get(
    "/bin/:barcode",
    async (
      request: FastifyRequest<{ Params: { barcode: string } }>,
      reply: FastifyReply,
    ) => {
      const { barcode } = request.params;

      try {
        const result = await service.getOrderByBinBarcode(barcode);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(404).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/bin/:binId/verify
  // Verify an item in the bin by scanning its UPC
  // ─────────────────────────────────────────────────────────────────────────────

  app.post(
    "/bin/:binId/verify",
    async (
      request: FastifyRequest<{
        Params: { binId: string };
        Body: { barcode: string; quantity?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { binId } = request.params;
      const { barcode, quantity } = request.body as any;
      const userId = (request as any).user?.id;

      if (!barcode) {
        return reply.status(400).send({ error: "barcode is required" });
      }

      try {
        const result = await service.verifyBinItem(
          binId,
          barcode,
          userId,
          quantity,
        );
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/fulfillment/bin/:binId/complete
  // Mark bin as fully verified/packed
  // ─────────────────────────────────────────────────────────────────────────────

  app.post(
    "/bin/:binId/complete",
    async (
      request: FastifyRequest<{ Params: { binId: string } }>,
      reply: FastifyReply,
    ) => {
      const { binId } = request.params;
      const userId = (request as any).user?.id;

      try {
        await service.completeBin(binId, userId);
        return reply.send({ success: true });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );
};
