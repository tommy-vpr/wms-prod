/**
 * Inventory Service
 * Manages inventory units and their states
 */

export type InventoryStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "PICKED"
  | "DAMAGED"
  | "IN_TRANSIT";

export interface InventoryUnit {
  id: string;
  sku: string;
  quantity: number;
  locationId: string;
  warehouseId: string;
  lotNumber?: string;
  expiryDate?: Date;
  receivedAt: Date;
  status: InventoryStatus;
}

export interface InventoryRepository {
  findById(id: string): Promise<InventoryUnit | null>;
  findBySku(sku: string, warehouseId: string): Promise<InventoryUnit[]>;
  findAvailableBySku(
    sku: string,
    warehouseId: string,
  ): Promise<InventoryUnit[]>;
  findByLocation(locationId: string): Promise<InventoryUnit[]>;
  updateStatus(id: string, status: InventoryStatus): Promise<void>;
  updateQuantity(id: string, quantity: number): Promise<void>;
  decrementQuantity(id: string, amount: number): Promise<void>;
}

export interface InventoryServiceDeps {
  inventoryRepo: InventoryRepository;
}

export class InventoryService {
  private inventoryRepo: InventoryRepository;

  constructor(deps: InventoryServiceDeps) {
    this.inventoryRepo = deps.inventoryRepo;
  }

  /**
   * Get available inventory for a SKU in a warehouse
   */
  async getAvailableInventory(
    sku: string,
    warehouseId: string,
  ): Promise<InventoryUnit[]> {
    return this.inventoryRepo.findAvailableBySku(sku, warehouseId);
  }

  /**
   * Get total available quantity for a SKU
   */
  async getAvailableQuantity(
    sku: string,
    warehouseId: string,
  ): Promise<number> {
    const units = await this.getAvailableInventory(sku, warehouseId);
    return units.reduce((sum, unit) => sum + unit.quantity, 0);
  }

  /**
   * Check if sufficient inventory exists for an order line
   */
  async checkAvailability(
    sku: string,
    quantity: number,
    warehouseId: string,
  ): Promise<{ available: boolean; shortage: number }> {
    const availableQty = await this.getAvailableQuantity(sku, warehouseId);
    const shortage = Math.max(0, quantity - availableQty);
    return {
      available: shortage === 0,
      shortage,
    };
  }

  /**
   * Reserve inventory unit (mark as RESERVED)
   */
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

  /**
   * Release reserved inventory back to available
   */
  async release(inventoryUnitId: string): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (unit.status !== "RESERVED") {
      throw new Error(
        `Cannot release inventory unit ${inventoryUnitId} - status is ${unit.status}`,
      );
    }

    await this.inventoryRepo.updateStatus(inventoryUnitId, "AVAILABLE");
  }

  /**
   * Mark inventory as picked (after successful pick)
   */
  async markPicked(inventoryUnitId: string, quantity: number): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    if (unit.status !== "RESERVED") {
      throw new Error(
        `Cannot pick inventory unit ${inventoryUnitId} - status is ${unit.status}, expected RESERVED`,
      );
    }

    if (quantity > unit.quantity) {
      throw new Error(
        `Cannot pick ${quantity} from unit ${inventoryUnitId} - only ${unit.quantity} available`,
      );
    }

    // If picking entire unit, mark as PICKED
    // If partial, decrement quantity and keep reserved status
    if (quantity === unit.quantity) {
      await this.inventoryRepo.updateStatus(inventoryUnitId, "PICKED");
    } else {
      await this.inventoryRepo.decrementQuantity(inventoryUnitId, quantity);
    }
  }

  /**
   * Mark inventory as damaged
   */
  async markDamaged(inventoryUnitId: string, reason?: string): Promise<void> {
    const unit = await this.inventoryRepo.findById(inventoryUnitId);
    if (!unit) {
      throw new InventoryUnitNotFoundError(inventoryUnitId);
    }

    await this.inventoryRepo.updateStatus(inventoryUnitId, "DAMAGED");
    // TODO: Emit damage event with reason for audit trail
  }

  /**
   * Get inventory at a specific location
   */
  async getInventoryAtLocation(locationId: string): Promise<InventoryUnit[]> {
    return this.inventoryRepo.findByLocation(locationId);
  }
}

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
