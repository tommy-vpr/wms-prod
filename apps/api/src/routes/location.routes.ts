/**
 * Location Routes
 * CRUD and queries for warehouse locations
 *
 * Save to: apps/api/src/routes/location.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@wms/db";

export const locationRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /locations
   * List all locations with optional filters
   */
  app.get<{
    Querystring: {
      skip?: string;
      take?: string;
      active?: string;
      zone?: string;
      type?: string;
      search?: string;
    };
  }>("/", async (request, reply) => {
    const {
      skip = "0",
      take = "50",
      active,
      zone,
      type,
      search,
    } = request.query;

    const where: any = {};
    if (active !== undefined) where.active = active === "true";
    if (zone) where.zone = zone;
    if (type) where.type = type;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
        { aisle: { contains: search, mode: "insensitive" } },
        { zone: { contains: search, mode: "insensitive" } },
      ];
    }

    const [locations, total] = await Promise.all([
      prisma.location.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: [{ zone: "asc" }, { pickSequence: "asc" }, { name: "asc" }],
        include: {
          _count: {
            select: { inventoryUnits: true },
          },
        },
      }),
      prisma.location.count({ where }),
    ]);

    return reply.send({ locations, total });
  });

  /**
   * GET /locations/stats
   * Get location statistics
   */
  app.get("/stats", async (request, reply) => {
    const [total, active, byZone, byType, withInventory] = await Promise.all([
      prisma.location.count(),
      prisma.location.count({ where: { active: true } }),
      prisma.location.groupBy({
        by: ["zone"],
        _count: true,
      }),
      prisma.location.groupBy({
        by: ["type"],
        _count: true,
      }),
      prisma.location.count({
        where: {
          inventoryUnits: {
            some: {},
          },
        },
      }),
    ]);

    return reply.send({
      total,
      active,
      byZone: Object.fromEntries(
        byZone.filter((z) => z.zone).map((z) => [z.zone, z._count]),
      ),
      byType: Object.fromEntries(byType.map((t) => [t.type, t._count])),
      withInventory,
    });
  });

  /**
   * GET /locations/:id
   * Get single location by ID
   */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const location = await prisma.location.findUnique({
      where: { id },
    });

    if (!location) {
      return reply.status(404).send({ error: "Location not found" });
    }

    return reply.send(location);
  });

  /**
   * GET /locations/:id/inventory
   * Get inventory units at a location
   */
  app.get<{
    Params: { id: string };
    Querystring: { status?: string };
  }>("/:id/inventory", async (request, reply) => {
    const { id } = request.params;
    const { status } = request.query;

    const location = await prisma.location.findUnique({
      where: { id },
    });

    if (!location) {
      return reply.status(404).send({ error: "Location not found" });
    }

    const where: any = { locationId: id };
    if (status) where.status = status;

    const inventory = await prisma.inventoryUnit.findMany({
      where,
      include: {
        productVariant: {
          select: {
            id: true,
            sku: true,
            name: true,
            product: {
              select: {
                name: true,
                brand: true,
              },
            },
          },
        },
      },
      orderBy: { productVariant: { sku: "asc" } },
    });

    const totalQuantity = inventory.reduce((sum, inv) => sum + inv.quantity, 0);

    return reply.send({
      location,
      inventory,
      summary: {
        itemCount: inventory.length,
        totalQuantity,
        uniqueSkus: new Set(inventory.map((i) => i.productVariant.sku)).size,
      },
    });
  });

  /**
   * PATCH /locations/:id
   * Update location
   */
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      barcode?: string;
      zone?: string;
      aisle?: string;
      rack?: string;
      shelf?: string;
      bin?: string;
      pickSequence?: number;
      isPickable?: boolean;
      active?: boolean;
    };
  }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: "Location not found" });
    }

    const updated = await prisma.location.update({
      where: { id },
      data,
    });

    return reply.send({ success: true, location: updated });
  });

  /**
   * POST /locations
   * Create new location
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
  }>("/", async (request, reply) => {
    const { name, barcode, type = "STORAGE", ...rest } = request.body;

    if (!name) {
      return reply.status(400).send({ error: "Name is required" });
    }

    // Check for duplicate name
    const existing = await prisma.location.findUnique({ where: { name } });
    if (existing) {
      return reply.status(409).send({ error: "Location name already exists" });
    }

    const location = await prisma.location.create({
      data: {
        name,
        barcode,
        type: type as any,
        isPickable: rest.isPickable ?? true,
        active: true,
        ...rest,
      },
    });

    return reply.status(201).send({ success: true, location });
  });

  /**
   * DELETE /locations/:id
   * Deactivate location (soft delete)
   */
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: "Location not found" });
    }

    // Check if location has inventory
    const inventoryCount = await prisma.inventoryUnit.count({
      where: { locationId: id, quantity: { gt: 0 } },
    });

    if (inventoryCount > 0) {
      return reply.status(409).send({
        error: "Cannot delete location with inventory",
        inventoryCount,
      });
    }

    // Soft delete - just deactivate
    await prisma.location.update({
      where: { id },
      data: { active: false },
    });

    return reply.send({ success: true, message: "Location deactivated" });
  });
};
