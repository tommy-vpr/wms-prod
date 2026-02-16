/**
 * Product Processor
 * Handles product import and sync jobs
 */

import { Job } from "bullmq";
import { productRepository } from "@wms/db";
import {
  PRODUCT_JOBS,
  type ImportProductsJobData,
  type ImportSingleProductJobData,
  type SyncShopifyProductsJobData,
  type ImportProductsResult,
} from "@wms/queue";

// ============================================================================
// Job Processors
// ============================================================================

/**
 * Process bulk product import job
 */
async function processImportProducts(
  job: Job<ImportProductsJobData>,
): Promise<ImportProductsResult> {
  const { products, userId } = job.data;

  console.log(`[Products] Starting import of ${products.length} products`);

  const result: ImportProductsResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < products.length; i++) {
    const item = products[i];

    try {
      const importResult = await productRepository.upsertWithVariants(
        {
          sku: item.product.sku,
          name: item.product.name,
          description: item.product.description,
          brand: item.product.brand,
          category: item.product.category,
        },
        item.variants.map((v) => ({
          sku: v.sku,
          upc: v.upc,
          barcode: v.barcode,
          name: v.name,
          weight: v.weight,
          weightUnit: v.weightUnit,
          length: v.length,
          width: v.width,
          height: v.height,
          dimensionUnit: v.dimensionUnit,
          mcQuantity: v.mcQuantity,
          mcWeight: v.mcWeight,
          mcWeightUnit: v.mcWeightUnit,
          mcLength: v.mcLength,
          mcWidth: v.mcWidth,
          mcHeight: v.mcHeight,
          mcDimensionUnit: v.mcDimensionUnit,
          costPrice: v.costPrice,
          sellingPrice: v.sellingPrice,
          shopifyVariantId: v.shopifyVariantId,
        })),
      );

      result.success++;

      console.log(
        `[Products] ${i + 1}/${products.length}: ${item.product.name} - ` +
          `${importResult.created ? "created" : "updated"}, ` +
          `${importResult.variantsCreated} variants created, ` +
          `${importResult.variantsUpdated} variants updated`,
      );

      // Update job progress
      await job.updateProgress(Math.round(((i + 1) / products.length) * 100));
    } catch (error) {
      result.failed++;
      result.errors.push({
        sku: item.product.sku,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      console.error(
        `[Products] Failed to import ${item.product.sku}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(
    `[Products] Import complete: ${result.success} success, ${result.failed} failed`,
  );

  return result;
}

/**
 * Process single product import job
 */
async function processImportSingleProduct(
  job: Job<ImportSingleProductJobData>,
): Promise<{ success: boolean; productId?: string; error?: string }> {
  const { product, variants, userId } = job.data;

  console.log(`[Products] Importing single product: ${product.name}`);

  try {
    const importResult = await productRepository.upsertWithVariants(
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

    console.log(
      `[Products] Imported ${product.name}: ${importResult.variants.length} variants`,
    );

    return {
      success: true,
      productId: importResult.product.id,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Products] Failed to import ${product.sku}:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Process Shopify product sync job
 */
async function processSyncShopifyProducts(
  job: Job<SyncShopifyProductsJobData>,
): Promise<{ synced: number; cursor?: string }> {
  const { cursor, limit = 50 } = job.data;

  console.log(
    `[Products] Syncing Shopify products (cursor: ${cursor || "start"})`,
  );

  // Get Shopify credentials from env
  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const shopifyAccessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shopifyDomain || !shopifyAccessToken) {
    throw new Error("Missing Shopify credentials");
  }

  try {
    // Fetch products from Shopify
    const url = new URL(
      `https://${shopifyDomain}/admin/api/2024-01/products.json`,
    );
    url.searchParams.set("limit", limit.toString());
    if (cursor) {
      url.searchParams.set("page_info", cursor);
    }

    const response = await fetch(url.toString(), {
      headers: {
        "X-Shopify-Access-Token": shopifyAccessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();
    const shopifyProducts = data.products || [];

    let synced = 0;

    for (const shopifyProduct of shopifyProducts) {
      try {
        // Map Shopify product to our format
        const productData = {
          sku: shopifyProduct.handle || `shopify-${shopifyProduct.id}`,
          name: shopifyProduct.title,
          description: shopifyProduct.body_html?.replace(/<[^>]*>/g, "") || "",
          brand: shopifyProduct.vendor,
          category: shopifyProduct.product_type,
          shopifyProductId: shopifyProduct.id.toString(),
        };

        const variantsData = (shopifyProduct.variants || []).map(
          (variant: any) => ({
            sku: variant.sku || `shopify-var-${variant.id}`,
            upc: variant.barcode,
            barcode: variant.barcode,
            name:
              variant.title === "Default Title"
                ? shopifyProduct.title
                : `${shopifyProduct.title} - ${variant.title}`,
            weight: variant.weight ? parseFloat(variant.weight) : undefined,
            costPrice: variant.compare_at_price
              ? parseFloat(variant.compare_at_price)
              : undefined,
            sellingPrice: variant.price ? parseFloat(variant.price) : undefined,
            shopifyVariantId: variant.id.toString(),
          }),
        );

        await productRepository.upsertWithVariants(productData, variantsData);
        synced++;

        console.log(`[Products] Synced: ${shopifyProduct.title}`);
      } catch (error) {
        console.error(
          `[Products] Failed to sync ${shopifyProduct.title}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Get next page cursor from Link header
    const linkHeader = response.headers.get("Link");
    let nextCursor: string | undefined;

    if (linkHeader) {
      const nextMatch = linkHeader.match(
        /<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/,
      );
      if (nextMatch) {
        nextCursor = nextMatch[1];
      }
    }

    console.log(
      `[Products] Shopify sync batch complete: ${synced} products synced`,
    );

    return { synced, cursor: nextCursor };
  } catch (error) {
    console.error("[Products] Shopify sync failed:", error);
    throw error;
  }
}

// ============================================================================
// Main Processor
// ============================================================================

export async function processProductJob(job: Job): Promise<unknown> {
  console.log(`[Products] Processing job: ${job.name} (${job.id})`);

  try {
    switch (job.name) {
      case PRODUCT_JOBS.IMPORT_PRODUCTS:
        return processImportProducts(job as Job<ImportProductsJobData>);

      case PRODUCT_JOBS.IMPORT_SINGLE:
        return processImportSingleProduct(
          job as Job<ImportSingleProductJobData>,
        );

      case PRODUCT_JOBS.SYNC_SHOPIFY_PRODUCTS:
        return processSyncShopifyProducts(
          job as Job<SyncShopifyProductsJobData>,
        );

      default:
        throw new Error(`Unknown product job: ${job.name}`);
    }
  } catch (error) {
    console.error(`[Products] Job failed: ${job.name}`, error);
    throw error;
  }
}
