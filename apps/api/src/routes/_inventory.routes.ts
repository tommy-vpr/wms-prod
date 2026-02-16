/**
 * Inventory Routes
 * Manage inventory units, locations, and stock levels
 *
 * Save to: apps/api/src/routes/inventory.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma, inventoryRepository } from "@wms/db";
import { z } from "zod";

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /inventory
   * List inventory units with filters
   */
  app.get<{
    Querystring: {
      skip?: string;
      take?: string;
      status?: string;
      locationId?: string;
      zone?: string;
      productVariantId?: string;
      q?: string;
    };
  }>("/", async (request, reply) => {
    const {
      skip = "0",
      take = "50",
      status,
      locationId,
      zone,
      productVariantId,
      q,
    } = request.query;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (locationId) {
      where.locationId = locationId;
    }

    if (zone) {
      where.location = { zone };
    }

    if (productVariantId) {
      where.productVariantId = productVariantId;
    }

    if (q) {
      where.OR = [
        { productVariant: { sku: { contains: q, mode: "insensitive" } } },
        { productVariant: { name: { contains: q, mode: "insensitive" } } },
        { productVariant: { barcode: { contains: q, mode: "insensitive" } } },
        { lotNumber: { contains: q, mode: "insensitive" } },
        { location: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [inventory, total] = await Promise.all([
      prisma.inventoryUnit.findMany({
        where,
        include: {
          productVariant: {
            select: {
              id: true,
              sku: true,
              name: true,
              barcode: true,
              product: {
                select: { brand: true, category: true },
              },
            },
          },
          location: {
            select: {
              id: true,
              name: true,
              zone: true,
              aisle: true,
              rack: true,
              shelf: true,
              bin: true,
              pickSequence: true,
            },
          },
        },
        orderBy: [{ location: { pickSequence: "asc" } }, { receivedAt: "asc" }],
        skip: Number(skip),
        take: Number(take),
      }),
      prisma.inventoryUnit.count({ where }),
    ]);

    return reply.send({ inventory, total });
  });

  /**
   * GET /inventory/stats
   * Get inventory statistics
   */
  app.get("/stats", async (request, reply) => {
    const [
      totalUnits,
      totalQuantity,
      availableQuantity,
      reservedQuantity,
      byStatus,
      byZone,
      lowStock,
      expiringSoon,
    ] = await Promise.all([
      prisma.inventoryUnit.count(),
      prisma.inventoryUnit.aggregate({ _sum: { quantity: true } }),
      prisma.inventoryUnit.aggregate({
        where: { status: "AVAILABLE" },
        _sum: { quantity: true },
      }),
      prisma.inventoryUnit.aggregate({
        where: { status: "RESERVED" },
        _sum: { quantity: true },
      }),
      prisma.inventoryUnit.groupBy({
        by: ["status"],
        _sum: { quantity: true },
        _count: true,
      }),
      prisma.inventoryUnit.groupBy({
        by: ["locationId"],
        _sum: { quantity: true },
        _count: true,
      }),
      // Products with low stock (less than 10 available)
      prisma.$queryRaw`
        SELECT pv.sku, pv.name, COALESCE(SUM(iu.quantity), 0) as available
        FROM product_variants pv
        LEFT JOIN inventory_units iu ON iu."productVariantId" = pv.id AND iu.status = 'AVAILABLE'
        GROUP BY pv.id, pv.sku, pv.name
        HAVING COALESCE(SUM(iu.quantity), 0) < 10
        ORDER BY available ASC
        LIMIT 10
      `,
      // Expiring in next 30 days
      prisma.inventoryUnit.count({
        where: {
          status: "AVAILABLE",
          expiryDate: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            gte: new Date(),
          },
        },
      }),
    ]);

    // Get zone names
    const zoneIds = byZone.map((z) => z.locationId);
    const locations = await prisma.location.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, name: true, zone: true },
    });

    const locationMap = new Map(locations.map((l) => [l.id, l]));

    return reply.send({
      totalUnits,
      totalQuantity: totalQuantity._sum.quantity ?? 0,
      availableQuantity: availableQuantity._sum.quantity ?? 0,
      reservedQuantity: reservedQuantity._sum.quantity ?? 0,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        quantity: s._sum.quantity ?? 0,
        count: s._count,
      })),
      byZone: byZone.slice(0, 10).map((z) => ({
        locationId: z.locationId,
        locationName: locationMap.get(z.locationId)?.name ?? "Unknown",
        zone: locationMap.get(z.locationId)?.zone ?? "Unknown",
        quantity: z._sum.quantity ?? 0,
        count: z._count,
      })),
      lowStock,
      expiringSoon,
    });
  });

  /**
   * GET /inventory/expiring
   * Get inventory expiring soon
   */
  app.get<{ Querystring: { days?: string } }>(
    "/expiring",
    async (request, reply) => {
      const { days = "30" } = request.query;

      const inventory = await inventoryRepository.getExpiringInventory(
        Number(days),
      );

      return reply.send({ inventory, total: inventory.length });
    },
  );

  /**
   * GET /inventory/by-sku/:sku
   * Get all inventory for a SKU
   */
  app.get<{ Params: { sku: string } }>(
    "/by-sku/:sku",
    async (request, reply) => {
      const { sku } = request.params;

      const inventory = await inventoryRepository.findAvailableBySku(sku);
      const total = await inventoryRepository.getTotalAvailableByProductVariant(
        inventory[0]?.productVariantId ?? "",
      );

      return reply.send({
        sku,
        inventory,
        totalAvailable: total,
        locationCount: inventory.length,
      });
    },
  );

  /**
   * GET /inventory/by-location/:locationId
   * Get all inventory at a location
   */
  app.get<{ Params: { locationId: string } }>(
    "/by-location/:locationId",
    async (request, reply) => {
      const { locationId } = request.params;

      const [inventory, location] = await Promise.all([
        inventoryRepository.findByLocationWithDetails(locationId),
        prisma.location.findUnique({
          where: { id: locationId },
        }),
      ]);

      if (!location) {
        return reply.status(404).send({ error: "Location not found" });
      }

      return reply.send({
        location,
        inventory,
        totalItems: inventory.length,
        totalQuantity: inventory.reduce((sum, i) => sum + i.quantity, 0),
      });
    },
  );

  /**
   * GET /inventory/:id
   * Get inventory unit by ID
   */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const unit = await prisma.inventoryUnit.findUnique({
      where: { id },
      include: {
        productVariant: {
          include: {
            product: {
              select: { id: true, name: true, brand: true, category: true },
            },
          },
        },
        location: true,
        allocations: {
          where: { status: { in: ["PENDING", "ALLOCATED"] } },
          include: {
            order: {
              select: { id: true, orderNumber: true, status: true },
            },
          },
        },
      },
    });

    if (!unit) {
      return reply.status(404).send({ error: "Inventory unit not found" });
    }

    return reply.send(unit);
  });

  /**
   * POST /inventory
   * Create new inventory unit (receive inventory)
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
    const schema = z.object({
      productVariantId: z.string().min(1),
      locationId: z.string().min(1),
      quantity: z.number().int().positive(),
      lotNumber: z.string().optional(),
      expiryDate: z.string().datetime().optional(),
      receivedFrom: z.string().optional(),
      unitCost: z.number().positive().optional(),
    });

    const data = schema.parse(request.body);

    // Verify product variant exists
    const variant = await prisma.productVariant.findUnique({
      where: { id: data.productVariantId },
    });

    if (!variant) {
      return reply.status(404).send({ error: "Product variant not found" });
    }

    // Verify location exists
    const location = await prisma.location.findUnique({
      where: { id: data.locationId },
    });

    if (!location) {
      return reply.status(404).send({ error: "Location not found" });
    }

    const unit = await inventoryRepository.create({
      productVariantId: data.productVariantId,
      locationId: data.locationId,
      quantity: data.quantity,
      lotNumber: data.lotNumber,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
      receivedFrom: data.receivedFrom,
      unitCost: data.unitCost,
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: request.user?.sub,
        action: "INVENTORY_RECEIVED",
        entityType: "InventoryUnit",
        entityId: unit.id,
        changes: {
          productVariantId: data.productVariantId,
          locationId: data.locationId,
          quantity: data.quantity,
          lotNumber: data.lotNumber,
        },
      },
    });

    return reply.status(201).send(unit);
  });

  /**
   * POST /inventory/:id/adjust
   * Adjust inventory quantity (cycle count, damage, etc.)
   */
  app.post<{
    Params: { id: string };
    Body: {
      newQuantity: number;
      reason: string;
    };
  }>("/:id/adjust", async (request, reply) => {
    const { id } = request.params;
    const { newQuantity, reason } = request.body;

    const unit = await inventoryRepository.findById(id);

    if (!unit) {
      return reply.status(404).send({ error: "Inventory unit not found" });
    }

    const previousQuantity = unit.quantity;

    await inventoryRepository.updateQuantity(id, newQuantity);

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: request.user?.sub,
        action: "INVENTORY_ADJUSTED",
        entityType: "InventoryUnit",
        entityId: id,
        changes: {
          previousQuantity,
          newQuantity,
          adjustment: newQuantity - previousQuantity,
          reason,
        },
      },
    });

    return reply.send({
      success: true,
      previousQuantity,
      newQuantity,
      adjustment: newQuantity - previousQuantity,
    });
  });

  /**
   * POST /inventory/:id/move
   * Move inventory to a different location
   */
  app.post<{
    Params: { id: string };
    Body: {
      newLocationId: string;
      quantity?: number; // If partial move
    };
  }>("/:id/move", async (request, reply) => {
    const { id } = request.params;
    const { newLocationId, quantity } = request.body;

    const unit = await inventoryRepository.findById(id);

    if (!unit) {
      return reply.status(404).send({ error: "Inventory unit not found" });
    }

    if (unit.status !== "AVAILABLE") {
      return reply.status(400).send({
        error: `Cannot move inventory in ${unit.status} status`,
      });
    }

    // Verify new location exists
    const newLocation = await prisma.location.findUnique({
      where: { id: newLocationId },
    });

    if (!newLocation) {
      return reply.status(404).send({ error: "New location not found" });
    }

    const moveQuantity = quantity ?? unit.quantity;

    if (moveQuantity > unit.quantity) {
      return reply.status(400).send({
        error: `Cannot move ${moveQuantity}, only ${unit.quantity} available`,
      });
    }

    const previousLocationId = unit.locationId;

    if (moveQuantity === unit.quantity) {
      // Move entire unit
      await prisma.inventoryUnit.update({
        where: { id },
        data: { locationId: newLocationId },
      });
    } else {
      // Partial move - decrement original and create new
      await prisma.$transaction([
        prisma.inventoryUnit.update({
          where: { id },
          data: { quantity: { decrement: moveQuantity } },
        }),
        prisma.inventoryUnit.create({
          data: {
            productVariantId: unit.productVariantId,
            locationId: newLocationId,
            quantity: moveQuantity,
            status: "AVAILABLE",
            lotNumber: unit.lotNumber,
            expiryDate: unit.expiryDate,
            receivedAt: unit.receivedAt,
            receivedFrom: unit.receivedFrom,
            unitCost: unit.unitCost,
          },
        }),
      ]);
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: request.user?.sub,
        action: "INVENTORY_MOVED",
        entityType: "InventoryUnit",
        entityId: id,
        changes: {
          previousLocationId,
          newLocationId,
          quantity: moveQuantity,
        },
      },
    });

    return reply.send({
      success: true,
      previousLocationId,
      newLocationId,
      movedQuantity: moveQuantity,
    });
  });

  /**
   * POST /inventory/:id/damage
   * Mark inventory as damaged
   */
  app.post<{
    Params: { id: string };
    Body: {
      quantity?: number;
      reason: string;
    };
  }>("/:id/damage", async (request, reply) => {
    const { id } = request.params;
    const { quantity, reason } = request.body;

    const unit = await inventoryRepository.findById(id);

    if (!unit) {
      return reply.status(404).send({ error: "Inventory unit not found" });
    }

    const damageQuantity = quantity ?? unit.quantity;

    if (damageQuantity > unit.quantity) {
      return reply.status(400).send({
        error: `Cannot mark ${damageQuantity} as damaged, only ${unit.quantity} available`,
      });
    }

    if (damageQuantity === unit.quantity) {
      // Mark entire unit as damaged
      await inventoryRepository.updateStatus(id, "DAMAGED");
    } else {
      // Partial damage - decrement original and create damaged unit
      await prisma.$transaction([
        prisma.inventoryUnit.update({
          where: { id },
          data: { quantity: { decrement: damageQuantity } },
        }),
        prisma.inventoryUnit.create({
          data: {
            productVariantId: unit.productVariantId,
            locationId: unit.locationId,
            quantity: damageQuantity,
            status: "DAMAGED",
            lotNumber: unit.lotNumber,
            expiryDate: unit.expiryDate,
            receivedAt: unit.receivedAt,
            receivedFrom: unit.receivedFrom,
            unitCost: unit.unitCost,
          },
        }),
      ]);
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: request.user?.sub,
        action: "INVENTORY_DAMAGED",
        entityType: "InventoryUnit",
        entityId: id,
        changes: {
          quantity: damageQuantity,
          reason,
        },
      },
    });

    return reply.send({
      success: true,
      damagedQuantity: damageQuantity,
    });
  });

  // ============================================================================
  // Locations
  // ============================================================================

  /**
   * GET /inventory/locations
   * List all locations
   */
  app.get<{
    Querystring: {
      zone?: string;
      type?: string;
      active?: string;
    };
  }>("/locations", async (request, reply) => {
    const { zone, type, active } = request.query;

    const where: any = {};

    if (zone) where.zone = zone;
    if (type) where.type = type;
    if (active !== undefined) where.active = active === "true";

    const locations = await prisma.location.findMany({
      where,
      orderBy: [{ zone: "asc" }, { pickSequence: "asc" }, { name: "asc" }],
    });

    // Get inventory counts per location
    const inventoryCounts = await prisma.inventoryUnit.groupBy({
      by: ["locationId"],
      _sum: { quantity: true },
      _count: true,
    });

    const countMap = new Map(
      inventoryCounts.map((c) => [
        c.locationId,
        { quantity: c._sum.quantity ?? 0, units: c._count },
      ]),
    );

    const locationsWithCounts = locations.map((loc) => ({
      ...loc,
      inventoryQuantity: countMap.get(loc.id)?.quantity ?? 0,
      inventoryUnits: countMap.get(loc.id)?.units ?? 0,
    }));

    return reply.send({ locations: locationsWithCounts });
  });

  /**
   * POST /inventory/locations
   * Create a new location
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
    const data = request.body;

    // Check for duplicate name
    const existing = await prisma.location.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      return reply.status(409).send({ error: "Location name already exists" });
    }

    const location = await prisma.location.create({
      data: {
        name: data.name,
        barcode: data.barcode,
        type: (data.type as any) ?? "GENERAL",
        zone: data.zone,
        aisle: data.aisle,
        rack: data.rack,
        shelf: data.shelf,
        bin: data.bin,
        pickSequence: data.pickSequence,
        isPickable: data.isPickable ?? true,
      },
    });

    return reply.status(201).send(location);
  });

  /**
   * GET /inventory/locations/:id
   * Get location by ID
   */
  app.get<{ Params: { id: string } }>(
    "/locations/:id",
    async (request, reply) => {
      const { id } = request.params;

      const location = await prisma.location.findUnique({
        where: { id },
      });

      if (!location) {
        return reply.status(404).send({ error: "Location not found" });
      }

      const inventory = await inventoryRepository.findByLocationWithDetails(id);

      return reply.send({
        ...location,
        inventory,
        totalQuantity: inventory.reduce((sum, i) => sum + i.quantity, 0),
      });
    },
  );

  /**
   * PATCH /inventory/locations/:id
   * Update a location
   */
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      barcode?: string;
      type?: string;
      zone?: string;
      aisle?: string;
      rack?: string;
      shelf?: string;
      bin?: string;
      pickSequence?: number;
      isPickable?: boolean;
      active?: boolean;
    };
  }>("/locations/:id", async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    const location = await prisma.location.findUnique({
      where: { id },
    });

    if (!location) {
      return reply.status(404).send({ error: "Location not found" });
    }

    const updated = await prisma.location.update({
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

    return reply.send(updated);
  });
};
