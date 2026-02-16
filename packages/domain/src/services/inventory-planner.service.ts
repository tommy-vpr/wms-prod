/**
 * Inventory Planner Service
 * Business logic for syncing inventory from Inventory Planner
 *
 * Save to: packages/domain/src/services/inventory-planner.service.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface IPVariant {
  id: string;
  sku: string;
  in_stock: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
  totalIPVariants: number;
  totalWMSVariants: number;
}

export interface SyncPreview {
  totalIPVariants: number;
  totalWMSVariants: number;
  wouldCreate: number;
  wouldUpdate: number;
  wouldUnchange: number;
  notInWms: number;
  sampleChanges: Array<{ sku: string; from: number; to: number }>;
}

export interface SyncStatus {
  configured: boolean;
  syncLocationId: string | null;
  inventoryCount: number;
  totalQuantity: number;
  lastSync: {
    at: Date;
    by: string;
    result: Record<string, unknown>;
  } | null;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface InventoryPlannerRepository {
  fetchAllVariants(): Promise<IPVariant[]>;
}

export interface InventorySyncRepository {
  getOrCreateSyncLocation(): Promise<{ id: string; name: string }>;
  getSyncLocationStats(): Promise<{
    count: number;
    totalQuantity: number;
  } | null>;
  getProductVariantsBySku(skus: string[]): Promise<Map<string, string>>; // sku -> id
  getExistingInventoryAtLocation(
    locationId: string,
  ): Promise<Map<string, { id: string; quantity: number }>>; // variantId -> { id, quantity }
  createInventoryUnit(data: {
    productVariantId: string;
    locationId: string;
    quantity: number;
    receivedFrom: string;
  }): Promise<void>;
  updateInventoryQuantity(id: string, quantity: number): Promise<void>;
  getLastSync(): Promise<{
    at: Date;
    by: string;
    result: Record<string, unknown>;
  } | null>;
  createAuditLog(data: {
    userId?: string;
    action: string;
    entityType: string;
    entityId: string;
    changes: Record<string, unknown>;
  }): Promise<void>;
}

// ============================================================================
// Service
// ============================================================================

export interface InventoryPlannerServiceDeps {
  ipRepo: InventoryPlannerRepository;
  syncRepo: InventorySyncRepository;
}

export class InventoryPlannerService {
  private ipRepo: InventoryPlannerRepository;
  private syncRepo: InventorySyncRepository;

  constructor(deps: InventoryPlannerServiceDeps) {
    this.ipRepo = deps.ipRepo;
    this.syncRepo = deps.syncRepo;
  }

  /**
   * Get sync status
   */
  async getStatus(): Promise<SyncStatus> {
    const stats = await this.syncRepo.getSyncLocationStats();
    const lastSync = await this.syncRepo.getLastSync();

    // Check if IP API is configured (this would be injected/checked at repo level)
    const configured = true; // Assume configured if service is running

    return {
      configured,
      syncLocationId: stats ? "IP-SYNC" : null,
      inventoryCount: stats?.count ?? 0,
      totalQuantity: stats?.totalQuantity ?? 0,
      lastSync,
    };
  }

  /**
   * Preview what would be synced (dry run)
   */
  async preview(): Promise<SyncPreview> {
    // Fetch IP variants
    const ipVariants = await this.ipRepo.fetchAllVariants();
    const ipStockMap = new Map<string, number>(
      ipVariants.map((v) => [v.sku, v.in_stock ?? 0]),
    );

    // Get WMS product variants
    const skus = Array.from(ipStockMap.keys());
    const skuToVariantId = await this.syncRepo.getProductVariantsBySku(skus);

    // Get existing sync inventory
    const location = await this.syncRepo.getOrCreateSyncLocation();
    const existingInventory =
      await this.syncRepo.getExistingInventoryAtLocation(location.id);

    // Build existing by SKU (reverse lookup)
    const variantIdToSku = new Map<string, string>();
    for (const [sku, variantId] of skuToVariantId) {
      variantIdToSku.set(variantId, sku);
    }

    const existingBySku = new Map<string, number>();
    for (const [variantId, inv] of existingInventory) {
      const sku = variantIdToSku.get(variantId);
      if (sku) {
        existingBySku.set(sku, inv.quantity);
      }
    }

    // Analyze
    let wouldCreate = 0;
    let wouldUpdate = 0;
    let wouldUnchange = 0;
    let notInWms = 0;
    const changes: Array<{ sku: string; from: number; to: number }> = [];

    for (const [sku, ipStock] of ipStockMap) {
      if (!skuToVariantId.has(sku)) {
        notInWms++;
        continue;
      }

      const existing = existingBySku.get(sku);

      if (existing === undefined) {
        wouldCreate++;
        if (changes.length < 20) {
          changes.push({ sku, from: 0, to: ipStock });
        }
      } else if (existing === ipStock) {
        wouldUnchange++;
      } else {
        wouldUpdate++;
        if (changes.length < 20) {
          changes.push({ sku, from: existing, to: ipStock });
        }
      }
    }

    return {
      totalIPVariants: ipVariants.length,
      totalWMSVariants: skuToVariantId.size,
      wouldCreate,
      wouldUpdate,
      wouldUnchange,
      notInWms,
      sampleChanges: changes,
    };
  }

  /**
   * Sync inventory from Inventory Planner
   */
  async sync(userId?: string): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
      totalIPVariants: 0,
      totalWMSVariants: 0,
    };

    try {
      // 1. Fetch IP variants
      const ipVariants = await this.ipRepo.fetchAllVariants();
      result.totalIPVariants = ipVariants.length;

      const ipStockMap = new Map<string, number>(
        ipVariants.map((v) => [v.sku, v.in_stock ?? 0]),
      );

      // 2. Get or create sync location
      const location = await this.syncRepo.getOrCreateSyncLocation();

      // 3. Get WMS product variants
      const skus = Array.from(ipStockMap.keys());
      const skuToVariantId = await this.syncRepo.getProductVariantsBySku(skus);
      result.totalWMSVariants = skuToVariantId.size;

      // 4. Get existing inventory at sync location
      const existingInventory =
        await this.syncRepo.getExistingInventoryAtLocation(location.id);

      // 5. Process each IP variant
      for (const [sku, ipStock] of ipStockMap) {
        const productVariantId = skuToVariantId.get(sku);

        if (!productVariantId) {
          result.skipped++;
          continue;
        }

        try {
          const existing = existingInventory.get(productVariantId);

          if (!existing) {
            // Create new
            if (ipStock > 0) {
              await this.syncRepo.createInventoryUnit({
                productVariantId,
                locationId: location.id,
                quantity: ipStock,
                receivedFrom: "Inventory Planner Sync",
              });
              result.created++;
            } else {
              result.unchanged++;
            }
          } else if (existing.quantity !== ipStock) {
            // Update
            await this.syncRepo.updateInventoryQuantity(existing.id, ipStock);
            result.updated++;
          } else {
            result.unchanged++;
          }
        } catch (err: any) {
          result.errors.push(`${sku}: ${err.message}`);
        }
      }

      // 6. Create audit log
      await this.syncRepo.createAuditLog({
        userId,
        action: "INVENTORY_PLANNER_SYNC",
        entityType: "InventoryUnit",
        entityId: location.id,
        changes: {
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped,
          totalIPVariants: result.totalIPVariants,
          totalWMSVariants: result.totalWMSVariants,
          errorCount: result.errors.length,
        },
      });

      return result;
    } catch (error: any) {
      result.errors.push(error.message);
      throw error;
    }
  }
}

// ============================================================================
// Errors
// ============================================================================

export class InventoryPlannerAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`Inventory Planner API error (${statusCode}): ${message}`);
    this.name = "InventoryPlannerAPIError";
  }
}

export class InventoryPlannerNotConfiguredError extends Error {
  constructor() {
    super(
      "Inventory Planner API not configured. Set INVENTORY_PLANNER_API, INVENTORY_PLANNER_KEY, and INVENTORY_PLANNER_ACCOUNT.",
    );
    this.name = "InventoryPlannerNotConfiguredError";
  }
}
