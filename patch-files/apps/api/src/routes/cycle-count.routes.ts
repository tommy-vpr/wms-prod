/**
 * Cycle Count Routes
 *
 * Save to: apps/api/src/routes/cycle-count.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { CycleCountService } from "@wms/domain";
import { prisma } from "@wms/db";
import { enqueueCheckBackorders } from "@wms/queue";

const cycleCountService = new CycleCountService(prisma);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  return request.user.sub;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CreateTaskBody {
  name?: string;
  description?: string;
  type: "LOCATION" | "ZONE" | "SKU" | "ABC" | "AD_HOC";
  locationIds?: string[];
  zone?: string;
  skuFilter?: string;
  abcClass?: string;
  blindCount?: boolean;
  includeZeroQty?: boolean;
  priority?: number;
  scheduledDate?: string;
  dueDate?: string;
  assignedToId?: string;
}

interface StartSessionBody {
  taskId?: string;
  locationId: string;
  blindCount?: boolean;
}

interface ScanBody {
  barcode: string;
}

interface CountBody {
  lineId: string;
  quantity: number;
}

interface BatchCountBody {
  updates: Array<{ lineId: string; quantity: number }>;
  expectedVersion?: number;
}

interface AddUnexpectedBody {
  productVariantId: string;
  quantity: number;
  lotNumber?: string;
}

interface ApproveBody {
  notes?: string;
}

interface RejectBody {
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

const cycleCountRoutes: FastifyPluginAsync = async (app) => {
  // ─────────────────────────────────────────────────────────────────────────
  // Tasks
  // ─────────────────────────────────────────────────────────────────────────

  // List tasks
  app.get(
    "/tasks",
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          assignedToId?: string;
          limit?: string;
          offset?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { status, assignedToId, limit, offset } = request.query;

      const result = await cycleCountService.listTasks({
        status: status?.split(","),
        assignedToId,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });

      return result;
    },
  );

  // Get single task
  app.get(
    "/tasks/:taskId",
    async (
      request: FastifyRequest<{ Params: { taskId: string } }>,
      reply: FastifyReply,
    ) => {
      const { taskId } = request.params;
      const task = await cycleCountService.getTask(taskId);
      return task;
    },
  );

  // Create task
  app.post(
    "/tasks",
    async (
      request: FastifyRequest<{ Body: CreateTaskBody }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const body = request.body;

      const task = await cycleCountService.createTask({
        ...body,
        scheduledDate: body.scheduledDate
          ? new Date(body.scheduledDate)
          : undefined,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        createdById: user.id,
      });

      return reply.status(201).send(task);
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions - Static routes FIRST
  // ─────────────────────────────────────────────────────────────────────────

  // List sessions
  app.get(
    "/sessions",
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          taskId?: string;
          locationId?: string;
          countedById?: string;
          limit?: string;
          offset?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { status, taskId, locationId, countedById, limit, offset } =
        request.query;

      const result = await cycleCountService.listSessions({
        status: status?.split(","),
        taskId,
        locationId,
        countedById,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });

      return result;
    },
  );

  // Start new session
  app.post(
    "/sessions/start",
    async (
      request: FastifyRequest<{ Body: StartSessionBody }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { taskId, locationId, blindCount } = request.body;

      const userId = getUserId(request);
      const result = await cycleCountService.startSession({
        taskId,
        locationId,
        blindCount,
        userId,
      });

      return reply.status(201).send(result);
    },
  );

  // Pending sessions (for review)
  app.get("/sessions/pending", async (request: FastifyRequest) => {
    const result = await cycleCountService.listSessions({
      status: ["SUBMITTED"],
    });
    return result;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sessions - Parametric routes LAST
  // ─────────────────────────────────────────────────────────────────────────

  // Get session
  app.get(
    "/sessions/:sessionId",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;

      const result = await cycleCountService.getSession(sessionId, user.id);
      return result;
    },
  );

  // Scan barcode
  app.post(
    "/sessions/:sessionId/scan",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: ScanBody;
      }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;
      const { barcode } = request.body;

      const result = await cycleCountService.scanBarcode(
        sessionId,
        barcode,
        user.id,
      );
      return result;
    },
  );

  // Count single item
  app.post(
    "/sessions/:sessionId/count",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: CountBody;
      }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;
      const { lineId, quantity } = request.body;

      const result = await cycleCountService.countItem(
        sessionId,
        lineId,
        quantity,
        user.id,
      );
      return result;
    },
  );

  // Batch count (debounced updates)
  app.post(
    "/sessions/:sessionId/batch",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: BatchCountBody;
      }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;
      const { updates, expectedVersion } = request.body;

      const result = await cycleCountService.batchCount(
        sessionId,
        { updates, expectedVersion },
        user.id,
      );
      return result;
    },
  );

  // Add unexpected item
  app.post(
    "/sessions/:sessionId/unexpected",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: AddUnexpectedBody;
      }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;

      const result = await cycleCountService.addUnexpectedItem(
        sessionId,
        request.body,
        user.id,
      );
      return result;
    },
  );

  // Heartbeat (lock refresh)
  app.post(
    "/sessions/:sessionId/heartbeat",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;

      const result = await cycleCountService.heartbeat(sessionId, user.id);
      return result;
    },
  );

  // Submit for review
  app.post(
    "/sessions/:sessionId/submit",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;

      const result = await cycleCountService.submitForReview(
        sessionId,
        user.id,
      );
      return result;
    },
  );

  // Approve
  app.post(
    "/sessions/:sessionId/approve",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: ApproveBody;
      }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;
      const { notes } = request.body;

      const result = await cycleCountService.approve(sessionId, user.id, notes);

      // ── Trigger backorder checks for variants with positive adjustment ─
      try {
        const lines = await prisma.cycleCountLine.findMany({
          where: {
            sessionId,
            variance: { gt: 0 }, // more found than expected → new stock
            productVariantId: { not: null },
          },
          select: { productVariantId: true },
          distinct: ["productVariantId"],
        });
        for (const line of lines) {
          if (line.productVariantId) {
            await enqueueCheckBackorders({
              productVariantId: line.productVariantId,
              triggerSource: `cycle-count:${sessionId}`,
            }).catch((err) =>
              console.error(
                `[CycleCount] Failed to enqueue backorder check:`,
                err,
              ),
            );
          }
        }
      } catch (err) {
        console.error("[CycleCount] Backorder check trigger failed:", err);
      }

      return result;
    },
  );

  // Reject
  app.post(
    "/sessions/:sessionId/reject",
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Body: RejectBody;
      }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;
      const { reason } = request.body;

      const result = await cycleCountService.reject(sessionId, user.id, reason);
      return result;
    },
  );

  // Reopen rejected session
  app.post(
    "/sessions/:sessionId/reopen",
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as unknown as { id: string };
      const { sessionId } = request.params;

      const result = await cycleCountService.reopenSession(sessionId, user.id);
      return result;
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Locations helper
  // ─────────────────────────────────────────────────────────────────────────

  app.get(
    "/locations",
    async (
      request: FastifyRequest<{
        Querystring: {
          type?: string;
          zone?: string;
          search?: string;
          limit?: string;
          offset?: string;
        };
      }>,
    ) => {
      try {
        const { type, zone, search, limit, offset } = request.query;

        const where: any = {};
        if (type) where.type = { in: type.split(",") };
        if (zone) where.zone = zone;
        if (search) {
          where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search, mode: "insensitive" } },
          ];
        }

        const [locations, total] = await Promise.all([
          prisma.location.findMany({
            where,
            select: {
              id: true,
              name: true,
              barcode: true,
              type: true,
              zone: true,
              _count: { select: { inventoryUnits: true } },
            },
            orderBy: { name: "asc" },
            take: limit ? parseInt(limit, 10) : 50,
            skip: offset ? parseInt(offset, 10) : 0,
          }),
          prisma.location.count({ where }),
        ]);

        return { locations, total };
      } catch (err) {
        console.error("[CycleCount] Locations error:", err);
        throw err;
      }
    },
  );
};

export default cycleCountRoutes;
