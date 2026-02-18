/**
 * Location Import Routes
 * Import locations and assign products to locations from CSV
 * Uses LocationService for business logic
 *
 * Save to: apps/api/src/routes/location-import.routes.ts
 */

import { FastifyPluginAsync } from "fastify";
import { prisma } from "@wms/db";
import {
  LocationService,
  type LocationServiceLocationRepo,
  type LocationServiceVariantRepo,
  type LocationServiceInventoryRepo,
  type LocationServiceAuditRepo,
  type LocationImportRow,
} from "@wms/domain";

// ============================================================================
// Repository Adapters
// ============================================================================

const locationRepoAdapter: LocationServiceLocationRepo = {
  async findById(id: string) {
    return prisma.location.findUnique({ where: { id } });
  },

  async findByName(name: string) {
    return prisma.location.findUnique({ where: { name } });
  },

  async findByNames(names: string[]) {
    const locations = await prisma.location.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true },
    });
    return new Map(locations.map((l) => [l.name, l.id]));
  },

  async create(data) {
    return prisma.location.create({
      data: {
        name: data.name,
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
  },

  async findAll(options) {
    return prisma.location.findMany({
      where:
        options?.active !== undefined ? { active: options.active } : undefined,
      skip: options?.skip,
      take: options?.take,
      orderBy: { name: "asc" },
    });
  },

  async count(options) {
    return prisma.location.count({
      where:
        options?.active !== undefined ? { active: options.active } : undefined,
    });
  },
};

const variantRepoAdapter: LocationServiceVariantRepo = {
  async findBySkus(skus: string[]) {
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true },
    });
    return new Map(variants.map((v) => [v.sku, v.id]));
  },
};

const inventoryRepoAdapter: LocationServiceInventoryRepo = {
  async findByVariantAndLocation(productVariantId: string, locationId: string) {
    return prisma.inventoryUnit.findFirst({
      where: { productVariantId, locationId },
      select: { id: true },
    });
  },

  async create(data) {
    return prisma.inventoryUnit.create({
      data: {
        productVariantId: data.productVariantId,
        locationId: data.locationId,
        quantity: data.quantity,
        status: data.status as any,
        receivedFrom: data.receivedFrom,
        receivedAt: data.receivedAt,
      },
      select: { id: true },
    });
  },

  async getVariantIdsWithInventory() {
    const variants = await prisma.inventoryUnit.findMany({
      select: { productVariantId: true },
      distinct: ["productVariantId"],
    });
    return new Set(variants.map((v) => v.productVariantId));
  },
};

const auditRepoAdapter: LocationServiceAuditRepo = {
  async create(data) {
    await prisma.auditLog.create({
      data: {
        userId: data.userId ?? null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        changes: JSON.parse(JSON.stringify(data.changes)),
      },
    });
  },
};

// ============================================================================
// Initialize Service
// ============================================================================

const locationService = new LocationService({
  locationRepo: locationRepoAdapter,
  variantRepo: variantRepoAdapter,
  inventoryRepo: inventoryRepoAdapter,
  auditRepo: auditRepoAdapter,
});

// ============================================================================
// Helpers
// ============================================================================

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/"/g, "").toUpperCase());

  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i]?.replace(/"/g, "") || ""));
    return row;
  });
}

function normalizeRow(row: Record<string, string>): LocationImportRow | null {
  const sku = row.SKU;
  const locationName = row.LOCATION;

  if (!sku || !locationName) return null;

  return {
    sku,
    locationName,
    warehouse: row.WAREHOUSE,
    aisle: row.AISLE,
    bay: row.BAY,
    tier: row.TIER,
    space: row.SPACE,
    bin: row.BIN,
  };
}

// ============================================================================
// Routes
// ============================================================================

export const locationImportRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /locations/import
   * Import locations from CSV and create inventory units
   *
   * CSV columns: SKU, LOCATION, WAREHOUSE, AISLE, BAY, TIER, SPACE, BIN
   */
  app.post<{ Body: { csv: string } }>("/import", async (request, reply) => {
    const user = request.user;

    if (
      !user ||
      !["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role ?? "")
    ) {
      return reply.status(403).send({ error: "Admin or Manager required" });
    }

    const { csv } = request.body;
    if (!csv) {
      return reply.status(400).send({ error: "CSV data required" });
    }

    try {
      // Parse CSV
      const rows = parseCSV(csv);
      const importRows = rows
        .map(normalizeRow)
        .filter(Boolean) as LocationImportRow[];

      if (importRows.length === 0) {
        return reply.status(400).send({ error: "No valid rows found in CSV" });
      }

      // Import using service
      const result = await locationService.importLocations(
        importRows,
        user.sub,
      );

      app.log.info(
        {
          locationsCreated: result.locationsCreated,
          inventoryCreated: result.inventoryCreated,
          skipped: result.skipped,
        },
        "Location import completed",
      );

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      app.log.error(error, "Location import failed");
      return reply.status(500).send({ error: error.message });
    }
  });

  /**
   * GET /locations/import/template
   * Get CSV template
   */
  app.get("/import/template", async (request, reply) => {
    const template = `SKU,LOCATION,WAREHOUSE,AISLE,BAY,TIER,SPACE,BIN
EXAMPLE-SKU-001,1-A-1-A-1-X,1,A,1,A,1,X
EXAMPLE-SKU-002,1-A-1-B-1-X,1,A,1,B,1,X`;

    reply.header("Content-Type", "text/csv");
    reply.header(
      "Content-Disposition",
      "attachment; filename=location-import-template.csv",
    );
    return reply.send(template);
  });

  /**
   * GET /locations/unassigned
   * Get product variants without inventory (need location assignment)
   */
  app.get<{ Querystring: { skip?: string; take?: string } }>(
    "/unassigned",
    async (request, reply) => {
      const skip = Number(request.query.skip ?? 0);
      const take = Number(request.query.take ?? 50);

      // Get variant IDs that have inventory
      const variantIdsWithInventory =
        await inventoryRepoAdapter.getVariantIdsWithInventory();

      const [unassigned, total] = await Promise.all([
        prisma.productVariant.findMany({
          where: {
            id: { notIn: Array.from(variantIdsWithInventory) },
          },
          include: {
            product: { select: { name: true, brand: true } },
          },
          orderBy: { sku: "asc" },
          skip,
          take,
        }),
        prisma.productVariant.count({
          where: {
            id: { notIn: Array.from(variantIdsWithInventory) },
          },
        }),
      ]);

      return reply.send({
        unassigned,
        total,
        hasMore: skip + take < total,
      });
    },
  );

  /**
   * GET /locations
   * List all locations
   */
  //   app.get<{ Querystring: { active?: string; skip?: string; take?: string } }>(
  //     "/",
  //     async (request, reply) => {
  //       const { active, skip = "0", take = "100" } = request.query;

  //       const result = await locationService.list({
  //         active: active !== undefined ? active === "true" : undefined,
  //         skip: Number(skip),
  //         take: Number(take),
  //       });

  //       return reply.send(result);
  //     },
  //   );
};
