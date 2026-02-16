/**
 * Product Routes
 * Uses ProductService for business logic
 *
 * Save to: apps/api/src/routes/product.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma, productRepository } from "@wms/db";
import {
  ProductService,
  parseProductCsv,
  parseProductCsvFlat,
  ProductNotFoundError,
  ProductImportError,
  ProductSearchError,
  ProductHasAllocatedInventoryError,
} from "@wms/domain";
import {
  enqueueImportProducts,
  enqueueSyncShopifyProducts,
  getProductsQueue,
  type ProductImportItem,
} from "@wms/queue";

// ============================================================================
// Inventory Query Repository Adapter
// ============================================================================

const inventoryQueryRepo = {
  async getTotalByProductVariant(productVariantId: string): Promise<number> {
    const result = await prisma.inventoryUnit.aggregate({
      where: { productVariantId },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  },

  async getAvailableByProductVariant(
    productVariantId: string,
  ): Promise<number> {
    const result = await prisma.inventoryUnit.aggregate({
      where: {
        productVariantId,
        status: "AVAILABLE",
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  },

  async getByProductVariantGroupedByLocation(
    productVariantId: string,
  ): Promise<
    Array<{ locationId: string; locationName: string; quantity: number }>
  > {
    const inventory = await prisma.inventoryUnit.findMany({
      where: {
        productVariantId,
        quantity: { gt: 0 },
      },
      include: {
        location: {
          select: { id: true, name: true },
        },
      },
    });

    const locationMap = new Map<
      string,
      { locationName: string; quantity: number }
    >();

    for (const inv of inventory) {
      const existing = locationMap.get(inv.locationId);
      if (existing) {
        existing.quantity += inv.quantity;
      } else {
        locationMap.set(inv.locationId, {
          locationName: inv.location.name,
          quantity: inv.quantity,
        });
      }
    }

    return Array.from(locationMap.entries()).map(([locationId, data]) => ({
      locationId,
      locationName: data.locationName,
      quantity: data.quantity,
    }));
  },

  async hasAllocatedInventory(productVariantId: string): Promise<boolean> {
    const count = await prisma.allocation.count({
      where: {
        productVariantId,
        status: { in: ["PENDING", "ALLOCATED", "PARTIALLY_PICKED"] },
      },
    });
    return count > 0;
  },
};

// ============================================================================
// Product Repository Adapter
// ============================================================================

const productRepoAdapter = {
  ...productRepository,

  async findVariantByBarcode(barcode: string) {
    return prisma.productVariant.findFirst({
      where: { barcode },
    });
  },
};

// ============================================================================
// Initialize Service
// ============================================================================

const productService = new ProductService({
  productRepo: productRepoAdapter,
  inventoryRepo: inventoryQueryRepo,
});

// ============================================================================
// Routes
// ============================================================================

export const productRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /products
   * List products with pagination and filters
   */
  app.get<{
    Querystring: {
      skip?: string;
      take?: string;
      brand?: string;
      category?: string;
      active?: string;
    };
  }>("/", async (request, reply) => {
    const { skip = "0", take = "50", brand, category, active } = request.query;

    const result = await productService.list({
      skip: Number(skip),
      take: Number(take),
      brand,
      category,
      active: active !== undefined ? active === "true" : undefined,
    });

    return reply.send(result);
  });

  /**
   * GET /products/search
   * Search products by query
   */
  app.get<{ Querystring: { q: string; limit?: string } }>(
    "/search",
    async (request, reply) => {
      const { q, limit = "20" } = request.query;

      try {
        const products = await productService.search(q, Number(limit));
        return reply.send({ products, count: products.length });
      } catch (error) {
        if (error instanceof ProductSearchError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * GET /products/stats
   * Get product statistics
   */
  app.get("/stats", async (request, reply) => {
    const stats = await productService.getStats();
    return reply.send(stats);
  });

  /**
   * GET /products/lookup/:identifier
   * Find variant by SKU, UPC, or barcode
   */
  app.get<{ Params: { identifier: string } }>(
    "/lookup/:identifier",
    async (request, reply) => {
      const { identifier } = request.params;

      const variant = await productService.findVariant(identifier);

      if (!variant) {
        return reply.status(404).send({ error: "Variant not found" });
      }

      const product = await productService.getProduct(variant.productId);

      return reply.send({
        variant,
        product,
      });
    },
  );

  /**
   * GET /products/:id
   * Get product by ID with variants
   */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const product = await productService.getProduct(id);

    if (!product) {
      return reply.status(404).send({ error: "Product not found" });
    }

    return reply.send(product);
  });

  /**
   * GET /products/:id/inventory
   * Get product with inventory levels
   */
  app.get<{ Params: { id: string } }>(
    "/:id/inventory",
    async (request, reply) => {
      const { id } = request.params;

      const product = await productService.getProductWithInventory(id);

      if (!product) {
        return reply.status(404).send({ error: "Product not found" });
      }

      return reply.send(product);
    },
  );

  /**
   * PATCH /products/:id
   * Update product
   */
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      brand?: string;
      category?: string;
    };
  }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    try {
      const product = await productService.updateProduct(id, data);
      return reply.send({ success: true, product });
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      throw error;
    }
  });

  /**
   * PATCH /products/variants/:id
   * Update variant
   */
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      upc?: string;
      barcode?: string;
      costPrice?: number;
      sellingPrice?: number;
      weight?: number;
      weightUnit?: string;
      length?: number;
      width?: number;
      height?: number;
      dimensionUnit?: string;
      mcQuantity?: number;
      mcWeight?: number;
      mcWeightUnit?: string;
      mcLength?: number;
      mcWidth?: number;
      mcHeight?: number;
      mcDimensionUnit?: string;
      trackLots?: boolean;
      trackExpiry?: boolean;
    };
  }>("/variants/:id", async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    try {
      const variant = await productService.updateVariant(id, data);
      return reply.send({ success: true, variant });
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      throw error;
    }
  });

  /**
   * POST /products/:id/deactivate
   * Deactivate product (soft delete)
   */
  app.post<{ Params: { id: string } }>(
    "/:id/deactivate",
    async (request, reply) => {
      const { id } = request.params;

      try {
        const product = await productService.deactivateProduct(id);
        return reply.send({ success: true, product });
      } catch (error) {
        if (error instanceof ProductNotFoundError) {
          return reply.status(404).send({ error: error.message });
        }
        if (error instanceof ProductHasAllocatedInventoryError) {
          return reply.status(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  // ==========================================================================
  // Import Routes
  // ==========================================================================

  /**
   * POST /products/import
   * Queue a bulk product import job
   */
  app.post<{
    Body: {
      products: ProductImportItem[];
    };
  }>("/import", async (request, reply) => {
    const { products } = request.body;

    if (!products || products.length === 0) {
      return reply.status(400).send({ error: "No products provided" });
    }

    const validationErrors: string[] = [];

    for (let i = 0; i < products.length; i++) {
      const item = products[i];
      const validation = productService.validateImport(
        item.product,
        item.variants,
      );

      if (!validation.valid) {
        validationErrors.push(
          `Product ${i + 1} (${item.product?.sku || "unknown"}): ${validation.errors.join(", ")}`,
        );
      }
    }

    if (validationErrors.length > 0) {
      return reply.status(400).send({
        error: "Validation failed",
        details: validationErrors,
      });
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
   * POST /products/import/csv
   * Parse CSV rows server-side, then enqueue the import job
   *
   * Body: { rows: Record<string, string>[], mode?: "grouped" | "flat" }
   *
   * Returns a jobId for polling progress via GET /products/import/job/:jobId
   */
  app.post<{
    Body: {
      rows: Record<string, string>[];
      mode?: "grouped" | "flat";
    };
  }>("/import/csv", async (request, reply) => {
    const { rows, mode = "grouped" } = request.body;

    if (!rows || rows.length === 0) {
      return reply.status(400).send({ error: "No CSV rows provided" });
    }

    // Parse CSV rows into product + variant groups
    const parseResult =
      mode === "flat" ? parseProductCsvFlat(rows) : parseProductCsv(rows);

    if (parseResult.groups.length === 0) {
      return reply.status(400).send({
        error: "No valid products found in CSV",
        parseErrors: parseResult.errors,
        skipped: parseResult.skipped,
      });
    }

    // Convert parsed groups into ProductImportItem[] for the queue
    const products: ProductImportItem[] = parseResult.groups.map((group) => ({
      product: group.product,
      variants: group.variants,
    }));

    // Validate before enqueuing
    const validationErrors: string[] = [];

    for (let i = 0; i < products.length; i++) {
      const item = products[i];
      const validation = productService.validateImport(
        item.product,
        item.variants,
      );

      if (!validation.valid) {
        validationErrors.push(
          `Product ${i + 1} (${item.product?.sku || "unknown"}): ${validation.errors.join(", ")}`,
        );
      }
    }

    if (validationErrors.length > 0) {
      return reply.status(400).send({
        error: "Validation failed",
        parseErrors: parseResult.errors,
        details: validationErrors,
      });
    }

    // Enqueue the import job
    const idempotencyKey = `csv-import-${Date.now()}-${products.length}`;

    const job = await enqueueImportProducts({
      products,
      idempotencyKey,
    });

    app.log.info(
      {
        jobId: job.id,
        totalRows: parseResult.totalRows,
        productCount: products.length,
        skipped: parseResult.skipped,
      },
      "CSV product import job queued",
    );

    return reply.status(202).send({
      success: true,
      jobId: job.id,
      totalRows: parseResult.totalRows,
      productsQueued: products.length,
      parseErrors: parseResult.errors,
      skipped: parseResult.skipped,
      message: `Import of ${products.length} products queued from ${parseResult.totalRows} CSV rows`,
      statusUrl: `/products/import/job/${job.id}`,
    });
  });

  /**
   * POST /products/import/single
   * Import a single product immediately
   */
  app.post<{
    Body: {
      product: {
        sku: string;
        name: string;
        description?: string;
        brand?: string;
        category?: string;
      };
      variants: Array<{
        sku: string;
        name: string;
        upc?: string;
        barcode?: string;
        costPrice?: number;
        sellingPrice?: number;
        weight?: number;
        weightUnit?: string;
        length?: number;
        width?: number;
        height?: number;
        dimensionUnit?: string;
        mcQuantity?: number;
        mcWeight?: number;
        mcWeightUnit?: string;
        mcLength?: number;
        mcWidth?: number;
        mcHeight?: number;
        mcDimensionUnit?: string;
      }>;
    };
  }>("/import/single", async (request, reply) => {
    const { product, variants } = request.body;

    try {
      const result = await productService.importProduct(product, variants);

      return reply.send({
        success: true,
        created: result.created,
        product: result.product,
        variantsCreated: result.variantsCreated,
        variantsUpdated: result.variantsUpdated,
      });
    } catch (error) {
      if (error instanceof ProductImportError) {
        return reply.status(400).send({ error: error.message });
      }

      app.log.error(error, "Product import failed");

      if ((error as any).code === "P2002") {
        return reply.status(409).send({ error: "Duplicate SKU or UPC" });
      }

      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Import failed",
      });
    }
  });

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
};
