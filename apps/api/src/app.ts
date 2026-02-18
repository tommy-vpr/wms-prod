import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { healthRoutes } from "./routes/health.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { orderRoutes } from "./routes/order.route.js";

import { shopifyWebhookRoutes } from "./routes/webhooks/shopify/orders/create.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";

import { inventoryRoutes } from "./routes/inventory.routes.js";
import { productRoutes } from "./routes/product.routes.js";
import { inventoryPlannerRoutes } from "./routes/inventory-planner.routes.js";
import { locationImportRoutes } from "./routes/location-import.routes.js";
import { locationRoutes } from "./routes/location.routes.js";
import { fulfillmentRoutes } from "./routes/fulfillment.routes.js";
// Server Sent Event
import { ssePlugin } from "./plugins/sse.plugin.js";
import { shippingRoutes } from "./routes/shipping.routes.js";
import { receivingRoutes } from "./routes/receiving.routes.js";
import cycleCountRoutes from "./routes/cycle-count.routes.js";
import scanRoutes from "./routes/scan.routes.js";
import packingImageRoutes from "./routes/packing-images.routes.js";
import { invoiceRoutes } from "./routes/invoice.routes.js";
import { workflowCountsRoutes } from "./routes/workflow-counts.routes.js";
import { fulfillmentPackageRoutes } from "./routes/fulfillment-package.routes.js";
import { adminUserRoutes } from "./routes/admin/users.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV === "development",
  });

  // Redis-backed rate limiting
  const redis: RedisClient = new (Redis as any)(process.env.REDIS_URL!);

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    redis,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (request, context) => ({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      },
    }),
  });

  await app.register(cors, {
    origin: ["https://app.hq.team", "http://localhost:5173"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  app.setErrorHandler(errorHandler);

  // ============================================================================
  // Public Routes (no auth required)
  // ============================================================================
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(shopifyWebhookRoutes, { prefix: "/webhooks/shopify" });
  await app.register(ssePlugin);

  // ============================================================================
  // Protected Routes (auth required)
  // ============================================================================
  await app.register(async (protectedRoutes) => {
    // Add auth hook to all routes in this scope
    // protectedRoutes.addHook("onRequest", authenticate); ******* FALLBACK ******
    protectedRoutes.addHook("preHandler", authenticate);
    // Register protected routes
    await protectedRoutes.register(productRoutes, { prefix: "/products" });
    // Location
    await protectedRoutes.register(locationRoutes, { prefix: "/locations" });
    // Fulfillment
    await protectedRoutes.register(fulfillmentRoutes, {
      prefix: "/fulfillment",
    });
    await protectedRoutes.register(fulfillmentPackageRoutes, {
      prefix: "/fulfillment",
    });

    await protectedRoutes.register(packingImageRoutes, {
      prefix: "/packing-images",
    });
    // Shipping Label
    await protectedRoutes.register(shippingRoutes, {
      prefix: "/shipping",
    });
    // Import location
    await protectedRoutes.register(locationImportRoutes, {
      prefix: "/locations",
    });
    // Receiving
    await protectedRoutes.register(receivingRoutes, {
      prefix: "/receiving",
    });
    // Orders
    await protectedRoutes.register(orderRoutes, { prefix: "/orders" });
    // Inventory
    await protectedRoutes.register(inventoryRoutes, { prefix: "/inventory" });
    // Inventory planner
    await protectedRoutes.register(inventoryPlannerRoutes, {
      prefix: "/inventory-planner",
    });
    // Scan lookup
    await protectedRoutes.register(scanRoutes, {
      prefix: "/scan",
    });
    // Cycle Count
    await protectedRoutes.register(cycleCountRoutes, {
      prefix: "/cycle-count",
    });
    // Invoices
    await protectedRoutes.register(invoiceRoutes, {
      prefix: "/invoices",
    });
    // Workflow counts
    await protectedRoutes.register(workflowCountsRoutes, {
      prefix: "/workflow-counts",
    });

    // Admin user management
    await protectedRoutes.register(adminUserRoutes, { prefix: "/admin/users" });
  });

  return app;
}
