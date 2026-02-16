/**
 * Inventory Routes
 * Uses InventoryService for ALL operations
 *
 * Save to: apps/api/src/routes/inventory.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@wms/db";
import {
  InventoryService,
  InventoryUnitNotFoundError,
  InventoryNotAvailableError,
  InvalidStateTransitionError,
  InvalidQuantityError,
  InsufficientQuantityError,
  ProductVariantNotFoundError,
  LocationNotFoundError,
  LocationNotActiveError,
  LocationNameExistsError,
  LocationBarcodeExistsError,
  type InventoryRepository,
  type LocationRepository,
  type ProductVariantRepository,
  type InventoryUnit,
  type InventoryUnitWithDetails,
  type Location,
  type InventoryStatus,
} from "@wms/domain";

type InventoryUnitWithAvailability = InventoryUnitWithDetails & {
  availableQuantity: number;
};

// ============================================================================
// Repository Adapters
// ============================================================================

const inventoryRepoAdapter: InventoryRepository = {
  async findById(id): Promise<InventoryUnit | null> {
    const unit = await prisma.inventoryUnit.findUnique({
      where: { id },
      include: { productVariant: { select: { sku: true } } },
    });
    if (!unit) return null;
    return mapToInventoryUnit(unit);
  },

  async findByIdWithDetails(id): Promise<InventoryUnitWithDetails | null> {
    const unit = await prisma.inventoryUnit.findUnique({
      where: { id },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
    });
    if (!unit) return null;
    return mapToInventoryUnitWithDetails(unit);
  },

  async findByProductVariant(productVariantId): Promise<InventoryUnit[]> {
    const units = await prisma.inventoryUnit.findMany({
      where: { productVariantId },
      include: { productVariant: { select: { sku: true } } },
      orderBy: { receivedAt: "asc" },
    });
    return units.map(mapToInventoryUnit);
  },

  async findAvailableByProductVariant(
    productVariantId: string,
  ): Promise<InventoryUnitWithAvailability[]> {
    const units = await prisma.inventoryUnit.findMany({
      where: { productVariantId },
      include: {
        allocations: {
          where: { status: { in: ["ALLOCATED", "PICKED"] } },
          select: { quantity: true },
        },
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
      orderBy: { receivedAt: "asc" },
    });

    return units
      .map((u) => {
        const reserved = u.allocations.reduce((s, a) => s + a.quantity, 0);
        return {
          ...mapToInventoryUnitWithDetails(u),
          availableQuantity: u.quantity - reserved,
        };
      })
      .filter((u) => u.availableQuantity > 0);
  },

  async findAvailableBySku(
    sku: string,
  ): Promise<InventoryUnitWithAvailability[]> {
    const units = await prisma.inventoryUnit.findMany({
      where: {
        productVariant: { sku },
        quantity: { gt: 0 },
      },
      include: {
        allocations: {
          where: { status: { in: ["ALLOCATED", "PICKED"] } },
          select: { quantity: true },
        },
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },

      orderBy: { receivedAt: "asc" },
    });

    return units
      .map((u) => {
        const reserved = u.allocations.reduce((s, a) => s + a.quantity, 0);
        return {
          ...mapToInventoryUnitWithDetails(u),
          availableQuantity: u.quantity - reserved,
        };
      })
      .filter((u) => u.availableQuantity > 0);
  },

  async findByLocation(locationId): Promise<InventoryUnit[]> {
    const units = await prisma.inventoryUnit.findMany({
      where: { locationId },
      include: { productVariant: { select: { sku: true } } },
    });
    return units.map(mapToInventoryUnit);
  },

  async findByLocationWithDetails(
    locationId,
  ): Promise<InventoryUnitWithDetails[]> {
    const units = await prisma.inventoryUnit.findMany({
      where: { locationId },
      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
    });
    return units.map(mapToInventoryUnitWithDetails);
  },

  async getExpiringInventory(
    daysUntilExpiry,
  ): Promise<InventoryUnitWithDetails[]> {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);

    const units = await prisma.inventoryUnit.findMany({
      where: {
        expiryDate: { lte: expiryDate, not: null },
      },

      include: {
        productVariant: {
          select: { id: true, sku: true, name: true, barcode: true },
        },
        location: {
          select: { id: true, name: true, zone: true, pickSequence: true },
        },
      },
      orderBy: { expiryDate: "asc" },
    });
    return units.map(mapToInventoryUnitWithDetails);
  },

  async getTotalAvailableByProductVariant(productVariantId): Promise<number> {
    const units = await prisma.inventoryUnit.findMany({
      where: { productVariantId },
      include: {
        allocations: {
          where: { status: { in: ["ALLOCATED", "PICKED"] } },
          select: { quantity: true },
        },
      },
    });

    return units.reduce((sum, u) => {
      const reserved = u.allocations.reduce((s, a) => s + a.quantity, 0);
      return sum + Math.max(0, u.quantity - reserved);
    }, 0);
  },

  async getStats() {
    const [totalUnits, totalQty, allocationSums, byStatus, lowStock, expiring] =
      await Promise.all([
        prisma.inventoryUnit.count(),
        prisma.inventoryUnit.aggregate({ _sum: { quantity: true } }),
        prisma.allocation.aggregate({
          where: { status: { in: ["ALLOCATED", "PICKED"] } },
          _sum: { quantity: true },
        }),
        prisma.inventoryUnit.groupBy({
          by: ["status"],
          _count: true,
          _sum: { quantity: true },
        }),
        prisma.inventoryUnit.count({
          where: { quantity: { lte: 5 } },
        }),
        prisma.inventoryUnit.count({
          where: {
            expiryDate: {
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              not: null,
            },
          },
        }),
      ]);

    const reservedQuantity = allocationSums._sum.quantity ?? 0;
    const totalQuantity = totalQty._sum.quantity ?? 0;

    return {
      totalUnits,
      totalQuantity,
      reservedQuantity,
      availableQuantity: Math.max(0, totalQuantity - reservedQuantity),
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count,
        quantity: s._sum.quantity ?? 0,
      })),
      lowStockCount: lowStock,
      expiringCount: expiring,
    };
  },

  async create(data): Promise<InventoryUnit> {
    const unit = await prisma.inventoryUnit.create({
      data: {
        productVariantId: data.productVariantId,
        locationId: data.locationId,
        quantity: data.quantity,
        status: data.status ?? "AVAILABLE",
        lotNumber: data.lotNumber,
        expiryDate: data.expiryDate,
        receivedFrom: data.receivedFrom,
        unitCost: data.unitCost,
        receivedAt: new Date(),
      },
      include: { productVariant: { select: { sku: true } } },
    });
    return mapToInventoryUnit(unit);
  },

  async updateStatus(id, status): Promise<void> {
    await prisma.inventoryUnit.update({ where: { id }, data: { status } });
  },

  async updateQuantity(id, quantity): Promise<void> {
    await prisma.inventoryUnit.update({ where: { id }, data: { quantity } });
  },

  async decrementQuantity(id, amount): Promise<void> {
    await prisma.inventoryUnit.update({
      where: { id },
      data: { quantity: { decrement: amount } },
    });
  },

  async incrementQuantity(id, amount): Promise<void> {
    await prisma.inventoryUnit.update({
      where: { id },
      data: { quantity: { increment: amount } },
    });
  },

  async updateLocation(id, locationId): Promise<void> {
    await prisma.inventoryUnit.update({ where: { id }, data: { locationId } });
  },
};

const locationRepoAdapter: LocationRepository = {
  async findById(id): Promise<Location | null> {
    const loc = await prisma.location.findUnique({ where: { id } });
    if (!loc) return null;
    return mapToLocation(loc);
  },

  async findByName(name): Promise<Location | null> {
    const loc = await prisma.location.findUnique({ where: { name } });
    if (!loc) return null;
    return mapToLocation(loc);
  },

  async findByBarcode(barcode): Promise<Location | null> {
    const loc = await prisma.location.findUnique({ where: { barcode } });
    if (!loc) return null;
    return mapToLocation(loc);
  },

  async findAll(options): Promise<Location[]> {
    const where: any = {};
    if (options?.zone) where.zone = options.zone;
    if (options?.type) where.type = options.type;
    if (options?.active !== undefined) where.active = options.active;

    const locations = await prisma.location.findMany({
      where,
      orderBy: [{ zone: "asc" }, { pickSequence: "asc" }],
    });
    return locations.map(mapToLocation);
  },

  async create(data): Promise<Location> {
    const loc = await prisma.location.create({
      data: {
        name: data.name,
        barcode: data.barcode,
        type: data.type as any,
        zone: data.zone,
        aisle: data.aisle,
        rack: data.rack,
        shelf: data.shelf,
        bin: data.bin,
        pickSequence: data.pickSequence,
        isPickable: data.isPickable,
        active: data.active,
      },
    });
    return mapToLocation(loc);
  },

  async update(id, data): Promise<Location> {
    const loc = await prisma.location.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.barcode !== undefined && { barcode: data.barcode }),
        ...(data.type && { type: data.type as any }),
        ...(data.zone !== undefined && { zone: data.zone }),
        ...(data.aisle !== undefined && { aisle: data.aisle }),
        ...(data.rack !== undefined && { rack: data.rack }),
        ...(data.shelf !== undefined && { shelf: data.shelf }),
        ...(data.bin !== undefined && { bin: data.bin }),
        ...(data.pickSequence !== undefined && {
          pickSequence: data.pickSequence,
        }),
        ...(data.isPickable !== undefined && { isPickable: data.isPickable }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
    return mapToLocation(loc);
  },
};

const productVariantRepoAdapter: ProductVariantRepository = {
  async findById(id) {
    return prisma.productVariant.findUnique({
      where: { id },
      select: { id: true, sku: true },
    });
  },
};

// ============================================================================
// Mappers
// ============================================================================

function mapToInventoryUnit(unit: any): InventoryUnit {
  return {
    id: unit.id,
    productVariantId: unit.productVariantId,
    sku: unit.productVariant.sku,
    quantity: unit.quantity,
    locationId: unit.locationId,
    lotNumber: unit.lotNumber ?? undefined,
    expiryDate: unit.expiryDate ?? undefined,
    receivedAt: unit.receivedAt,
    receivedFrom: unit.receivedFrom ?? undefined,
    unitCost: unit.unitCost ? Number(unit.unitCost) : undefined,
    status: unit.status as InventoryStatus,
  };
}

function mapToInventoryUnitWithDetails(unit: any): InventoryUnitWithDetails {
  return {
    ...mapToInventoryUnit(unit),
    productVariant: {
      id: unit.productVariant.id,
      sku: unit.productVariant.sku,
      name: unit.productVariant.name,
      barcode: unit.productVariant.barcode ?? undefined,
    },
    location: {
      id: unit.location.id,
      name: unit.location.name,
      zone: unit.location.zone ?? undefined,
      pickSequence: unit.location.pickSequence ?? undefined,
    },
  };
}

function mapToLocation(loc: any): Location {
  return {
    id: loc.id,
    name: loc.name,
    barcode: loc.barcode ?? undefined,
    type: loc.type,
    zone: loc.zone ?? undefined,
    aisle: loc.aisle ?? undefined,
    rack: loc.rack ?? undefined,
    shelf: loc.shelf ?? undefined,
    bin: loc.bin ?? undefined,
    pickSequence: loc.pickSequence ?? undefined,
    isPickable: loc.isPickable,
    active: loc.active,
  };
}

// ============================================================================
// Initialize Service
// ============================================================================

const inventoryService = new InventoryService({
  inventoryRepo: inventoryRepoAdapter,
  locationRepo: locationRepoAdapter,
  productVariantRepo: productVariantRepoAdapter,
});

// ============================================================================
// Error Handler
// ============================================================================

function handleError(error: unknown, reply: any) {
  if (error instanceof InventoryUnitNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof ProductVariantNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof LocationNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof LocationNotActiveError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof InventoryNotAvailableError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof InvalidStateTransitionError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof InvalidQuantityError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof InsufficientQuantityError) {
    return reply.status(400).send({ error: error.message });
  }
  if (error instanceof LocationNameExistsError) {
    return reply.status(409).send({ error: error.message });
  }
  if (error instanceof LocationBarcodeExistsError) {
    return reply.status(409).send({ error: error.message });
  }
  throw error;
}

// ============================================================================
// Routes
// ============================================================================

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  // ==========================================================================
  // Inventory Queries
  // ==========================================================================

  /**
   * GET /inventory
   * List inventory with pagination and filters
   */
  app.get<{
    Querystring: {
      skip?: string;
      take?: string;
      status?: string;
      locationId?: string;
      productVariantId?: string;
      zone?: string;
      q?: string;
    };
  }>("/", async (request, reply) => {
    const {
      skip = "0",
      take = "50",
      status,
      locationId,
      productVariantId,
      zone,
      q,
    } = request.query;

    const where: any = {};
    if (status) where.status = status;
    if (locationId) where.locationId = locationId;
    if (productVariantId) where.productVariantId = productVariantId;
    if (zone) where.location = { zone };
    if (q) {
      where.OR = [
        { productVariant: { sku: { contains: q, mode: "insensitive" } } },
        { productVariant: { name: { contains: q, mode: "insensitive" } } },
        { lotNumber: { contains: q, mode: "insensitive" } },
        { location: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [inventory, total] = await Promise.all([
      prisma.inventoryUnit.findMany({
        where,
        include: {
          productVariant: {
            select: { id: true, sku: true, name: true, barcode: true },
          },
          location: {
            select: { id: true, name: true, zone: true, pickSequence: true },
          },
          allocations: {
            where: { status: { in: ["ALLOCATED", "PICKED"] } },
            select: { quantity: true },
          },
        },
        orderBy: [{ location: { pickSequence: "asc" } }, { receivedAt: "asc" }],
        skip: Number(skip),
        take: Number(take),
      }),
      prisma.inventoryUnit.count({ where }),
    ]);

    const inventoryWithDerived = inventory.map((unit) => {
      const reservedQuantity = unit.allocations.reduce(
        (sum, a) => sum + a.quantity,
        0,
      );

      return {
        ...unit,
        reservedQuantity,
        availableQuantity: Math.max(0, unit.quantity - reservedQuantity),
      };
    });

    return reply.send({ inventory: inventoryWithDerived, total });
  });

  /**
   * GET /inventory/stats
   */
  app.get("/stats", async (request, reply) => {
    const stats = await inventoryService.getStats();
    return reply.send(stats);
  });

  /**
   * GET /inventory/by-sku/:sku
   */
  app.get<{ Params: { sku: string } }>(
    "/by-sku/:sku",
    async (request, reply) => {
      const units = await inventoryService.getAvailableBySku(
        request.params.sku,
      );
      const totalAvailable = units.reduce(
        (sum, u) => sum + u.availableQuantity,
        0,
      );

      return reply.send({ sku: request.params.sku, totalAvailable, units });
    },
  );

  /**
   * GET /inventory/by-location/:locationId
   */
  app.get<{ Params: { locationId: string } }>(
    "/by-location/:locationId",
    async (request, reply) => {
      try {
        const location = await inventoryService.getLocation(
          request.params.locationId,
        );
        if (!location) {
          return reply.status(404).send({ error: "Location not found" });
        }
        const inventory = await inventoryService.getByLocationWithDetails(
          request.params.locationId,
        );
        return reply.send({
          location,
          inventory,
          totalQuantity: inventory.reduce((sum, i) => sum + i.quantity, 0),
        });
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  /**
   * GET /inventory/check-availability
   */
  app.get<{
    Querystring: { productVariantId: string; quantity: string };
  }>("/check-availability", async (request, reply) => {
    const result = await inventoryService.checkAvailability(
      request.query.productVariantId,
      Number(request.query.quantity),
    );
    return reply.send(result);
  });

  /**
   * GET /inventory/expiring
   */
  app.get<{ Querystring: { days?: string } }>(
    "/expiring",
    async (request, reply) => {
      const days = Number(request.query.days ?? "30");
      const inventory = await inventoryService.getExpiringInventory(days);
      return reply.send({
        daysUntilExpiry: days,
        count: inventory.length,
        inventory,
      });
    },
  );

  /**
   * GET /inventory/:id
   */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const inventory = await prisma.inventoryUnit.findUnique({
      where: { id: request.params.id },
      include: {
        productVariant: {
          select: {
            id: true,
            sku: true,
            name: true,
            barcode: true,
            product: {
              select: {
                id: true,
                name: true,
                brand: true,
                category: true,
              },
            },
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            barcode: true,
            type: true,
            zone: true,
            aisle: true,
            rack: true,
            shelf: true,
            bin: true,
            pickSequence: true,
          },
        },
      },
    });

    if (!inventory) {
      return reply.status(404).send({ error: "Inventory unit not found" });
    }

    // Get allocations
    const allocations = await prisma.allocation.findMany({
      where: { inventoryUnitId: request.params.id },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
      },
      orderBy: {
        order: {
          orderNumber: "desc", // Sorts the allocations by the order number
        },
      },
    });

    return reply.send({ ...inventory, allocations });
  });

  // ==========================================================================
  // Inventory Commands
  // ==========================================================================

  /**
   * POST /inventory - Receive inventory
   */
  app.post<{
    Body: {
      productVariantId: string;
      locationId: string;
      quantity: number;
      lotNumber?: string;
      expiryDate?: string;
      receivedFrom?: string;
      unitCost?: number;
    };
  }>("/", async (request, reply) => {
    try {
      const inventory = await inventoryService.receive({
        productVariantId: request.body.productVariantId,
        locationId: request.body.locationId,
        quantity: request.body.quantity,
        lotNumber: request.body.lotNumber,
        expiryDate: request.body.expiryDate
          ? new Date(request.body.expiryDate)
          : undefined,
        receivedFrom: request.body.receivedFrom,
        unitCost: request.body.unitCost,
      });
      return reply.status(201).send({ success: true, inventory });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  /**
   * POST /inventory/:id/move
   */
  app.post<{
    Params: { id: string };
    Body: { locationId: string; quantity?: number };
  }>("/:id/move", async (request, reply) => {
    try {
      const result = await inventoryService.move(
        request.params.id,
        request.body.locationId,
        request.body.quantity,
      );
      return reply.send({ success: true, ...result });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  /**
   * POST /inventory/:id/adjust
   */
  app.post<{
    Params: { id: string };
    Body: { newQuantity: number; reason: string };
  }>("/:id/adjust", async (request, reply) => {
    try {
      const result = await inventoryService.adjust(
        request.params.id,
        request.body.newQuantity,
        request.body.reason,
      );
      return reply.send({ success: true, ...result });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  /**
   * POST /inventory/:id/damage
   */
  app.post<{
    Params: { id: string };
    Body: { quantity?: number; reason: string };
  }>("/:id/damage", async (request, reply) => {
    try {
      const { quantity, reason } = request.body;
      const unit = await inventoryService.getById(request.params.id);

      if (!unit) {
        return reply.status(404).send({ error: "Inventory unit not found" });
      }

      if (quantity && quantity < unit.quantity) {
        const result = await inventoryService.markPartialDamaged(
          request.params.id,
          quantity,
          reason,
        );
        return reply.send({ success: true, ...result });
      }

      await inventoryService.markDamaged(request.params.id, reason);
      return reply.send({
        success: true,
        damagedQuantity: unit.quantity,
        remainingQuantity: 0,
      });
    } catch (error) {
      return handleError(error, reply);
    }
  });

  // ==========================================================================
  // Location Routes
  // ==========================================================================

  /**
   * GET /inventory/locations
   */
  app.get<{
    Querystring: { zone?: string; type?: string; active?: string };
  }>("/locations", async (request, reply) => {
    const locations = await inventoryService.getLocations({
      zone: request.query.zone,
      type: request.query.type,
      active:
        request.query.active !== undefined
          ? request.query.active === "true"
          : undefined,
    });

    // Get inventory counts per location
    const locationIds = locations.map((l) => l.id);
    const inventoryCounts = await prisma.inventoryUnit.groupBy({
      by: ["locationId"],
      where: { locationId: { in: locationIds } },
      _sum: { quantity: true },
      _count: true,
    });

    const countMap = new Map(
      inventoryCounts.map((c) => [
        c.locationId,
        { quantity: c._sum.quantity ?? 0, count: c._count },
      ]),
    );

    const locationsWithCounts = locations.map((loc) => ({
      ...loc,
      totalQuantity: countMap.get(loc.id)?.quantity ?? 0,
      unitCount: countMap.get(loc.id)?.count ?? 0,
    }));

    return reply.send({ locations: locationsWithCounts });
  });

  /**
   * POST /inventory/locations
   */
  app.post<{
    Body: {
      name: string;
      barcode?: string;
      type?: string;
      zone?: string;
      aisle?: string;
      rack?: string;
      shelf?: string;
      bin?: string;
      pickSequence?: number;
      isPickable?: boolean;
    };
  }>("/locations", async (request, reply) => {
    try {
      const location = await inventoryService.createLocation({
        name: request.body.name,
        barcode: request.body.barcode,
        type: request.body.type ?? "GENERAL",
        zone: request.body.zone,
        aisle: request.body.aisle,
        rack: request.body.rack,
        shelf: request.body.shelf,
        bin: request.body.bin,
        pickSequence: request.body.pickSequence,
        isPickable: request.body.isPickable ?? true,
        active: true,
      });
      return reply.status(201).send(location);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  /**
   * GET /inventory/locations/:id
   */
  app.get<{ Params: { id: string } }>(
    "/locations/:id",
    async (request, reply) => {
      try {
        const location = await inventoryService.getLocation(request.params.id);
        if (!location) {
          return reply.status(404).send({ error: "Location not found" });
        }
        const inventory = await inventoryService.getByLocationWithDetails(
          request.params.id,
        );
        return reply.send({
          ...location,
          inventory,
          totalQuantity: inventory.reduce((sum, u) => sum + u.quantity, 0),
        });
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  /**
   * PATCH /inventory/locations/:id
   */
  app.patch<{
    Params: { id: string };
    Body: Partial<{
      name: string;
      barcode: string;
      type: string;
      zone: string;
      aisle: string;
      rack: string;
      shelf: string;
      bin: string;
      pickSequence: number;
      isPickable: boolean;
      active: boolean;
    }>;
  }>("/locations/:id", async (request, reply) => {
    try {
      const location = await inventoryService.updateLocation(
        request.params.id,
        request.body,
      );
      return reply.send(location);
    } catch (error) {
      return handleError(error, reply);
    }
  });
};
