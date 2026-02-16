/**
 * Scan Routes - Unified barcode lookup
 *
 * Save to: apps/api/src/routes/scan.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@wms/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ScanResult {
  type: "PRODUCT" | "LOCATION" | "UNKNOWN";
  barcode: string;
  product?: {
    variantId: string;
    productId: string;
    sku: string;
    name: string;
    upc: string | null;
    barcode: string | null;
    imageUrl: string | null;
    inventory: {
      total: number;
      available: number;
      locations: Array<{
        locationId: string;
        locationName: string;
        quantity: number;
      }>;
    };
  };
  location?: {
    id: string;
    name: string;
    barcode: string | null;
    type: string;
    zone: string | null;
    itemCount: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

const scanRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /scan
   * Universal barcode scan - detects product or location
   */
  app.post(
    "/",
    async (
      request: FastifyRequest<{ Body: { barcode: string } }>,
    ): Promise<ScanResult> => {
      const { barcode } = request.body;

      if (!barcode || barcode.trim() === "") {
        throw new Error("Barcode is required");
      }

      const trimmedBarcode = barcode.trim();

      // 1. Try location first (usually shorter barcodes like LOC-001)
      const location = await prisma.location.findFirst({
        where: {
          OR: [{ barcode: trimmedBarcode }, { name: trimmedBarcode }],
        },
        include: {
          _count: { select: { inventoryUnits: true } },
        },
      });

      if (location) {
        return {
          type: "LOCATION",
          barcode: trimmedBarcode,
          location: {
            id: location.id,
            name: location.name,
            barcode: location.barcode,
            type: location.type,
            zone: location.zone,
            itemCount: location._count.inventoryUnits,
          },
        };
      }

      // 2. Try product variant (SKU, UPC, barcode)
      const variant = await prisma.productVariant.findFirst({
        where: {
          OR: [
            { sku: trimmedBarcode },
            { upc: trimmedBarcode },
            { barcode: trimmedBarcode },
          ],
        },
        include: {
          product: { select: { id: true, name: true } },
        },
      });

      if (variant) {
        // Get inventory summary
        const inventoryUnits = await prisma.inventoryUnit.findMany({
          where: { productVariantId: variant.id },
          include: {
            location: { select: { id: true, name: true } },
          },
        });

        const total = inventoryUnits.reduce((sum, u) => sum + u.quantity, 0);
        const available = inventoryUnits
          .filter((u) => u.status === "AVAILABLE")
          .reduce((sum, u) => sum + u.quantity, 0);

        // Group by location
        const locationMap = new Map<
          string,
          { locationName: string; quantity: number }
        >();

        for (const unit of inventoryUnits) {
          const existing = locationMap.get(unit.locationId);
          if (existing) {
            existing.quantity += unit.quantity;
          } else {
            locationMap.set(unit.locationId, {
              locationName: unit.location.name,
              quantity: unit.quantity,
            });
          }
        }

        return {
          type: "PRODUCT",
          barcode: trimmedBarcode,
          product: {
            variantId: variant.id,
            productId: variant.productId,
            sku: variant.sku,
            name: variant.name,
            upc: variant.upc,
            barcode: variant.barcode,
            imageUrl: variant.imageUrl,
            inventory: {
              total,
              available,
              locations: Array.from(locationMap.entries()).map(
                ([locationId, data]) => ({
                  locationId,
                  locationName: data.locationName,
                  quantity: data.quantity,
                }),
              ),
            },
          },
        };
      }

      // 3. Not found
      return {
        type: "UNKNOWN",
        barcode: trimmedBarcode,
      };
    },
  );

  /**
   * GET /scan/product/:barcode
   * Lookup product only
   */
  app.get(
    "/product/:barcode",
    async (request: FastifyRequest<{ Params: { barcode: string } }>) => {
      const { barcode } = request.params;

      const variant = await prisma.productVariant.findFirst({
        where: {
          OR: [{ sku: barcode }, { upc: barcode }, { barcode }],
        },
        include: {
          product: true,
        },
      });

      if (!variant) {
        return { found: false, barcode };
      }

      // Get inventory
      const inventory = await prisma.inventoryUnit.groupBy({
        by: ["locationId"],
        where: { productVariantId: variant.id },
        _sum: { quantity: true },
      });

      const locations = await prisma.location.findMany({
        where: { id: { in: inventory.map((i) => i.locationId) } },
        select: { id: true, name: true },
      });

      const locationMap = new Map(locations.map((l) => [l.id, l.name]));

      return {
        found: true,
        barcode,
        variant: {
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          upc: variant.upc,
          barcode: variant.barcode,
          imageUrl: variant.imageUrl,
          costPrice: variant.costPrice,
          sellingPrice: variant.sellingPrice,
          weight: variant.weight,
        },
        product: {
          id: variant.product.id,
          sku: variant.product.sku,
          name: variant.product.name,
          brand: variant.product.brand,
          category: variant.product.category,
        },
        inventory: inventory.map((i) => ({
          locationId: i.locationId,
          locationName: locationMap.get(i.locationId) || "Unknown",
          quantity: i._sum.quantity || 0,
        })),
        totalQuantity: inventory.reduce(
          (sum, i) => sum + (i._sum.quantity || 0),
          0,
        ),
      };
    },
  );

  /**
   * GET /scan/location/:barcode
   * Lookup location only
   */
  app.get(
    "/location/:barcode",
    async (request: FastifyRequest<{ Params: { barcode: string } }>) => {
      const { barcode } = request.params;

      const location = await prisma.location.findFirst({
        where: {
          OR: [{ barcode }, { name: barcode }],
        },
      });

      if (!location) {
        return { found: false, barcode };
      }

      // Get inventory at this location
      const inventory = await prisma.inventoryUnit.findMany({
        where: { locationId: location.id, quantity: { gt: 0 } },
        include: {
          productVariant: {
            select: {
              id: true,
              sku: true,
              name: true,
              imageUrl: true,
            },
          },
        },
        orderBy: { productVariant: { sku: "asc" } },
      });

      // Group by variant
      const variantMap = new Map<
        string,
        { sku: string; name: string; imageUrl: string | null; quantity: number }
      >();

      for (const unit of inventory) {
        const existing = variantMap.get(unit.productVariantId);
        if (existing) {
          existing.quantity += unit.quantity;
        } else {
          variantMap.set(unit.productVariantId, {
            sku: unit.productVariant.sku,
            name: unit.productVariant.name,
            imageUrl: unit.productVariant.imageUrl,
            quantity: unit.quantity,
          });
        }
      }

      return {
        found: true,
        barcode,
        location: {
          id: location.id,
          name: location.name,
          barcode: location.barcode,
          type: location.type,
          zone: location.zone,
          aisle: location.aisle,
          rack: location.rack,
          shelf: location.shelf,
          bin: location.bin,
          isPickable: location.isPickable,
        },
        inventory: Array.from(variantMap.entries()).map(
          ([variantId, data]) => ({
            variantId,
            ...data,
          }),
        ),
        totalItems: variantMap.size,
        totalQuantity: inventory.reduce((sum, u) => sum + u.quantity, 0),
      };
    },
  );
};

export default scanRoutes;
