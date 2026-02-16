/**
 * Location Service
 * Business logic for location management and import
 *
 * Save to: packages/domain/src/services/location.service.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface LocationImportRow {
  sku: string;
  locationName: string;
  warehouse?: string;
  aisle?: string;
  bay?: string;
  tier?: string;
  space?: string;
  bin?: string;
}

export interface LocationImportResult {
  locationsCreated: number;
  locationsExisted: number;
  inventoryCreated: number;
  inventoryExisted: number;
  skipped: number;
  errors: string[];
  totalRows: number;
}

export interface LocationRecord {
  id: string;
  name: string;
  barcode: string | null;
  type: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  pickSequence: number | null;
  isPickable: boolean;
  active: boolean;
}

export interface UnassignedVariant {
  id: string;
  sku: string;
  name: string;
  product: {
    name: string;
    brand: string | null;
  };
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface LocationServiceLocationRepo {
  findById(id: string): Promise<LocationRecord | null>;
  findByName(name: string): Promise<LocationRecord | null>;
  findByNames(names: string[]): Promise<Map<string, string>>; // name -> id
  create(data: {
    name: string;
    type: string;
    zone?: string;
    aisle?: string;
    rack?: string;
    shelf?: string;
    bin?: string;
    pickSequence?: number;
    isPickable: boolean;
    active: boolean;
  }): Promise<LocationRecord>;
  findAll(options?: {
    active?: boolean;
    skip?: number;
    take?: number;
  }): Promise<LocationRecord[]>;
  count(options?: { active?: boolean }): Promise<number>;
}

export interface LocationServiceVariantRepo {
  findBySkus(skus: string[]): Promise<Map<string, string>>; // sku -> id
}

export interface LocationServiceInventoryRepo {
  findByVariantAndLocation(
    productVariantId: string,
    locationId: string,
  ): Promise<{ id: string } | null>;
  create(data: {
    productVariantId: string;
    locationId: string;
    quantity: number;
    status: string;
    receivedFrom: string;
    receivedAt: Date;
  }): Promise<{ id: string }>;
  getVariantIdsWithInventory(): Promise<Set<string>>;
}

export interface LocationServiceAuditRepo {
  create(data: {
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

export interface LocationServiceDeps {
  locationRepo: LocationServiceLocationRepo;
  variantRepo: LocationServiceVariantRepo;
  inventoryRepo: LocationServiceInventoryRepo;
  auditRepo: LocationServiceAuditRepo;
}

export class LocationService {
  private locationRepo: LocationServiceLocationRepo;
  private variantRepo: LocationServiceVariantRepo;
  private inventoryRepo: LocationServiceInventoryRepo;
  private auditRepo: LocationServiceAuditRepo;

  constructor(deps: LocationServiceDeps) {
    this.locationRepo = deps.locationRepo;
    this.variantRepo = deps.variantRepo;
    this.inventoryRepo = deps.inventoryRepo;
    this.auditRepo = deps.auditRepo;
  }

  /**
   * Calculate pick sequence from aisle/bay/tier
   */
  private calculatePickSequence(
    aisle?: string,
    bay?: string,
    tier?: string,
  ): number | undefined {
    if (!aisle || !bay || !tier) return undefined;

    const aisleNum = aisle.charCodeAt(0) - 64; // A=1, B=2, etc.
    const bayNum = parseInt(bay) || 0;
    const tierNum = tier.charCodeAt(0) - 64;

    return aisleNum * 10000 + bayNum * 100 + tierNum;
  }

  /**
   * Import locations and create inventory units from parsed rows
   */
  async importLocations(
    rows: LocationImportRow[],
    userId?: string,
  ): Promise<LocationImportResult> {
    const result: LocationImportResult = {
      locationsCreated: 0,
      locationsExisted: 0,
      inventoryCreated: 0,
      inventoryExisted: 0,
      skipped: 0,
      errors: [],
      totalRows: rows.length,
    };

    if (rows.length === 0) {
      return result;
    }

    // Get unique SKUs and location names
    const skus = [...new Set(rows.map((r) => r.sku))];
    const locationNames = [...new Set(rows.map((r) => r.locationName))];

    // Batch lookup SKUs -> variant IDs
    const skuToVariantId = await this.variantRepo.findBySkus(skus);

    // Batch lookup existing locations
    const locationNameToId = await this.locationRepo.findByNames(locationNames);

    // Process each row
    for (const row of rows) {
      const productVariantId = skuToVariantId.get(row.sku);

      // Skip if SKU not in WMS
      if (!productVariantId) {
        result.skipped++;
        result.errors.push(`SKU not found: ${row.sku}`);
        continue;
      }

      let locationId = locationNameToId.get(row.locationName);

      // Create location if not exists
      if (!locationId) {
        try {
          const pickSequence = this.calculatePickSequence(
            row.aisle,
            row.bay,
            row.tier,
          );

          const location = await this.locationRepo.create({
            name: row.locationName,
            type: "STORAGE",
            zone: row.aisle || row.warehouse,
            aisle: row.aisle,
            rack: row.bay,
            shelf: row.tier,
            bin: row.bin !== "X" ? row.bin : undefined,
            pickSequence,
            isPickable: true,
            active: true,
          });

          locationId = location.id;
          locationNameToId.set(row.locationName, locationId);
          result.locationsCreated++;
        } catch (err: any) {
          // Handle unique constraint (race condition)
          if (err.code === "P2002") {
            const existing = await this.locationRepo.findByName(
              row.locationName,
            );
            if (existing) {
              locationId = existing.id;
              locationNameToId.set(row.locationName, locationId);
              result.locationsExisted++;
            }
          } else {
            result.errors.push(`Location ${row.locationName}: ${err.message}`);
            continue;
          }
        }
      } else {
        result.locationsExisted++;
      }

      if (!locationId) continue;

      // Check if inventory unit already exists
      const existingInventory =
        await this.inventoryRepo.findByVariantAndLocation(
          productVariantId,
          locationId,
        );

      if (existingInventory) {
        result.inventoryExisted++;
      } else {
        // Create inventory unit with qty=0
        try {
          await this.inventoryRepo.create({
            productVariantId,
            locationId,
            quantity: 0,
            status: "AVAILABLE",
            receivedFrom: "Location Import",
            receivedAt: new Date(),
          });
          result.inventoryCreated++;
        } catch (err: any) {
          result.errors.push(
            `Inventory ${row.sku}@${row.locationName}: ${err.message}`,
          );
        }
      }
    }

    // Create audit log
    await this.auditRepo.create({
      userId,
      action: "LOCATION_IMPORT",
      entityType: "Location",
      entityId: "bulk",
      changes: {
        locationsCreated: result.locationsCreated,
        locationsExisted: result.locationsExisted,
        inventoryCreated: result.inventoryCreated,
        inventoryExisted: result.inventoryExisted,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
    });

    return result;
  }

  /**
   * Get location by ID
   */
  async getById(id: string): Promise<LocationRecord | null> {
    return this.locationRepo.findById(id);
  }

  /**
   * Get location by name
   */
  async getByName(name: string): Promise<LocationRecord | null> {
    return this.locationRepo.findByName(name);
  }

  /**
   * List locations
   */
  async list(options?: {
    active?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{
    locations: LocationRecord[];
    total: number;
  }> {
    const [locations, total] = await Promise.all([
      this.locationRepo.findAll(options),
      this.locationRepo.count({ active: options?.active }),
    ]);

    return { locations, total };
  }

  /**
   * Get unassigned variant count (variants without inventory)
   */
  async getUnassignedCount(): Promise<number> {
    const variantIdsWithInventory =
      await this.inventoryRepo.getVariantIdsWithInventory();
    // This would need a count query - simplified for now
    return 0; // Placeholder - implement in route with direct query
  }
}

// ============================================================================
// Errors
// ============================================================================

export class LocationImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocationImportError";
  }
}
