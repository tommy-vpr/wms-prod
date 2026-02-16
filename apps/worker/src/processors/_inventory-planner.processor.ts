/**
 * Inventory Planner Processor
 * Processes inventory sync jobs from Inventory Planner
 *
 * Save to: apps/worker/src/processors/inventory-planner.processor.ts
 */

import { Job } from "bullmq";
import { prisma } from "@wms/db";
import type {
  SyncInventoryPlannerJobData,
  SyncInventoryPlannerResult,
} from "@wms/queue";

// ============================================================================
// Environment
// ============================================================================

const API_URL = process.env.INVENTORY_PLANNER_API;
const API_KEY = process.env.INVENTORY_PLANNER_KEY;
const ACCOUNT_ID = process.env.INVENTORY_PLANNER_ACCOUNT;
const SYNC_LOCATION_NAME = "IP-SYNC";

// ============================================================================
// Types
// ============================================================================

interface IPVariant {
  id: string;
  sku: string;
  in_stock: number;
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchAllIPVariants(): Promise<IPVariant[]> {
  if (!API_URL || !API_KEY || !ACCOUNT_ID) {
    throw new Error(
      "Inventory Planner not configured. Set INVENTORY_PLANNER_API, INVENTORY_PLANNER_KEY, INVENTORY_PLANNER_ACCOUNT",
    );
  }

  const allVariants: IPVariant[] = [];
  let page = 0;
  const limit = 1000;

  while (true) {
    const url = new URL(`${API_URL}/variants`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));
    url.searchParams.set("fields", "id,sku,in_stock");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: API_KEY,
        Account: ACCOUNT_ID,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Inventory Planner API error: ${response.status}`);
    }

    const data = await response.json();
    const variants = data.variants || [];
    allVariants.push(...variants);

    if (variants.length < limit) break;
    page++;
  }

  return allVariants;
}

async function getOrCreateSyncLocation(): Promise<string> {
  let location = await prisma.location.findUnique({
    where: { name: SYNC_LOCATION_NAME },
  });

  if (!location) {
    location = await prisma.location.create({
      data: {
        name: SYNC_LOCATION_NAME,
        type: "STORAGE",
        zone: "IP",
        isPickable: true,
        active: true,
      },
    });
    console.log(`[IP Sync] Created sync location: ${location.id}`);
  }

  return location.id;
}

// ============================================================================
// Processor
// ============================================================================

export async function processInventoryPlannerJob(
  job: Job<SyncInventoryPlannerJobData>,
): Promise<SyncInventoryPlannerResult> {
  console.log(`🔄 [IP Sync] Starting sync (Job ${job.id})`);

  const result: SyncInventoryPlannerResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    totalIPVariants: 0,
    totalWMSVariants: 0,
  };

  try {
    // 1. Fetch all IP variants
    await job.updateProgress(5);
    console.log(`[IP Sync] Fetching variants from Inventory Planner...`);

    const ipVariants = await fetchAllIPVariants();
    result.totalIPVariants = ipVariants.length;
    console.log(`[IP Sync] Found ${ipVariants.length} IP variants`);

    const ipStockMap = new Map<string, number>(
      ipVariants.map((v) => [v.sku, v.in_stock ?? 0]),
    );

    // 2. Get or create sync location
    await job.updateProgress(10);
    const syncLocationId = await getOrCreateSyncLocation();

    // 3. Get all WMS product variants
    const productVariants = await prisma.productVariant.findMany({
      select: { id: true, sku: true },
    });
    result.totalWMSVariants = productVariants.length;

    const skuToVariantId = new Map<string, string>(
      productVariants.map((v) => [v.sku, v.id]),
    );
    console.log(`[IP Sync] Found ${productVariants.length} WMS variants`);

    // 4. Get existing inventory at sync location
    const existingUnits = await prisma.inventoryUnit.findMany({
      where: { locationId: syncLocationId },
      select: { id: true, productVariantId: true, quantity: true },
    });

    const existingByVariantId = new Map(
      existingUnits.map((u) => [
        u.productVariantId,
        { id: u.id, quantity: u.quantity },
      ]),
    );
    console.log(
      `[IP Sync] Found ${existingUnits.length} existing inventory units`,
    );

    // 5. Process each IP variant
    await job.updateProgress(15);
    const totalToProcess = ipStockMap.size;
    let processed = 0;

    for (const [sku, ipStock] of ipStockMap) {
      const productVariantId = skuToVariantId.get(sku);

      // Skip if SKU not in WMS
      if (!productVariantId) {
        result.skipped++;
        processed++;
        continue;
      }

      try {
        const existing = existingByVariantId.get(productVariantId);

        if (!existing) {
          // Create new inventory unit (only if stock > 0)
          if (ipStock > 0) {
            await prisma.inventoryUnit.create({
              data: {
                productVariantId,
                locationId: syncLocationId,
                quantity: ipStock,
                status: "AVAILABLE",
                receivedFrom: "Inventory Planner Sync",
                receivedAt: new Date(),
              },
            });
            result.created++;
          } else {
            result.unchanged++;
          }
        } else if (existing.quantity !== ipStock) {
          // Update existing
          await prisma.inventoryUnit.update({
            where: { id: existing.id },
            data: { quantity: ipStock },
          });
          result.updated++;
        } else {
          result.unchanged++;
        }
      } catch (err: any) {
        result.errors.push(`${sku}: ${err.message}`);
      }

      processed++;

      // Update progress every 100 items
      if (processed % 100 === 0) {
        const progress = 15 + Math.floor((processed / totalToProcess) * 80);
        await job.updateProgress(progress);
      }
    }

    // 6. Create audit log
    await job.updateProgress(98);
    await prisma.auditLog.create({
      data: {
        userId: job.data.userId ?? null,
        action: "INVENTORY_PLANNER_SYNC",
        entityType: "InventoryUnit",
        entityId: syncLocationId,
        changes: JSON.parse(
          JSON.stringify({
            created: result.created,
            updated: result.updated,
            unchanged: result.unchanged,
            skipped: result.skipped,
            totalIPVariants: result.totalIPVariants,
            totalWMSVariants: result.totalWMSVariants,
            errorCount: result.errors.length,
          }),
        ),
      },
    });

    await job.updateProgress(100);

    console.log(`✅ [IP Sync] Completed:`, {
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return result;
  } catch (error: any) {
    console.error(`❌ [IP Sync] Failed:`, error.message);
    result.errors.push(error.message);
    throw error;
  }
}
