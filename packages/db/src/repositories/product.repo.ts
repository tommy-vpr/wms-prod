/**
 * Product Repository
 * Persistence layer for products and variants
 */

import { prisma } from "../client.js";
import type { Prisma } from "@prisma/client";

// ============================================================================
// Types (internal - not exported to avoid conflicts with Prisma types)
// ============================================================================

interface RepoProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  shopifyProductId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RepoProductVariant {
  id: string;
  productId: string;
  sku: string;
  upc: string | null;
  barcode: string | null;
  name: string;
  imageUrl: string | null;
  shopifyVariantId: string | null;
  costPrice: Prisma.Decimal | null;
  sellingPrice: Prisma.Decimal | null;
  // Single unit weight & dimensions
  weight: Prisma.Decimal | null;
  weightUnit: string | null;
  length: Prisma.Decimal | null;
  width: Prisma.Decimal | null;
  height: Prisma.Decimal | null;
  dimensionUnit: string | null;
  // Master case
  mcQuantity: number | null;
  mcWeight: Prisma.Decimal | null;
  mcWeightUnit: string | null;
  mcLength: Prisma.Decimal | null;
  mcWidth: Prisma.Decimal | null;
  mcHeight: Prisma.Decimal | null;
  mcDimensionUnit: string | null;
  trackLots: boolean;
  trackExpiry: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductWithVariants extends RepoProduct {
  variants: RepoProductVariant[];
}

export interface UpsertProductData {
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  shopifyProductId?: string;
}

export interface UpsertVariantData {
  sku: string;
  upc?: string;
  barcode?: string;
  name: string;
  imageUrl?: string;
  shopifyVariantId?: string;
  costPrice?: number;
  sellingPrice?: number;
  // Single unit weight & dimensions
  weight?: number;
  weightUnit?: string;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: string;
  // Master case
  mcQuantity?: number;
  mcWeight?: number;
  mcWeightUnit?: string;
  mcLength?: number;
  mcWidth?: number;
  mcHeight?: number;
  mcDimensionUnit?: string;
  trackLots?: boolean;
  trackExpiry?: boolean;
}

export interface ImportResult {
  product: RepoProduct;
  variants: RepoProductVariant[];
  created: boolean;
  variantsCreated: number;
  variantsUpdated: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build the data object for variant create/update from UpsertVariantData.
 * Keeps it DRY — used in both upsert paths.
 */
function buildVariantFields(data: UpsertVariantData, productId?: string) {
  return {
    ...(productId !== undefined && { productId }),
    upc: data.upc,
    barcode: data.barcode || data.upc,
    name: data.name,
    imageUrl: data.imageUrl,
    shopifyVariantId: data.shopifyVariantId,
    costPrice: data.costPrice,
    sellingPrice: data.sellingPrice,
    // Single unit
    weight: data.weight,
    weightUnit: data.weightUnit ?? (data.weight != null ? "oz" : undefined),
    length: data.length,
    width: data.width,
    height: data.height,
    dimensionUnit:
      data.dimensionUnit ?? (data.length != null ? "in" : undefined),
    // Master case
    mcQuantity: data.mcQuantity,
    mcWeight: data.mcWeight,
    mcWeightUnit:
      data.mcWeightUnit ?? (data.mcWeight != null ? "lbs" : undefined),
    mcLength: data.mcLength,
    mcWidth: data.mcWidth,
    mcHeight: data.mcHeight,
    mcDimensionUnit:
      data.mcDimensionUnit ?? (data.mcLength != null ? "in" : undefined),
    trackLots: data.trackLots ?? false,
    trackExpiry: data.trackExpiry ?? false,
  };
}

// ============================================================================
// Repository
// ============================================================================

export const productRepository = {
  /**
   * Find product by ID
   */
  async findById(id: string): Promise<RepoProduct | null> {
    return prisma.product.findUnique({
      where: { id },
    });
  },

  /**
   * Find product by SKU
   */
  async findBySku(sku: string): Promise<RepoProduct | null> {
    return prisma.product.findUnique({
      where: { sku },
    });
  },

  /**
   * Find product by Shopify Product ID
   */
  async findByShopifyId(shopifyProductId: string): Promise<RepoProduct | null> {
    return prisma.product.findUnique({
      where: { shopifyProductId },
    });
  },

  /**
   * Find product with variants
   */
  async findByIdWithVariants(id: string): Promise<ProductWithVariants | null> {
    return prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
  },

  /**
   * Find product with variants by SKU
   */
  async findBySkuWithVariants(
    sku: string,
  ): Promise<ProductWithVariants | null> {
    return prisma.product.findUnique({
      where: { sku },
      include: { variants: true },
    });
  },

  /**
   * Find variant by SKU
   */
  async findVariantBySku(sku: string): Promise<RepoProductVariant | null> {
    return prisma.productVariant.findUnique({
      where: { sku },
    });
  },

  /**
   * Find variant by UPC
   */
  async findVariantByUpc(upc: string): Promise<RepoProductVariant | null> {
    return prisma.productVariant.findUnique({
      where: { upc },
    });
  },

  /**
   * Find variant by Shopify Variant ID
   */
  async findVariantByShopifyId(
    shopifyVariantId: string,
  ): Promise<RepoProductVariant | null> {
    return prisma.productVariant.findFirst({
      where: { shopifyVariantId },
    });
  },

  /**
   * Find variants by product ID
   */
  async findVariantsByProductId(productId: string): Promise<RepoProductVariant[]> {
    return prisma.productVariant.findMany({
      where: { productId },
    });
  },

  /**
   * Search products
   */
  async search(query: string, limit = 20): Promise<ProductWithVariants[]> {
    return prisma.product.findMany({
      where: {
        OR: [
          { sku: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { brand: { contains: query, mode: "insensitive" } },
          {
            variants: {
              some: { sku: { contains: query, mode: "insensitive" } },
            },
          },
          {
            variants: {
              some: { upc: { contains: query, mode: "insensitive" } },
            },
          },
        ],
      },
      include: { variants: true },
      take: limit,
    });
  },

  /**
   * List all products with pagination
   */
  async list(options: {
    skip?: number;
    take?: number;
    brand?: string;
    category?: string;
    active?: boolean;
  }): Promise<{ products: ProductWithVariants[]; total: number }> {
    const where: Prisma.ProductWhereInput = {};

    if (options.brand) where.brand = options.brand;
    if (options.category) where.category = options.category;
    if (options.active !== undefined) where.active = options.active;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip: options.skip ?? 0,
        take: options.take ?? 50,
        include: { variants: true },
        orderBy: { name: "asc" },
      }),
      prisma.product.count({ where }),
    ]);

    return { products, total };
  },

  /**
   * Upsert product with variants (main import method)
   */
  async upsertWithVariants(
    productData: UpsertProductData,
    variantsData: UpsertVariantData[],
  ): Promise<ImportResult> {
    return prisma.$transaction(async (tx) => {
      // Check if product exists
      const existing = await tx.product.findUnique({
        where: { sku: productData.sku },
      });

      const created = !existing;

      // Upsert product
      const product = await tx.product.upsert({
        where: { sku: productData.sku },
        update: {
          name: productData.name,
          description: productData.description,
          brand: productData.brand,
          category: productData.category,
          shopifyProductId: productData.shopifyProductId,
        },
        create: {
          sku: productData.sku,
          name: productData.name,
          description: productData.description,
          brand: productData.brand,
          category: productData.category,
          shopifyProductId: productData.shopifyProductId,
        },
      });

      // Upsert variants
      let variantsCreated = 0;
      let variantsUpdated = 0;
      const variants: RepoProductVariant[] = [];

      for (const variantData of variantsData) {
        const existingVariant = await tx.productVariant.findUnique({
          where: { sku: variantData.sku },
        });

        const fields = buildVariantFields(variantData, product.id);

        const variant = await tx.productVariant.upsert({
          where: { sku: variantData.sku },
          update: fields,
          create: {
            ...fields,
            productId: product.id,
            sku: variantData.sku,
          },
        });

        if (existingVariant) {
          variantsUpdated++;
        } else {
          variantsCreated++;
        }

        variants.push(variant);
      }

      return {
        product,
        variants,
        created,
        variantsCreated,
        variantsUpdated,
      };
    });
  },

  /**
   * Create a new product
   */
  async create(data: UpsertProductData): Promise<RepoProduct> {
    return prisma.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        description: data.description,
        brand: data.brand,
        category: data.category,
        shopifyProductId: data.shopifyProductId,
      },
    });
  },

  /**
   * Create a new variant
   */
  async createVariant(
    productId: string,
    data: UpsertVariantData,
  ): Promise<RepoProductVariant> {
    return prisma.productVariant.create({
      data: {
        ...buildVariantFields(data),
        productId,
        sku: data.sku,
      },
    });
  },

  /**
   * Update product
   */
  async update(id: string, data: Partial<UpsertProductData>): Promise<RepoProduct> {
    return prisma.product.update({
      where: { id },
      data,
    });
  },

  /**
   * Update variant
   */
  async updateVariant(
    id: string,
    data: Partial<UpsertVariantData>,
  ): Promise<RepoProductVariant> {
    return prisma.productVariant.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete product (cascades to variants)
   */
  async delete(id: string): Promise<void> {
    await prisma.product.delete({
      where: { id },
    });
  },

  /**
   * Deactivate product
   */
  async deactivate(id: string): Promise<RepoProduct> {
    return prisma.product.update({
      where: { id },
      data: { active: false },
    });
  },

  /**
   * Get product stats
   */
  async getStats(): Promise<{
    totalProducts: number;
    activeProducts: number;
    totalVariants: number;
    byBrand: Record<string, number>;
    byCategory: Record<string, number>;
  }> {
    const [
      totalProducts,
      activeProducts,
      totalVariants,
      brandCounts,
      categoryCounts,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { active: true } }),
      prisma.productVariant.count(),
      prisma.product.groupBy({
        by: ["brand"],
        _count: true,
      }),
      prisma.product.groupBy({
        by: ["category"],
        _count: true,
      }),
    ]);

    const byBrand: Record<string, number> = {};
    brandCounts.forEach((b) => {
      if (b.brand) byBrand[b.brand] = b._count;
    });

    const byCategory: Record<string, number> = {};
    categoryCounts.forEach((c) => {
      if (c.category) byCategory[c.category] = c._count;
    });

    return {
      totalProducts,
      activeProducts,
      totalVariants,
      byBrand,
      byCategory,
    };
  },
};
