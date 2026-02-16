/**
 * Allocation Policy
 * Strategy pattern for inventory allocation rules
 */

export interface AvailableInventory {
  id: string;
  sku: string;
  quantity: number;
  locationId: string;
  lotNumber?: string;
  expiryDate?: Date;
  receivedAt: Date;
  status: "AVAILABLE" | "RESERVED" | "PICKED" | "DAMAGED";
}

export interface AllocationRequest {
  orderId: string;
  sku: string;
  quantity: number;
  warehouseId: string;
  preferredZone?: string;
}

export interface Allocation {
  inventoryUnitId: string;
  orderId: string;
  sku: string;
  quantity: number;
  locationId: string;
  lotNumber?: string;
}

export interface AllocationPolicy {
  name: string;
  allocate(
    request: AllocationRequest,
    available: AvailableInventory[],
  ): Allocation[];
}

/**
 * FIFO (First In, First Out)
 * Allocates oldest inventory first based on receivedAt date
 */
export class FIFOPolicy implements AllocationPolicy {
  name = "FIFO";

  allocate(
    request: AllocationRequest,
    available: AvailableInventory[],
  ): Allocation[] {
    const sorted = [...available]
      .filter((u) => u.sku === request.sku && u.status === "AVAILABLE")
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

    return this.allocateFromSorted(request, sorted);
  }

  private allocateFromSorted(
    request: AllocationRequest,
    sorted: AvailableInventory[],
  ): Allocation[] {
    const allocations: Allocation[] = [];
    let remaining = request.quantity;

    for (const unit of sorted) {
      if (remaining <= 0) break;

      const allocateQty = Math.min(unit.quantity, remaining);
      allocations.push({
        inventoryUnitId: unit.id,
        orderId: request.orderId,
        sku: request.sku,
        quantity: allocateQty,
        locationId: unit.locationId,
        lotNumber: unit.lotNumber,
      });

      remaining -= allocateQty;
    }

    if (remaining > 0) {
      throw new InsufficientInventoryError(
        request.sku,
        request.quantity,
        request.quantity - remaining,
      );
    }

    return allocations;
  }
}

/**
 * FEFO (First Expired, First Out)
 * Allocates inventory closest to expiry first
 */
export class FEFOPolicy implements AllocationPolicy {
  name = "FEFO";

  allocate(
    request: AllocationRequest,
    available: AvailableInventory[],
  ): Allocation[] {
    const sorted = [...available]
      .filter((u) => u.sku === request.sku && u.status === "AVAILABLE")
      .sort((a, b) => {
        // Items without expiry go last
        if (!a.expiryDate && !b.expiryDate) return 0;
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return a.expiryDate.getTime() - b.expiryDate.getTime();
      });

    return this.allocateFromSorted(request, sorted);
  }

  private allocateFromSorted(
    request: AllocationRequest,
    sorted: AvailableInventory[],
  ): Allocation[] {
    const allocations: Allocation[] = [];
    let remaining = request.quantity;

    for (const unit of sorted) {
      if (remaining <= 0) break;

      const allocateQty = Math.min(unit.quantity, remaining);
      allocations.push({
        inventoryUnitId: unit.id,
        orderId: request.orderId,
        sku: request.sku,
        quantity: allocateQty,
        locationId: unit.locationId,
        lotNumber: unit.lotNumber,
      });

      remaining -= allocateQty;
    }

    if (remaining > 0) {
      throw new InsufficientInventoryError(
        request.sku,
        request.quantity,
        request.quantity - remaining,
      );
    }

    return allocations;
  }
}

/**
 * Zone Priority Policy
 * Allocates from preferred zone first, then falls back to other zones
 */
export class ZonePriorityPolicy implements AllocationPolicy {
  name = "ZONE_PRIORITY";

  constructor(private fallbackPolicy: AllocationPolicy = new FIFOPolicy()) {}

  allocate(
    request: AllocationRequest,
    available: AvailableInventory[],
  ): Allocation[] {
    if (!request.preferredZone) {
      return this.fallbackPolicy.allocate(request, available);
    }

    // Sort: preferred zone first, then by fallback policy's logic
    const sorted = [...available]
      .filter((u) => u.sku === request.sku && u.status === "AVAILABLE")
      .sort((a, b) => {
        const aInZone = a.locationId.startsWith(request.preferredZone!) ? 0 : 1;
        const bInZone = b.locationId.startsWith(request.preferredZone!) ? 0 : 1;
        return aInZone - bInZone;
      });

    return this.allocateFromSorted(request, sorted);
  }

  private allocateFromSorted(
    request: AllocationRequest,
    sorted: AvailableInventory[],
  ): Allocation[] {
    const allocations: Allocation[] = [];
    let remaining = request.quantity;

    for (const unit of sorted) {
      if (remaining <= 0) break;

      const allocateQty = Math.min(unit.quantity, remaining);
      allocations.push({
        inventoryUnitId: unit.id,
        orderId: request.orderId,
        sku: request.sku,
        quantity: allocateQty,
        locationId: unit.locationId,
        lotNumber: unit.lotNumber,
      });

      remaining -= allocateQty;
    }

    if (remaining > 0) {
      throw new InsufficientInventoryError(
        request.sku,
        request.quantity,
        request.quantity - remaining,
      );
    }

    return allocations;
  }
}

/**
 * Allocation Policy Factory
 */
export type PolicyType = "FIFO" | "FEFO" | "ZONE_PRIORITY";

export function createAllocationPolicy(type: PolicyType): AllocationPolicy {
  switch (type) {
    case "FIFO":
      return new FIFOPolicy();
    case "FEFO":
      return new FEFOPolicy();
    case "ZONE_PRIORITY":
      return new ZonePriorityPolicy();
    default:
      throw new Error(`Unknown allocation policy: ${type}`);
  }
}

export class InsufficientInventoryError extends Error {
  constructor(
    public readonly sku: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient inventory for SKU ${sku}: requested ${requested}, available ${available}`,
    );
    this.name = "InsufficientInventoryError";
  }
}
