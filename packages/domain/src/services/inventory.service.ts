/**
 * Inventory Service
 * Business logic for inventory management
 *
 * Save to: packages/domain/src/services/inventory.service.ts
 */

// ============================================================================
// Types
// ============================================================================

export type InventoryStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "PICKED"
  | "DAMAGED"
  | "IN_TRANSIT"
  | "QUARANTINE";

export interface InventoryUnit {
  id: string;
  productVariantId: string;
  sku: string;
  quantity: number;
  locationId: string;
  lotNumber?: string;
  expiryDate?: Date;
  receivedAt: Date;
  receivedFrom?: string;
  unitCost?: number;
  status: InventoryStatus;
}

export interface InventoryUnitWithDetails extends InventoryUnit {
  productVariant: {
    id: string;
    sku: string;
    name: string;
    barcode?: string;
  };
  location: {
    id: string;
    name: string;
    zone?: string;
    pickSequence?: number;
  };
}

export interface InventoryUnitWithAvailability extends InventoryUnitWithDetails {
  availableQuantity: number;
}

export interface Location {
  id: string;
  name: string;
  barcode?: string;
  type: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
  pickSequence?: number;
  isPickable: boolean;
  active: boolean;
}

export interface CreateInventoryData {
  productVariantId: string;
  locationId: string;
  quantity: number;
  lotNumber?: string;
  expiryDate?: Date;
  receivedFrom?: string;
  unitCost?: number;
}

export interface AdjustmentResult {
  previousQuantity: number;
  newQuantity: number;
  adjustment: number;
}

export interface MoveResult {
  movedQuantity: number;
  newUnitId?: string;
  originalRemaining?: number;
}

export interface AvailabilityResult {
  available: boolean;
  shortage: number;
  totalAvailable: number;
}

export interface InventoryStats {
  totalUnits: number;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  byStatus: Array<{ status: string; count: number; quantity: number }>;
  lowStockCount: number;
  expiringCount: number;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface InventoryRepository {
  findById(id: string): Promise<InventoryUnit | null>;
  findByIdWithDetails(id: string): Promise<InventoryUnitWithDetails | null>;
  findAvailableByProductVariant(
    productVariantId: string,
  ): Promise<InventoryUnitWithAvailability[]>;

  findByProductVariant(productVariantId: string): Promise<InventoryUnit[]>;

  findAvailableByProductVariant(
    productVariantId: string,
  ): Promise<InventoryUnitWithDetails[]>;
  findAvailableBySku(sku: string): Promise<InventoryUnitWithAvailability[]>;
  findByLocation(locationId: string): Promise<InventoryUnit[]>;
  findByLocationWithDetails(
    locationId: string,
  ): Promise<InventoryUnitWithDetails[]>;
  getExpiringInventory(
    daysUntilExpiry: number,
  ): Promise<InventoryUnitWithDetails[]>;
  getTotalAvailableByProductVariant(productVariantId: string): Promise<number>;
  getStats(): Promise<InventoryStats>;
  create(
    data: CreateInventoryData & { status?: InventoryStatus },
  ): Promise<InventoryUnit>;
  updateStatus(id: string, status: InventoryStatus): Promise<void>;
  updateQuantity(id: string, quantity: number): Promise<void>;
  decrementQuantity(id: string, amount: number): Promise<void>;
  incrementQuantity(id: string, amount: number): Promise<void>;
  updateLocation(id: string, locationId: string): Promise<void>;
}

export interface LocationRepository {
  findById(id: string): Promise<Location | null>;
  findByName(name: string): Promise<Location | null>;
  findByBarcode(barcode: string): Promise<Location | null>;
  findAll(options?: {
    zone?: string;
    type?: string;
    active?: boolean;
  }): Promise<Location[]>;
  create(data: Omit<Location, "id">): Promise<Location>;
  update(id: string, data: Partial<Location>): Promise<Location>;
}

export interface ProductVariantRepository {
  findById(id: string): Promise<{ id: string; sku: string } | null>;
}

// ============================================================================
// Service
// ============================================================================

export interface InventoryServiceDeps {
  inventoryRepo: InventoryRepository;
  locationRepo?: LocationRepository;
  productVariantRepo?: ProductVariantRepository;
}

export class InventoryService {
  private inventoryRepo: InventoryRepository;
  private locationRepo?: LocationRepository;
  private productVariantRepo?: ProductVariantRepository;

  constructor(deps: InventoryServiceDeps) {
    this.inventoryRepo = deps.inventoryRepo;
    this.locationRepo = deps.locationRepo;
    this.productVariantRepo = deps.productVariantRepo;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async getById(id: string): Promise<InventoryUnit | null> {
    return this.inventoryRepo.findById(id);
  }

  async getByIdWithDetails(
    id: string,
  ): Promise<InventoryUnitWithDetails | null> {
    return this.inventoryRepo.findByIdWithDetails(id);
  }

  async getAvailableBySku(
    sku: string,
  ): Promise<InventoryUnitWithAvailability[]> {
    return this.inventoryRepo.findAvailableBySku(sku);
  }

  async getAvailableByProductVariant(
    productVariantId: string,
  ): Promise<InventoryUnitWithAvailability[]> {
    return this.inventoryRepo.findAvailableByProductVariant(productVariantId);
  }

  async getAvailableQuantityBySku(sku: string): Promise<number> {
    const units = await this.inventoryRepo.findAvailableBySku(sku);
    return units.reduce((sum, unit) => sum + unit.availableQuantity, 0);
  }

  async getAvailableQuantityByProductVariant(
    productVariantId: string,
  ): Promise<number> {
    return this.inventoryRepo.getTotalAvailableByProductVariant(
      productVariantId,
    );
  }

  async checkAvailability(
    productVariantId: string,
    quantityNeeded: number,
  ): Promise<AvailabilityResult> {
    const totalAvailable =
      await this.inventoryRepo.getTotalAvailableByProductVariant(
        productVariantId,
      );
    const shortage = Math.max(0, quantityNeeded - totalAvailable);

    return {
      available: shortage === 0,
      shortage,
      totalAvailable,
    };
  }

  async getByLocation(locationId: string): Promise<InventoryUnit[]> {
    return this.inventoryRepo.findByLocation(locationId);
  }

  async getByLocationWithDetails(
    locationId: string,
  ): Promise<InventoryUnitWithDetails[]> {
    return this.inventoryRepo.findByLocationWithDetails(locationId);
  }

  async getExpiringInventory(
    daysUntilExpiry: number,
  ): Promise<InventoryUnitWithDetails[]> {
    return this.inventoryRepo.getExpiringInventory(daysUntilExpiry);
  }

  async getStats(): Promise<InventoryStats> {
    return this.inventoryRepo.getStats();
  }

  // ==========================================================================
  // Commands - Receiving
  // ==========================================================================

  async receive(data: CreateInventoryData): Promise<InventoryUnit> {
    if (this.productVariantRepo) {
      const variant = await this.productVariantRepo.findById(
        data.productVariantId,
      );
      if (!variant) {
        throw new ProductVariantNotFoundError(data.productVariantId);
      }
    }

    if (this.locationRepo) {
      const location = await this.locationRepo.findById(data.locationId);
      if (!location) {
        throw new LocationNotFoundError(data.locationId);
      }
      if (!location.active) {
        throw new LocationNotActiveError(data.locationId);
      }
    }

    if (data.quantity <= 0) {
      throw new InvalidQuantityError("Quantity must be positive");
    }

    return this.inventoryRepo.create({ ...data, status: "AVAILABLE" });
  }

  // ==========================================================================
  // Commands - State Transitions
  // ==========================================================================

  async reserve(inventoryUnitId: string): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (unit.status !== "AVAILABLE") {
      throw new InventoryNotAvailableError(inventoryUnitId, unit.status);
    }

    await this.inventoryRepo.updateStatus(inventoryUnitId, "RESERVED");
  }

  async release(inventoryUnitId: string): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (unit.status !== "RESERVED") {
      throw new InvalidStateTransitionError(
        inventoryUnitId,
        unit.status,
        "AVAILABLE",
        "Only RESERVED inventory can be released",
      );
    }

    await this.inventoryRepo.updateStatus(inventoryUnitId, "AVAILABLE");
  }

  async markPicked(inventoryUnitId: string, quantity: number): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (unit.status !== "RESERVED") {
      throw new InvalidStateTransitionError(
        inventoryUnitId,
        unit.status,
        "PICKED",
        "Only RESERVED inventory can be picked",
      );
    }

    if (quantity > unit.quantity) {
      throw new InsufficientQuantityError(
        inventoryUnitId,
        quantity,
        unit.quantity,
      );
    }

    if (quantity === unit.quantity) {
      await this.inventoryRepo.updateStatus(inventoryUnitId, "PICKED");
    } else {
      await this.inventoryRepo.decrementQuantity(inventoryUnitId, quantity);
    }
  }

  async markDamaged(inventoryUnitId: string, _reason?: string): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (!["AVAILABLE", "RESERVED"].includes(unit.status)) {
      throw new InvalidStateTransitionError(
        inventoryUnitId,
        unit.status,
        "DAMAGED",
        "Only AVAILABLE or RESERVED inventory can be marked damaged",
      );
    }

    await this.inventoryRepo.updateStatus(inventoryUnitId, "DAMAGED");
  }

  async markPartialDamaged(
    inventoryUnitId: string,
    quantity: number,
    _reason?: string,
  ): Promise<{ damagedUnitId: string; remainingQuantity: number }> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (quantity >= unit.quantity) {
      throw new InvalidQuantityError(
        `Cannot mark ${quantity} as damaged, only ${unit.quantity} available. Use markDamaged for full unit.`,
      );
    }

    if (quantity <= 0) {
      throw new InvalidQuantityError("Quantity must be positive");
    }

    const damagedUnit = await this.inventoryRepo.create({
      productVariantId: unit.productVariantId,
      locationId: unit.locationId,
      quantity,
      lotNumber: unit.lotNumber,
      expiryDate: unit.expiryDate,
      status: "DAMAGED",
    });

    await this.inventoryRepo.decrementQuantity(inventoryUnitId, quantity);

    return {
      damagedUnitId: damagedUnit.id,
      remainingQuantity: unit.quantity - quantity,
    };
  }

  // ==========================================================================
  // Commands - Adjustments
  // ==========================================================================

  async adjust(
    inventoryUnitId: string,
    newQuantity: number,
    _reason: string,
  ): Promise<AdjustmentResult> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (newQuantity < 0) {
      throw new InvalidQuantityError("Quantity cannot be negative");
    }

    if (unit.status !== "AVAILABLE") {
      throw new InventoryNotAvailableError(inventoryUnitId, unit.status);
    }

    const previousQuantity = unit.quantity;
    await this.inventoryRepo.updateQuantity(inventoryUnitId, newQuantity);

    return {
      previousQuantity,
      newQuantity,
      adjustment: newQuantity - previousQuantity,
    };
  }

  // ==========================================================================
  // Commands - Movement
  // ==========================================================================

  async move(
    inventoryUnitId: string,
    newLocationId: string,
    quantity?: number,
  ): Promise<MoveResult> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (unit.status !== "AVAILABLE") {
      throw new InventoryNotAvailableError(inventoryUnitId, unit.status);
    }

    if (this.locationRepo) {
      const location = await this.locationRepo.findById(newLocationId);
      if (!location) {
        throw new LocationNotFoundError(newLocationId);
      }
      if (!location.active) {
        throw new LocationNotActiveError(newLocationId);
      }
    }

    const moveQuantity = quantity ?? unit.quantity;

    if (moveQuantity > unit.quantity) {
      throw new InsufficientQuantityError(
        inventoryUnitId,
        moveQuantity,
        unit.quantity,
      );
    }

    if (moveQuantity <= 0) {
      throw new InvalidQuantityError("Quantity must be positive");
    }

    if (moveQuantity < unit.quantity) {
      const newUnit = await this.inventoryRepo.create({
        productVariantId: unit.productVariantId,
        locationId: newLocationId,
        quantity: moveQuantity,
        lotNumber: unit.lotNumber,
        expiryDate: unit.expiryDate,
        receivedFrom: unit.receivedFrom,
        unitCost: unit.unitCost,
        status: "AVAILABLE",
      });

      await this.inventoryRepo.decrementQuantity(inventoryUnitId, moveQuantity);

      return {
        movedQuantity: moveQuantity,
        newUnitId: newUnit.id,
        originalRemaining: unit.quantity - moveQuantity,
      };
    }

    await this.inventoryRepo.updateLocation(inventoryUnitId, newLocationId);
    return { movedQuantity: unit.quantity };
  }

  // ==========================================================================
  // Location Management
  // ==========================================================================

  async getLocation(id: string): Promise<Location | null> {
    if (!this.locationRepo) {
      throw new Error("Location repository not configured");
    }
    return this.locationRepo.findById(id);
  }

  async getLocationByBarcode(barcode: string): Promise<Location | null> {
    if (!this.locationRepo) {
      throw new Error("Location repository not configured");
    }
    return this.locationRepo.findByBarcode(barcode);
  }

  async getLocations(options?: {
    zone?: string;
    type?: string;
    active?: boolean;
  }): Promise<Location[]> {
    if (!this.locationRepo) {
      throw new Error("Location repository not configured");
    }
    return this.locationRepo.findAll(options);
  }

  async createLocation(data: Omit<Location, "id">): Promise<Location> {
    if (!this.locationRepo) {
      throw new Error("Location repository not configured");
    }

    const existingByName = await this.locationRepo.findByName(data.name);
    if (existingByName) {
      throw new LocationNameExistsError(data.name);
    }

    if (data.barcode) {
      const existingByBarcode = await this.locationRepo.findByBarcode(
        data.barcode,
      );
      if (existingByBarcode) {
        throw new LocationBarcodeExistsError(data.barcode);
      }
    }

    return this.locationRepo.create(data);
  }

  async updateLocation(id: string, data: Partial<Location>): Promise<Location> {
    if (!this.locationRepo) {
      throw new Error("Location repository not configured");
    }

    const existing = await this.locationRepo.findById(id);
    if (!existing) {
      throw new LocationNotFoundError(id);
    }

    if (data.name && data.name !== existing.name) {
      const existingByName = await this.locationRepo.findByName(data.name);
      if (existingByName) {
        throw new LocationNameExistsError(data.name);
      }
    }

    return this.locationRepo.update(id, data);
  }
}

// ============================================================================
// Errors
// ============================================================================

export class InventoryUnitNotFoundError extends Error {
  constructor(public readonly inventoryUnitId: string) {
    super(`Inventory unit not found: ${inventoryUnitId}`);
    this.name = "InventoryUnitNotFoundError";
  }
}

export class InventoryNotAvailableError extends Error {
  constructor(
    public readonly inventoryUnitId: string,
    public readonly currentStatus: InventoryStatus,
  ) {
    super(
      `Inventory unit ${inventoryUnitId} is not available - status is ${currentStatus}`,
    );
    this.name = "InventoryNotAvailableError";
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly inventoryUnitId: string,
    public readonly fromStatus: InventoryStatus,
    public readonly toStatus: InventoryStatus,
    message?: string,
  ) {
    super(
      message ||
        `Cannot transition inventory ${inventoryUnitId} from ${fromStatus} to ${toStatus}`,
    );
    this.name = "InvalidStateTransitionError";
  }
}

export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuantityError";
  }
}

export class InsufficientQuantityError extends Error {
  constructor(
    public readonly inventoryUnitId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient quantity in unit ${inventoryUnitId}: requested ${requested}, available ${available}`,
    );
    this.name = "InsufficientQuantityError";
  }
}

export class ProductVariantNotFoundError extends Error {
  constructor(public readonly productVariantId: string) {
    super(`Product variant not found: ${productVariantId}`);
    this.name = "ProductVariantNotFoundError";
  }
}

export class LocationNotFoundError extends Error {
  constructor(public readonly locationId: string) {
    super(`Location not found: ${locationId}`);
    this.name = "LocationNotFoundError";
  }
}

export class LocationNotActiveError extends Error {
  constructor(public readonly locationId: string) {
    super(`Location is not active: ${locationId}`);
    this.name = "LocationNotActiveError";
  }
}

export class LocationNameExistsError extends Error {
  constructor(public readonly name: string) {
    super(`Location name already exists: ${name}`);
    this.name = "LocationNameExistsError";
  }
}

export class LocationBarcodeExistsError extends Error {
  constructor(public readonly barcode: string) {
    super(`Location barcode already exists: ${barcode}`);
    this.name = "LocationBarcodeExistsError";
  }
}
