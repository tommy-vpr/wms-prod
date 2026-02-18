/**
 * Inventory Planner API Routes
 * Endpoints for syncing inventory from Inventory Planner
 *
 * Save to: apps/api/src/routes/inventory-planner.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@wms/db";
import {
  enqueueSyncInventoryPlanner,
  getInventoryPlannerQueue,
  getInventoryPlannerQueueStats,
} from "@wms/queue";

const API_URL = process.env.INVENTORY_PLANNER_API;
const API_KEY = process.env.INVENTORY_PLANNER_KEY;
const ACCOUNT_ID = process.env.INVENTORY_PLANNER_ACCOUNT;
const SYNC_LOCATION_NAME = "IP-SYNC";

export const inventoryPlannerRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /inventory-planner/status
   * Get sync status and configuration
   */
  app.get("/status", async (request, reply) => {
    const configured = !!(API_URL && API_KEY && ACCOUNT_ID);

    // Get sync location stats
    const location = await prisma.location.findUnique({
      where: { name: SYNC_LOCATION_NAME },
    });

    let stats = null;
    if (location) {
      const result = await prisma.inventoryUnit.aggregate({
        where: { locationId: location.id },
        _count: true,
        _sum: { quantity: true },
      });

      stats = {
        locationId: location.id,
        locationName: location.name,
        inventoryCount: result._count,
        totalQuantity: result._sum.quantity ?? 0,
      };
    }

    // Get last sync
    const lastSync = await prisma.auditLog.findFirst({
      where: { action: "INVENTORY_PLANNER_SYNC" },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
      },
    });

    // Get queue stats
    const queueStats = await getInventoryPlannerQueueStats();

    return reply.send({
      configured,
      stats,
      lastSync: lastSync
        ? {
            at: lastSync.createdAt,
            by: lastSync.user?.name ?? lastSync.user?.email ?? "System",
            result: lastSync.changes,
          }
        : null,
      queue: queueStats,
      syncInProgress: queueStats.active > 0,
    });
  });

  /**
   * POST /inventory-planner/sync
   * Trigger inventory sync
   */
  app.post("/sync", async (request, reply) => {
    const user = request.user;

    // Check permissions
    if (
      !user ||
      !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role ?? "")
    ) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Only ADMIN or MANAGER can trigger sync",
      });
    }

    // Check if configured
    if (!API_URL || !API_KEY || !ACCOUNT_ID) {
      return reply.status(400).send({
        error: "Not Configured",
        message: "Inventory Planner API credentials not configured",
      });
    }

    // Check if sync already in progress
    const queue = getInventoryPlannerQueue();
    const [activeJobs, waitingJobs] = await Promise.all([
      queue.getActive(),
      queue.getWaiting(),
    ]);

    if (activeJobs.length > 0 || waitingJobs.length > 0) {
      return reply.status(409).send({
        error: "Sync In Progress",
        message: "A sync is already in progress",
        activeJobs: activeJobs.length,
        waitingJobs: waitingJobs.length,
      });
    }

    // Enqueue sync job
    const idempotencyKey = `ip-sync-${Date.now()}`;
    const job = await enqueueSyncInventoryPlanner({
      userId: user.sub,
      idempotencyKey,
    });

    app.log.info(
      { jobId: job.id, userId: user.sub },
      "Inventory Planner sync job queued",
    );

    return reply.status(202).send({
      success: true,
      jobId: job.id,
      message: "Sync started",
    });
  });

  /**
   * GET /inventory-planner/sync/:jobId
   * Get sync job status
   */
  app.get<{ Params: { jobId: string } }>(
    "/sync/:jobId",
    async (request, reply) => {
      const { jobId } = request.params;
      const queue = getInventoryPlannerQueue();

      const job = await queue.getJob(jobId);

      if (!job) {
        return reply.status(404).send({ error: "Job not found" });
      }

      const state = await job.getState();

      return reply.send({
        jobId: job.id,
        state,
        progress: job.progress,
        result: job.returnvalue,
        failedReason: job.failedReason,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
      });
    },
  );

  /**
   * GET /inventory-planner/history
   * Get sync history
   */
  app.get<{ Querystring: { limit?: string } }>(
    "/history",
    async (request, reply) => {
      const limit = Number(request.query.limit ?? "10");

      const history = await prisma.auditLog.findMany({
        where: { action: "INVENTORY_PLANNER_SYNC" },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      return reply.send({
        history: history.map((h) => ({
          id: h.id,
          at: h.createdAt,
          by: h.user?.name ?? h.user?.email ?? "System",
          result: h.changes,
        })),
      });
    },
  );

  /**
   * DELETE /inventory-planner/sync/clear
   * Clear stuck jobs (admin only)
   */
  app.delete("/sync/clear", async (request, reply) => {
    const user = request.user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user?.role ?? "")) {
      return reply.status(403).send({ error: "Admin only" });
    }

    const queue = getInventoryPlannerQueue();
    await queue.obliterate({ force: true });

    return reply.send({ success: true, message: "Queue cleared" });
  });

  /**
   * GET /inventory-planner/preview
   * Preview sync (dry run)
   */
  app.get("/preview", async (request, reply) => {
    const user = request.user;

    if (
      !user ||
      !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role ?? "")
    ) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    if (!API_URL || !API_KEY || !ACCOUNT_ID) {
      return reply.status(400).send({ error: "Not configured" });
    }

    try {
      // Fetch IP variants
      const allVariants = await fetchIPVariants();
      const ipStockMap = new Map<string, number>(
        allVariants.map((v: any) => [v.sku, v.in_stock ?? 0]),
      );

      // Get WMS variants
      const productVariants = await prisma.productVariant.findMany({
        select: { id: true, sku: true },
      });
      const wmsSkus = new Set(productVariants.map((v) => v.sku));

      // Get existing IP inventory
      const location = await prisma.location.findUnique({
        where: { name: SYNC_LOCATION_NAME },
      });

      const existingUnits = location
        ? await prisma.inventoryUnit.findMany({
            where: { locationId: location.id },
            include: { productVariant: { select: { sku: true } } },
          })
        : [];

      const existingBySku = new Map(
        existingUnits.map((u) => [u.productVariant.sku, u.quantity]),
      );

      // Analyze
      let wouldCreate = 0;
      let wouldUpdate = 0;
      let wouldUnchange = 0;
      let notInWms = 0;
      const changes: Array<{ sku: string; from: number; to: number }> = [];

      for (const [sku, ipStock] of ipStockMap) {
        if (!wmsSkus.has(sku)) {
          notInWms++;
          continue;
        }

        const existing = existingBySku.get(sku);

        if (existing === undefined) {
          wouldCreate++;
          if (changes.length < 20) changes.push({ sku, from: 0, to: ipStock });
        } else if (existing === ipStock) {
          wouldUnchange++;
        } else {
          wouldUpdate++;
          if (changes.length < 20)
            changes.push({ sku, from: existing, to: ipStock });
        }
      }

      return reply.send({
        totalIPVariants: allVariants.length,
        totalWMSVariants: productVariants.length,
        wouldCreate,
        wouldUpdate,
        wouldUnchange,
        notInWms,
        sampleChanges: changes,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
};

// Helper to fetch IP variants
async function fetchIPVariants() {
  const allVariants: any[] = [];
  let page = 0;
  const limit = 1000;

  while (true) {
    const url = new URL(`${API_URL}/variants`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));
    url.searchParams.set("fields", "id,sku,in_stock");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: API_KEY!,
        Account: ACCOUNT_ID!,
        Accept: "application/json",
      },
    });

    if (!response.ok) throw new Error(`IP API error: ${response.status}`);

    const data = await response.json();
    const variants = data.variants || [];
    allVariants.push(...variants);

    if (variants.length < limit) break;
    page++;
  }

  return allVariants;
}
