/**
 * Inventory Planner Processor
 * Processes inventory sync jobs from Inventory Planner
 *
 * UPDATED: Only updates existing inventory, no auto-create
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

  // Track unassigned SKUs (no inventory record)
  const unassignedSkus: string[] = [];

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

    // 2. Get all WMS product variants
    await job.updateProgress(10);
    const productVariants = await prisma.productVariant.findMany({
      select: { id: true, sku: true },
    });
    result.totalWMSVariants = productVariants.length;

    const skuToVariantId = new Map<string, string>(
      productVariants.map((v) => [v.sku, v.id]),
    );
    console.log(`[IP Sync] Found ${productVariants.length} WMS variants`);

    // 3. Get ALL existing inventory units (any location) for these variants
    const variantIds = Array.from(skuToVariantId.values());
    const existingUnits = await prisma.inventoryUnit.findMany({
      where: { productVariantId: { in: variantIds } },
      select: { id: true, productVariantId: true, quantity: true },
      orderBy: { createdAt: "asc" }, // Oldest first (primary location)
    });

    // Group by variant - use first (oldest) unit per variant
    const existingByVariantId = new Map<
      string,
      { id: string; quantity: number }
    >();
    for (const unit of existingUnits) {
      if (!existingByVariantId.has(unit.productVariantId)) {
        existingByVariantId.set(unit.productVariantId, {
          id: unit.id,
          quantity: unit.quantity,
        });
      }
    }
    console.log(
      `[IP Sync] Found ${existingByVariantId.size} existing inventory units`,
    );

    // 4. Process each IP variant
    await job.updateProgress(15);
    const totalToProcess = ipStockMap.size;
    let processed = 0;

    for (const [sku, ipStock] of ipStockMap) {
      const productVariantId = skuToVariantId.get(sku);

      // Skip if SKU not in WMS products
      if (!productVariantId) {
        result.skipped++;
        processed++;
        continue;
      }

      const existing = existingByVariantId.get(productVariantId);

      // No inventory unit exists - skip (needs location assignment)
      if (!existing) {
        result.skipped++;
        unassignedSkus.push(sku);
        processed++;
        continue;
      }

      try {
        if (existing.quantity !== ipStock) {
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

    // 5. Create audit log
    await job.updateProgress(98);
    await prisma.auditLog.create({
      data: {
        userId: job.data.userId ?? null,
        action: "INVENTORY_PLANNER_SYNC",
        entityType: "InventoryUnit",
        entityId: "bulk",
        changes: JSON.parse(
          JSON.stringify({
            updated: result.updated,
            unchanged: result.unchanged,
            skipped: result.skipped,
            totalIPVariants: result.totalIPVariants,
            totalWMSVariants: result.totalWMSVariants,
            unassignedCount: unassignedSkus.length,
            unassignedSample: unassignedSkus.slice(0, 20),
            errorCount: result.errors.length,
          }),
        ),
      },
    });

    await job.updateProgress(100);

    console.log(`✅ [IP Sync] Completed:`, {
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: result.skipped,
      unassigned: unassignedSkus.length,
      errors: result.errors.length,
    });

    if (unassignedSkus.length > 0) {
      console.log(
        `⚠️ [IP Sync] ${unassignedSkus.length} SKUs need location assignment`,
      );
    }

    return result;
  } catch (error: any) {
    console.error(`❌ [IP Sync] Failed:`, error.message);
    result.errors.push(error.message);
    throw error;
  }
}

// /**
//  * Inventory Planner Processor
//  * Processes inventory sync jobs from Inventory Planner
//  *
//  * UPDATED: Only updates existing inventory, no auto-create
//  *
//  * Save to: apps/worker/src/processors/inventory-planner.processor.ts
//  */

// import { Job } from "bullmq";
// import { prisma } from "@wms/db";
// import type {
//   SyncInventoryPlannerJobData,
//   SyncInventoryPlannerResult,
// } from "@wms/queue";

// // ============================================================================
// // Environment
// // ============================================================================

// const API_URL = process.env.INVENTORY_PLANNER_API;
// const API_KEY = process.env.INVENTORY_PLANNER_KEY;
// const ACCOUNT_ID = process.env.INVENTORY_PLANNER_ACCOUNT;

// // ============================================================================
// // Types
// // ============================================================================

// interface IPVariant {
//   id: string;
//   sku: string;
//   in_stock: number;
// }

// // ============================================================================
// // Helpers
// // ============================================================================

// async function fetchAllIPVariants(): Promise<IPVariant[]> {
//   if (!API_URL || !API_KEY || !ACCOUNT_ID) {
//     throw new Error(
//       "Inventory Planner not configured. Set INVENTORY_PLANNER_API, INVENTORY_PLANNER_KEY, INVENTORY_PLANNER_ACCOUNT",
//     );
//   }

//   const allVariants: IPVariant[] = [];
//   let page = 0;
//   const limit = 1000;

//   while (true) {
//     const url = new URL(`${API_URL}/variants`);
//     url.searchParams.set("limit", String(limit));
//     url.searchParams.set("page", String(page));
//     url.searchParams.set("fields", "id,sku,in_stock");

//     const response = await fetch(url.toString(), {
//       headers: {
//         Authorization: API_KEY,
//         Account: ACCOUNT_ID,
//         Accept: "application/json",
//       },
//     });

//     if (!response.ok) {
//       throw new Error(`Inventory Planner API error: ${response.status}`);
//     }

//     const data = await response.json();
//     const variants = data.variants || [];
//     allVariants.push(...variants);

//     if (variants.length < limit) break;
//     page++;
//   }

//   return allVariants;
// }

// // ============================================================================
// // Processor
// // ============================================================================

// export async function processInventoryPlannerJob(
//   job: Job<SyncInventoryPlannerJobData>,
// ): Promise<SyncInventoryPlannerResult> {
//   console.log(`🔄 [IP Sync] Starting sync (Job ${job.id})`);

//   const result: SyncInventoryPlannerResult = {
//     created: 0,
//     updated: 0,
//     unchanged: 0,
//     skipped: 0,
//     errors: [],
//     totalIPVariants: 0,
//     totalWMSVariants: 0,
//   };

//   // Track unassigned SKUs (no inventory record)
//   const unassignedSkus: string[] = [];

//   try {
//     // 1. Fetch all IP variants
//     await job.updateProgress(5);
//     console.log(`[IP Sync] Fetching variants from Inventory Planner...`);

//     const ipVariants = await fetchAllIPVariants();
//     result.totalIPVariants = ipVariants.length;
//     console.log(`[IP Sync] Found ${ipVariants.length} IP variants`);

//     const ipStockMap = new Map<string, number>(
//       ipVariants.map((v) => [v.sku, v.in_stock ?? 0]),
//     );

//     // 2. Get all WMS product variants
//     await job.updateProgress(10);
//     const productVariants = await prisma.productVariant.findMany({
//       select: { id: true, sku: true },
//     });
//     result.totalWMSVariants = productVariants.length;

//     const skuToVariantId = new Map<string, string>(
//       productVariants.map((v) => [v.sku, v.id]),
//     );
//     console.log(`[IP Sync] Found ${productVariants.length} WMS variants`);

//     // 3. Get ALL existing inventory units (any location) for these variants
//     const variantIds = Array.from(skuToVariantId.values());
//     const existingUnits = await prisma.inventoryUnit.findMany({
//       where: { productVariantId: { in: variantIds } },
//       select: { id: true, productVariantId: true, quantity: true },
//       orderBy: { createdAt: "asc" }, // Oldest first (primary location)
//     });

//     // Group by variant - use first (oldest) unit per variant
//     const existingByVariantId = new Map<
//       string,
//       { id: string; quantity: number }
//     >();
//     for (const unit of existingUnits) {
//       if (!existingByVariantId.has(unit.productVariantId)) {
//         existingByVariantId.set(unit.productVariantId, {
//           id: unit.id,
//           quantity: unit.quantity,
//         });
//       }
//     }
//     console.log(
//       `[IP Sync] Found ${existingByVariantId.size} existing inventory units`,
//     );

//     // 4. Process each IP variant
//     await job.updateProgress(15);
//     const totalToProcess = ipStockMap.size;
//     let processed = 0;

//     for (const [sku, ipStock] of ipStockMap) {
//       const productVariantId = skuToVariantId.get(sku);

//       // Skip if SKU not in WMS products
//       if (!productVariantId) {
//         result.skipped++;
//         processed++;
//         continue;
//       }

//       const existing = existingByVariantId.get(productVariantId);

//       // No inventory unit exists - skip (needs location assignment)
//       if (!existing) {
//         result.skipped++;
//         unassignedSkus.push(sku);
//         processed++;
//         continue;
//       }

//       try {
//         if (existing.quantity !== ipStock) {
//           // Update existing
//           await prisma.inventoryUnit.update({
//             where: { id: existing.id },
//             data: { quantity: ipStock },
//           });
//           result.updated++;
//         } else {
//           result.unchanged++;
//         }
//       } catch (err: any) {
//         result.errors.push(`${sku}: ${err.message}`);
//       }

//       processed++;

//       // Update progress every 100 items
//       if (processed % 100 === 0) {
//         const progress = 15 + Math.floor((processed / totalToProcess) * 80);
//         await job.updateProgress(progress);
//       }
//     }

//     // 5. Create audit log
//     await job.updateProgress(98);
//     await prisma.auditLog.create({
//       data: {
//         userId: job.data.userId ?? null,
//         action: "INVENTORY_PLANNER_SYNC",
//         entityType: "InventoryUnit",
//         entityId: "bulk",
//         changes: JSON.parse(
//           JSON.stringify({
//             updated: result.updated,
//             unchanged: result.unchanged,
//             skipped: result.skipped,
//             totalIPVariants: result.totalIPVariants,
//             totalWMSVariants: result.totalWMSVariants,
//             unassignedCount: unassignedSkus.length,
//             unassignedSample: unassignedSkus.slice(0, 20),
//             errorCount: result.errors.length,
//           }),
//         ),
//       },
//     });

//     await job.updateProgress(100);

//     console.log(`✅ [IP Sync] Completed:`, {
//       updated: result.updated,
//       unchanged: result.unchanged,
//       skipped: result.skipped,
//       unassigned: unassignedSkus.length,
//       errors: result.errors.length,
//     });

//     if (unassignedSkus.length > 0) {
//       console.log(
//         `⚠️ [IP Sync] ${unassignedSkus.length} SKUs need location assignment`,
//       );
//     }

//     return result;
//   } catch (error: any) {
//     console.error(`❌ [IP Sync] Failed:`, error.message);
//     result.errors.push(error.message);
//     throw error;
//   }
// }
