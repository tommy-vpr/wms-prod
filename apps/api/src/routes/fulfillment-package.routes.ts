/**
 * Fulfillment Package Routes
 * CRUD endpoints for OrderPackage management during packing & shipping
 *
 * Save to: apps/api/src/routes/fulfillment-package.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { orderPackageRepository } from "@wms/db";
import { OrderPackageService, BoxRecommendationService } from "@wms/domain";

// =============================================================================
// Initialize Service
// =============================================================================

const orderPackageService = new OrderPackageService(
  orderPackageRepository,
  new BoxRecommendationService(),
);

// =============================================================================
// Routes — mounted at /fulfillment
// =============================================================================

export const fulfillmentPackageRoutes: FastifyPluginAsync = async (app) => {
  // ─────────────────────────────────────────────────────────────────────────
  // GET /fulfillment/:orderId/packages
  // Load all packages for an order (packing + shipping screens)
  // ─────────────────────────────────────────────────────────────────────────

  app.get<{ Params: { orderId: string } }>(
    "/:orderId/packages",
    async (request, reply) => {
      const { orderId } = request.params;

      const packages = await orderPackageService.getPackages(orderId);

      return reply.send({ packages });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /fulfillment/:orderId/packages/recommend
  // (Re-)run box recommendation algorithm and persist DRAFT packages
  // ─────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { orderId: string } }>(
    "/:orderId/packages/recommend",
    async (request, reply) => {
      const { orderId } = request.params;

      try {
        const { recommendation, packages } =
          await orderPackageService.recommendAndSave(orderId);

        return reply.send({
          packages,
          warnings: recommendation.warnings,
          totalEstimatedWeight: recommendation.totalEstimatedWeight,
          itemsMissingDimensions: recommendation.itemsMissingDimensions,
          itemsMissingWeight: recommendation.itemsMissingWeight,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Recommendation failed";
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /fulfillment/packages/:packageId
  // Update package box, dimensions, or weight (packer override)
  // ─────────────────────────────────────────────────────────────────────────

  app.patch<{
    Params: { packageId: string };
    Body: {
      boxId?: string | null;
      boxLabel?: string | null;
      length?: number | null;
      width?: number | null;
      height?: number | null;
      actualWeight?: number | null;
      weightUnit?: string;
    };
  }>("/packages/:packageId", async (request, reply) => {
    const { packageId } = request.params;

    try {
      const updated = await orderPackageService.updatePackage(
        packageId,
        request.body,
      );
      return reply.send({ package: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return reply.status(400).send({ error: message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /fulfillment/packages/:packageId/items
  // Replace all items in a package (packer redistributes items)
  // ─────────────────────────────────────────────────────────────────────────

  app.put<{
    Params: { packageId: string };
    Body: {
      items: Array<{
        productVariantId: string;
        sku: string;
        quantity: number;
        unitWeight: number | null;
        unitWeightUnit: string | null;
      }>;
    };
  }>("/packages/:packageId/items", async (request, reply) => {
    const { packageId } = request.params;
    const { items } = request.body;

    if (!items || items.length === 0) {
      return reply.status(400).send({ error: "Items array required" });
    }

    try {
      await orderPackageService.replacePackageItems(packageId, items);
      return reply.send({ success: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Replace items failed";
      return reply.status(400).send({ error: message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /fulfillment/:orderId/packages/add
  // Packer adds an extra empty package
  // ─────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { orderId: string } }>(
    "/:orderId/packages/add",
    async (request, reply) => {
      const { orderId } = request.params;

      try {
        const pkg = await orderPackageService.addPackage(orderId);
        return reply.send({ package: pkg });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Add package failed";
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /fulfillment/packages/:packageId
  // Remove a package (packer consolidates)
  // ─────────────────────────────────────────────────────────────────────────

  app.delete<{ Params: { packageId: string } }>(
    "/packages/:packageId",
    async (request, reply) => {
      const { packageId } = request.params;

      try {
        await orderPackageService.removePackage(packageId);
        return reply.send({ success: true });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Remove package failed";
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /fulfillment/:orderId/packages/pack
  // Mark all packages as PACKED with actual weights
  // Called when packer completes packing step
  // ─────────────────────────────────────────────────────────────────────────

  app.post<{
    Params: { orderId: string };
    Body: {
      packages: Array<{
        packageId: string;
        actualWeight: number;
        weightUnit?: string;
        length?: number;
        width?: number;
        height?: number;
      }>;
    };
  }>("/:orderId/packages/pack", async (request, reply) => {
    const { orderId } = request.params;
    const { packages } = request.body;

    if (!packages || packages.length === 0) {
      return reply.status(400).send({ error: "Packages array required" });
    }

    try {
      await orderPackageService.markPacked(orderId, packages);
      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mark packed failed";
      return reply.status(400).send({ error: message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /fulfillment/:orderId/packages/shipped
  // Mark all PACKED packages as SHIPPED (after label creation)
  // ─────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { orderId: string } }>(
    "/:orderId/packages/shipped",
    async (request, reply) => {
      const { orderId } = request.params;

      try {
        await orderPackageService.markShipped(orderId);
        return reply.send({ success: true });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Mark shipped failed";
        return reply.status(400).send({ error: message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /fulfillment/:orderId/packages/re-recommend
  // Reset to fresh algorithm suggestion (deletes DRAFT, re-runs)
  // ─────────────────────────────────────────────────────────────────────────

  app.post<{ Params: { orderId: string } }>(
    "/:orderId/packages/re-recommend",
    async (request, reply) => {
      const { orderId } = request.params;

      try {
        const { recommendation, packages } =
          await orderPackageService.reRecommend(orderId);

        return reply.send({
          packages,
          warnings: recommendation.warnings,
          totalEstimatedWeight: recommendation.totalEstimatedWeight,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Re-recommend failed";
        return reply.status(500).send({ error: message });
      }
    },
  );
};
