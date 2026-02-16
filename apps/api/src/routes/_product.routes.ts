/**
 * Product Import Routes
 * POST /products/import - Queue bulk product import
 * POST /products/import/sync-shopify - Sync products from Shopify
 * GET /products/import/stats - Get import stats
 * GET /products/import/job/:jobId - Get job status
 */

import { FastifyPluginAsync } from "fastify";
import {
  enqueueImportProducts,
  enqueueSyncShopifyProducts,
  getProductsQueue,
  type ProductImportItem,
} from "@wms/queue";
import { productRepository } from "@wms/db";

interface ImportRequestBody {
  products: ProductImportItem[];
}

interface ImportSingleBody {
  product: ProductImportItem["product"];
  variants: ProductImportItem["variants"];
}

export const productImportRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /products/import
   * Queue a bulk product import job
   */
  app.post<{ Body: ImportRequestBody }>("/import", async (request, reply) => {
    const { products } = request.body;

    if (!products || products.length === 0) {
      return reply.status(400).send({ error: "No products provided" });
    }

    // Validate products
    for (const item of products) {
      if (!item.product?.sku || !item.product?.name) {
        return reply.status(400).send({
          error: "Each product must have sku and name",
        });
      }
      if (!item.variants || item.variants.length === 0) {
        return reply.status(400).send({
          error: `Product ${item.product.sku} must have at least one variant`,
        });
      }
      for (const variant of item.variants) {
        if (!variant.sku || !variant.name) {
          return reply.status(400).send({
            error: `All variants for ${item.product.sku} must have sku and name`,
          });
        }
      }
    }

    const idempotencyKey = `import-${Date.now()}-${products.length}`;

    const job = await enqueueImportProducts({
      products,
      idempotencyKey,
    });

    app.log.info(
      { jobId: job.id, productCount: products.length },
      "Product import job queued",
    );

    return reply.status(202).send({
      success: true,
      jobId: job.id,
      message: `Import of ${products.length} products queued`,
      statusUrl: `/products/import/job/${job.id}`,
    });
  });

  /**
   * POST /products/import/single
   * Import a single product immediately (for smaller imports)
   */
  app.post<{ Body: ImportSingleBody }>(
    "/import/single",
    async (request, reply) => {
      const { product, variants } = request.body;

      if (!product?.sku || !product?.name) {
        return reply
          .status(400)
          .send({ error: "Product must have sku and name" });
      }

      if (!variants || variants.length === 0) {
        return reply
          .status(400)
          .send({ error: "At least one variant required" });
      }

      try {
        const result = await productRepository.upsertWithVariants(
          {
            sku: product.sku,
            name: product.name,
            description: product.description,
            brand: product.brand,
            category: product.category,
          },
          variants.map((v) => ({
            sku: v.sku,
            upc: v.upc,
            barcode: v.barcode,
            name: v.name,
            weight: v.weight,
            costPrice: v.costPrice,
            sellingPrice: v.sellingPrice,
            shopifyVariantId: v.shopifyVariantId,
          })),
        );

        return reply.send({
          success: true,
          product: result.product,
          variantsCreated: result.variantsCreated,
          variantsUpdated: result.variantsUpdated,
        });
      } catch (error: any) {
        app.log.error(error, "Product import failed");

        if (error.code === "P2002") {
          return reply.status(409).send({ error: "Duplicate SKU or UPC" });
        }

        return reply.status(500).send({
          error: error.message || "Import failed",
        });
      }
    },
  );

  /**
   * POST /products/import/sync-shopify
   * Queue a Shopify product sync job
   */
  app.post("/import/sync-shopify", async (request, reply) => {
    const idempotencyKey = `shopify-sync-${Date.now()}`;

    const job = await enqueueSyncShopifyProducts({
      idempotencyKey,
      limit: 50,
    });

    app.log.info({ jobId: job.id }, "Shopify product sync job queued");

    return reply.status(202).send({
      success: true,
      jobId: job.id,
      message: "Shopify product sync queued",
      statusUrl: `/products/import/job/${job.id}`,
    });
  });

  /**
   * GET /products/import/job/:jobId
   * Get job status and progress
   */
  app.get<{ Params: { jobId: string } }>(
    "/import/job/:jobId",
    async (request, reply) => {
      const { jobId } = request.params;
      const queue = getProductsQueue();

      const job = await queue.getJob(jobId);

      if (!job) {
        return reply.status(404).send({ error: "Job not found" });
      }

      const state = await job.getState();
      const progress = job.progress;

      return reply.send({
        jobId: job.id,
        name: job.name,
        state,
        progress,
        data: {
          productCount: (job.data as any).products?.length,
        },
        result: job.returnvalue,
        failedReason: job.failedReason,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
      });
    },
  );

  /**
   * GET /products/import/stats
   * Get product import statistics
   */
  app.get("/import/stats", async (request, reply) => {
    const stats = await productRepository.getStats();

    return reply.send(stats);
  });

  /**
   * GET /products/search
   * Search products by query
   */
  app.get<{ Querystring: { q: string; limit?: number } }>(
    "/search",
    async (request, reply) => {
      const { q, limit = "20" } = request.query;

      if (!q || q.length < 2) {
        return reply
          .status(400)
          .send({ error: "Query must be at least 2 characters" });
      }

      const products = await productRepository.search(q, Number(limit));

      return reply.send({ products, count: products.length });
    },
  );

  /**
   * GET /products
   * List products with pagination
   */
  app.get<{
    Querystring: {
      skip?: number;
      take?: number;
      brand?: string;
      category?: string;
    };
  }>("/", async (request, reply) => {
    const { skip = 0, take = 50, brand, category } = request.query;

    const result = await productRepository.list({
      skip: Number(skip),
      take: Number(take),
      brand,
      category,
    });

    return reply.send(result);
  });

  /**
   * GET /products/:id
   * Get product by ID with variants
   */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const product = await productRepository.findByIdWithVariants(id);

    if (!product) {
      return reply.status(404).send({ error: "Product not found" });
    }

    return reply.send(product);
  });
};
