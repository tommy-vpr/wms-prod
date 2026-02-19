/**
 * Receiving Routes - Production Version
 *
 * Save to: apps/api/src/routes/receiving.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { ReceivingService } from "@wms/domain";
import { prisma } from "@wms/db";
import { enqueueCheckBackorders } from "@wms/queue";

export const receivingRoutes: FastifyPluginAsync = async (app) => {
  const service = new ReceivingService(prisma);

  // Inventory Planner config
  const IP_API_URL = process.env.INVENTORY_PLANNER_API;
  const IP_API_KEY = process.env.INVENTORY_PLANNER_KEY;
  const IP_ACCOUNT_ID = process.env.INVENTORY_PLANNER_ACCOUNT;

  // ─────────────────────────────────────────────────────────────────────────
  // STATIC ROUTES FIRST (before any /:param routes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /receiving
   * List sessions
   */
  app.get(
    "/",
    async (
      request: FastifyRequest<{
        Querystring: { status?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { status, limit, offset } = request.query;
      const userId = request.user?.sub;

      try {
        const result = await service.listSessions({
          status: status ? status.split(",") : undefined,
          userId,
          limit: limit ? parseInt(limit, 10) : undefined,
          offset: offset ? parseInt(offset, 10) : undefined,
        });
        return reply.send(result);
      } catch (err: any) {
        console.error("[Receiving] List sessions error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/start
   * Start or resume a receiving session
   */
  app.post(
    "/start",
    async (
      request: FastifyRequest<{
        Body: {
          poId: string;
          poReference: string;
          vendor?: string;
          expectedItems: Array<{
            sku: string;
            productName: string;
            quantity: number;
            lotNumber?: string;
            expiryDate?: string;
          }>;
          receivingLocationId?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = request.user?.sub;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { poId, poReference, vendor, expectedItems, receivingLocationId } =
        request.body;

      if (!poId || !poReference || !expectedItems?.length) {
        return reply.status(400).send({
          error: "poId, poReference, and expectedItems are required",
        });
      }

      try {
        const result = await service.startSession({
          poId,
          poReference,
          vendor,
          expectedItems,
          userId,
          receivingLocationId,
        });
        return reply.status(201).send(result);
      } catch (err: any) {
        console.error("[Receiving] Start session error:", err);
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  /**
   * GET /receiving/pending
   * Get sessions awaiting approval
   */
  app.get("/pending", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await service.getPendingSessions();
      return reply.send(result);
    } catch (err: any) {
      console.error("[Receiving] Get pending error:", err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inventory Planner Integration (BEFORE /:sessionId routes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /receiving/inventory-planner/purchase-orders
   */
  app.get<{
    Querystring: { status?: string; limit?: string; page?: string };
  }>("/inventory-planner/purchase-orders", async (request, reply) => {
    if (!IP_API_URL || !IP_API_KEY || !IP_ACCOUNT_ID) {
      return reply
        .status(500)
        .send({ error: "Inventory Planner not configured" });
    }

    const { status, limit, page } = request.query;

    try {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      params.set("limit", limit || "100");
      params.set("page", page || "0");
      params.set("created_at_sort", "desc");

      const response = await fetch(
        `${IP_API_URL}/purchase-orders?${params.toString()}`,
        {
          headers: {
            Authorization: IP_API_KEY,
            Account: IP_ACCOUNT_ID,
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Receiving] IP API error:", response.status, errorText);
        return reply.status(response.status).send({ error: errorText });
      }

      const data = await response.json();

      // ✅ Handle different response formats (key is "purchase-orders" with hyphen!)
      const rawPOs =
        data["purchase-orders"] ||
        data.purchase_orders ||
        data.purchaseOrders ||
        [];

      // Get all PO IDs for batch query
      const poIds = rawPOs.map((po: any) => po.id);

      // Get existing receiving sessions
      const sessions = await prisma.receivingSession.findMany({
        where: { poId: { in: poIds } },
        select: { poId: true, status: true, id: true },
      });
      const sessionMap = new Map(sessions.map((s) => [s.poId, s]));

      // Transform to frontend format
      const purchaseOrders = rawPOs.map((po: any) => {
        const session = sessionMap.get(po.id);

        return {
          id: po.id,
          reference: po.reference,
          vendor: po.vendor_display_name || po.vendor || po.source_display_name,
          status: po.status,
          expectedDate: po.expected_date,
          createdAt: po.created_at,
          totalCost: po.total,
          currency: po.currency,
          // Line items
          items: (po.items || []).map((item: any) => ({
            sku: item.sku?.trim(),
            productName: item.title || item.name || item.sku,
            quantity: item.replenishment || item.remaining || 0,
          })),
          // Session info
          receivingSession: session || null,
          hasPendingSession: !!session,
        };
      });

      return reply.send({
        purchaseOrders,
        meta: data.meta || {},
      });
    } catch (err: any) {
      console.error("[Receiving] IP API error:", err);
      return reply
        .status(500)
        .send({ error: "Failed to fetch purchase orders" });
    }
  });

  /**
   * GET /receiving/inventory-planner/purchase-orders/:poId
   */
  app.get<{
    Params: { poId: string };
  }>("/inventory-planner/purchase-orders/:poId", async (request, reply) => {
    if (!IP_API_URL || !IP_API_KEY || !IP_ACCOUNT_ID) {
      return reply
        .status(500)
        .send({ error: "Inventory Planner not configured" });
    }

    const { poId } = request.params;

    try {
      const response = await fetch(`${IP_API_URL}/purchase-orders/${poId}`, {
        headers: {
          Authorization: IP_API_KEY,
          Account: IP_ACCOUNT_ID,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[Receiving] IP single PO error:",
          response.status,
          errorText,
        );
        return reply.status(response.status).send({ error: errorText });
      }

      const data = await response.json();

      // 👇 ADD LOGGING
      console.log("IP Single PO Response keys:", Object.keys(data));
      console.log("IP Single PO Response:", JSON.stringify(data, null, 2));

      // 👇 Handle different response formats (likely "purchase-order" with hyphen)
      const rawPO =
        data["purchase-order"] ||
        data.purchase_order ||
        data.purchaseOrder ||
        data;

      const existingSession = await prisma.receivingSession.findFirst({
        where: { poId },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      });

      // Transform to frontend format
      const purchaseOrder = {
        id: rawPO.id,
        reference: rawPO.reference,
        vendor:
          rawPO.vendor_display_name ||
          rawPO.vendor ||
          rawPO.source_display_name,
        status: rawPO.status,
        expectedDate: rawPO.expected_date,
        items: (rawPO.items || []).map((item: any) => ({
          sku: item.sku?.trim(),
          productName: item.title || item.name || item.sku,
          quantity: item.replenishment || item.remaining || 0,
        })),
      };

      return reply.send({
        purchaseOrder,
        receivingSession: existingSession,
      });
    } catch (err: any) {
      console.error("[Receiving] IP API error:", err);
      return reply
        .status(500)
        .send({ error: "Failed to fetch purchase order" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PARAMETRIC ROUTES (/:sessionId) - MUST BE LAST
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /receiving/:sessionId
   * Get session with all line items
   */
  app.get(
    "/:sessionId",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const userId = request.user?.sub;

      try {
        const result = await service.getSession(sessionId, userId);
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/scan
   * Scan a barcode to identify item
   */
  app.post(
    "/:sessionId/scan",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: { barcode: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { barcode } = request.body;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!barcode) {
        return reply.status(400).send({ error: "Barcode is required" });
      }

      try {
        const result = await service.scanBarcode(sessionId, barcode, userId);
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/batch
   * Batch update quantities (debounced from frontend)
   */
  app.post(
    "/:sessionId/batch",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: {
          updates: Array<{
            lineId: string;
            quantity: number;
            scanIds?: string[];
          }>;
          expectedVersion?: number;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { updates, expectedVersion } = request.body;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!updates?.length) {
        return reply.status(400).send({ error: "Updates are required" });
      }

      try {
        const result = await service.batchUpdateQuantities(
          sessionId,
          updates,
          userId,
          expectedVersion,
        );
        return reply.send(result);
      } catch (err: any) {
        if (err.message.includes("Version conflict")) {
          return reply.status(409).send({ error: err.message });
        }
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/add
   * Single quantity add (convenience endpoint)
   */
  app.post(
    "/:sessionId/add",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: { lineId: string; quantity: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { lineId, quantity } = request.body;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!lineId || quantity == null) {
        return reply
          .status(400)
          .send({ error: "lineId and quantity are required" });
      }

      try {
        const result = await service.addQuantity(
          sessionId,
          lineId,
          quantity,
          userId,
        );
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/set
   * Set exact quantity
   */
  app.post(
    "/:sessionId/set",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: { lineId: string; quantity: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { lineId, quantity } = request.body;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!lineId || quantity == null) {
        return reply
          .status(400)
          .send({ error: "lineId and quantity are required" });
      }

      try {
        const result = await service.setQuantity(
          sessionId,
          lineId,
          quantity,
          userId,
        );
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/heartbeat
   * Keep session lock alive
   */
  app.post(
    "/:sessionId/heartbeat",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        await prisma.receivingSession.update({
          where: { id: sessionId },
          data: { lockedBy: userId, lockedAt: new Date() },
        });
        return reply.send({ ok: true });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/release-lock
   * Release session lock (when leaving page)
   */
  app.post(
    "/:sessionId/release-lock",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        await service.releaseLock(sessionId, userId);
        return reply.send({ ok: true });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/exception
   * Record an exception (damage, wrong item, etc.)
   */
  app.post(
    "/:sessionId/exception",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: {
          lineId: string;
          type: "DAMAGED" | "WRONG_ITEM" | "MISSING" | "OVERAGE";
          quantity: number;
          notes?: string;
          imageUrl?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        await service.recordException(sessionId, request.body, userId);
        return reply.send({ ok: true });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/submit
   * Submit session for approval
   */
  app.post(
    "/:sessionId/submit",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: { assignedTo?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { assignedTo } = request.body || {};
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await service.submitForApproval(
          sessionId,
          userId,
          assignedTo,
        );
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/approve
   * Approve session (ADMIN/MANAGER only)
   */
  app.post(
    "/:sessionId/approve",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
        return reply
          .status(403)
          .send({ error: "Only Admin or Manager can approve" });
      }

      try {
        const result = await service.approve(sessionId, userId);

        // ── Trigger backorder checks for received variants ──────────────
        const variantIds = [
          ...new Set(
            result.inventoryCreated
              .map((i) => i.productVariantId)
              .filter(Boolean),
          ),
        ];
        for (const productVariantId of variantIds) {
          await enqueueCheckBackorders({
            productVariantId,
            triggerSource: `receiving:${sessionId}`,
          }).catch((err) =>
            console.error(
              `[Receiving] Failed to enqueue backorder check for ${productVariantId}:`,
              err,
            ),
          );
        }

        return reply.send(result);
      } catch (err: any) {
        console.error("[Receiving] Approve error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/reject
   * Reject session (ADMIN/MANAGER only)
   */
  app.post(
    "/:sessionId/reject",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: { reason: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const { reason } = request.body;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      if (!reason) {
        return reply
          .status(400)
          .send({ error: "Rejection reason is required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
        return reply
          .status(403)
          .send({ error: "Only Admin or Manager can reject" });
      }

      try {
        const result = await service.reject(sessionId, userId, reason);
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  /**
   * POST /receiving/:sessionId/reopen
   * Reopen a rejected session for re-counting
   */
  app.post(
    "/:sessionId/reopen",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params;
      const userId = request.user?.sub;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await service.reopenSession(sessionId, userId);
        return reply.send(result);
      } catch (err: any) {
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );
};
