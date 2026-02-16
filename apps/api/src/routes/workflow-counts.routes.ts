/**
 * Workflow Counts Route
 *
 * Single lightweight endpoint that returns pending counts for each
 * workflow stage. Used by sidebar badges. Designed to be polled
 * every 30s with near-zero Postgres cost.
 *
 * Save to: apps/api/src/routes/workflow-counts.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@wms/db";

export const workflowCountsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /workflow-counts
   *
   * Returns:
   *  - fulfillment: orders PENDING/CONFIRMED (need allocation)
   *  - pick: orders ALLOCATED/READY_TO_PICK/PICKING (need picking)
   *  - pack: orders PICKED/PACKING (need packing)
   *  - ship: orders PACKED (need shipping)
   *  - orders: total active orders (everything not terminal)
   */
  app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Single query with conditional counts — fast even on large tables
      const result = await prisma.$queryRaw<
        Array<{
          fulfillment: bigint;
          pick: bigint;
          pack: bigint;
          ship: bigint;
          orders: bigint;
        }>
      >`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('PENDING', 'CONFIRMED'))                         AS fulfillment,
            COUNT(*) FILTER (WHERE status IN ('ALLOCATED', 'READY_TO_PICK', 'PICKING', 'PARTIALLY_ALLOCATED'))  AS pick,
            COUNT(*) FILTER (WHERE status IN ('PICKED', 'PACKING'))                            AS pack,
            COUNT(*) FILTER (WHERE status = 'PACKED')                                          AS ship,
            COUNT(*) FILTER (WHERE status NOT IN ('SHIPPED', 'DELIVERED', 'CANCELLED'))        AS orders
          FROM orders
        `;

      const row = result[0];

      return reply.send({
        fulfillment: Number(row.fulfillment),
        pick: Number(row.pick),
        pack: Number(row.pack),
        ship: Number(row.ship),
        orders: Number(row.orders),
      });
    } catch (err: any) {
      console.error("[WorkflowCounts] Error:", err);
      return reply.status(500).send({ error: err.message });
    }
  });
};
