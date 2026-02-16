/**
 * Product Service
 * Business logic for products and variants
 *
 * Save to: packages/domain/src/services/product.service.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  shopifyProductId?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  upc?: string | null;
  barcode?: string | null;
  name: string;
  imageUrl?: string | null;
  shopifyVariantId?: string | null;
  costPrice?: number | null;
  sellingPrice?: number | null;
  // Single unit weight & dimensions
  weight?: number | null;
  weightUnit?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionUnit?: string | null;
  // Master case
  mcQuantity?: number | null;
  mcWeight?: number | null;
  mcWeightUnit?: string | null;
  mcLength?: number | null;
  mcWidth?: number | null;
  mcHeight?: number | null;
  mcDimensionUnit?: string | null;
  trackLots: boolean;
  trackExpiry: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductWithVariants extends Product {
  variants: ProductVariant[];
}

export interface ProductWithInventory extends ProductWithVariants {
  totalInventory: number;
  availableInventory: number;
  reservedInventory: number;
  locations: Array<{
    locationId: string;
    locationName: string;
    quantity: number;
  }>;
}

export interface ImportProductData {
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  shopifyProductId?: string;
}

export interface ImportVariantData {
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
  product: Product;
  variants: ProductVariant[];
  created: boolean;
  variantsCreated: number;
  variantsUpdated: number;
}

export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProductSearchResult {
  products: ProductWithVariants[];
  total: number;
}

export interface ProductStats {
  totalProducts: number;
  totalVariants: number;
  activeProducts: number;
  byBrand: Record<string, number>;
  byCategory: Record<string, number>;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findBySku(sku: string): Promise<Product | null>;
  findByIdWithVariants(id: string): Promise<ProductWithVariants | null>;
  findBySkuWithVariants(sku: string): Promise<ProductWithVariants | null>;
  findVariantBySku(sku: string): Promise<ProductVariant | null>;
  findVariantByUpc(upc: string): Promise<ProductVariant | null>;
  findVariantByBarcode(barcode: string): Promise<ProductVariant | null>;
  search(query: string, limit?: number): Promise<ProductWithVariants[]>;
  list(options: {
    skip?: number;
    take?: number;
    brand?: string;
    category?: string;
    active?: boolean;
  }): Promise<{ products: ProductWithVariants[]; total: number }>;
  upsertWithVariants(
    product: ImportProductData,
    variants: ImportVariantData[],
  ): Promise<ImportResult>;
  update(id: string, data: Partial<ImportProductData>): Promise<Product>;
  updateVariant(
    id: string,
    data: Partial<ImportVariantData>,
  ): Promise<ProductVariant>;
  deactivate(id: string): Promise<Product>;
  getStats(): Promise<ProductStats>;
}

export interface InventoryQueryRepository {
  getTotalByProductVariant(productVariantId: string): Promise<number>;
  getAvailableByProductVariant(productVariantId: string): Promise<number>;
  getByProductVariantGroupedByLocation(
    productVariantId: string,
  ): Promise<
    Array<{ locationId: string; locationName: string; quantity: number }>
  >;
  hasAllocatedInventory(productVariantId: string): Promise<boolean>;
}

// ============================================================================
// Service
// ============================================================================

export interface ProductServiceDeps {
  productRepo: ProductRepository;
  inventoryRepo?: InventoryQueryRepository;
}

export class ProductService {
  private productRepo: ProductRepository;
  private inventoryRepo?: InventoryQueryRepository;

  constructor(deps: ProductServiceDeps) {
    this.productRepo = deps.productRepo;
    this.inventoryRepo = deps.inventoryRepo;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async getProduct(id: string): Promise<ProductWithVariants | null> {
    return this.productRepo.findByIdWithVariants(id);
  }

  async getProductBySku(sku: string): Promise<ProductWithVariants | null> {
    return this.productRepo.findBySkuWithVariants(sku);
  }

  async getProductWithInventory(
    id: string,
  ): Promise<ProductWithInventory | null> {
    const product = await this.productRepo.findByIdWithVariants(id);
    if (!product) return null;

    if (!this.inventoryRepo) {
      return {
        ...product,
        totalInventory: 0,
        availableInventory: 0,
        reservedInventory: 0,
        locations: [],
      };
    }

    let totalInventory = 0;
    let availableInventory = 0;
    const locationMap = new Map<
      string,
      { locationName: string; quantity: number }
    >();

    for (const variant of product.variants) {
      const total = await this.inventoryRepo.getTotalByProductVariant(
        variant.id,
      );
      const available = await this.inventoryRepo.getAvailableByProductVariant(
        variant.id,
      );
      const locations =
        await this.inventoryRepo.getByProductVariantGroupedByLocation(
          variant.id,
        );

      totalInventory += total;
      availableInventory += available;

      for (const loc of locations) {
        const existing = locationMap.get(loc.locationId);
        if (existing) {
          existing.quantity += loc.quantity;
        } else {
          locationMap.set(loc.locationId, {
            locationName: loc.locationName,
            quantity: loc.quantity,
          });
        }
      }
    }

    return {
      ...product,
      totalInventory,
      availableInventory,
      reservedInventory: totalInventory - availableInventory,
      locations: Array.from(locationMap.entries()).map(
        ([locationId, data]) => ({
          locationId,
          locationName: data.locationName,
          quantity: data.quantity,
        }),
      ),
    };
  }

  async search(query: string, limit = 20): Promise<ProductWithVariants[]> {
    if (query.length < 2) {
      throw new ProductSearchError(
        "Search query must be at least 2 characters",
      );
    }
    return this.productRepo.search(query, limit);
  }

  async list(options: {
    skip?: number;
    take?: number;
    brand?: string;
    category?: string;
    active?: boolean;
  }): Promise<ProductSearchResult> {
    const result = await this.productRepo.list(options);
    return {
      products: result.products,
      total: result.total,
    };
  }

  async findVariant(identifier: string): Promise<ProductVariant | null> {
    let variant = await this.productRepo.findVariantBySku(identifier);
    if (variant) return variant;

    variant = await this.productRepo.findVariantByUpc(identifier);
    if (variant) return variant;

    variant = await this.productRepo.findVariantByBarcode(identifier);
    return variant;
  }

  async getStats(): Promise<ProductStats> {
    return this.productRepo.getStats();
  }

  // ==========================================================================
  // Import / Create
  // ==========================================================================

  validateImport(
    product: ImportProductData,
    variants: ImportVariantData[],
  ): ImportValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Product validation
    if (!product.sku || product.sku.trim() === "") {
      errors.push("Product SKU is required");
    }
    if (!product.name || product.name.trim() === "") {
      errors.push("Product name is required");
    }
    if (product.sku && product.sku.length > 100) {
      errors.push("Product SKU must be 100 characters or less");
    }

    // Variants validation
    if (!variants || variants.length === 0) {
      errors.push("At least one variant is required");
    }

    const variantSkus = new Set<string>();
    const variantUpcs = new Set<string>();

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const prefix = `Variant ${i + 1}`;

      if (!v.sku || v.sku.trim() === "") {
        errors.push(`${prefix}: SKU is required`);
      } else if (variantSkus.has(v.sku)) {
        errors.push(`${prefix}: Duplicate SKU "${v.sku}"`);
      } else {
        variantSkus.add(v.sku);
      }

      if (!v.name || v.name.trim() === "") {
        errors.push(`${prefix}: Name is required`);
      }

      if (v.upc) {
        if (variantUpcs.has(v.upc)) {
          errors.push(`${prefix}: Duplicate UPC "${v.upc}"`);
        } else {
          variantUpcs.add(v.upc);
        }

        if (!/^\d{12,14}$/.test(v.upc)) {
          warnings.push(
            `${prefix}: UPC "${v.upc}" doesn't match standard format`,
          );
        }
      }

      if (v.costPrice !== undefined && v.costPrice < 0) {
        errors.push(`${prefix}: Cost price cannot be negative`);
      }
      if (v.sellingPrice !== undefined && v.sellingPrice < 0) {
        errors.push(`${prefix}: Selling price cannot be negative`);
      }
      if (v.weight !== undefined && v.weight < 0) {
        errors.push(`${prefix}: Weight cannot be negative`);
      }
      if (v.mcWeight !== undefined && v.mcWeight < 0) {
        errors.push(`${prefix}: MC weight cannot be negative`);
      }
      if (v.mcQuantity !== undefined && v.mcQuantity < 0) {
        errors.push(`${prefix}: MC quantity cannot be negative`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async importProduct(
    product: ImportProductData,
    variants: ImportVariantData[],
  ): Promise<ImportResult> {
    const validation = this.validateImport(product, variants);
    if (!validation.valid) {
      throw new ProductImportError(
        `Invalid import data: ${validation.errors.join("; ")}`,
      );
    }

    return this.productRepo.upsertWithVariants(product, variants);
  }

  async importBulk(
    items: Array<{ product: ImportProductData; variants: ImportVariantData[] }>,
  ): Promise<{
    successful: ImportResult[];
    failed: Array<{ product: ImportProductData; error: string }>;
  }> {
    const successful: ImportResult[] = [];
    const failed: Array<{ product: ImportProductData; error: string }> = [];

    for (const item of items) {
      try {
        const result = await this.importProduct(item.product, item.variants);
        successful.push(result);
      } catch (error) {
        failed.push({
          product: item.product,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { successful, failed };
  }

  // ==========================================================================
  // Updates
  // ==========================================================================

  async updateProduct(
    id: string,
    data: Partial<ImportProductData>,
  ): Promise<Product> {
    const existing = await this.productRepo.findById(id);
    if (!existing) {
      throw new ProductNotFoundError(id);
    }
    return this.productRepo.update(id, data);
  }

  async updateVariant(
    id: string,
    data: Partial<ImportVariantData>,
  ): Promise<ProductVariant> {
    const existing = await this.productRepo.findVariantBySku(id);
    if (!existing) {
      throw new VariantNotFoundError(id);
    }

    if (data.costPrice !== undefined && data.costPrice < 0) {
      throw new ProductValidationError("Cost price cannot be negative");
    }
    if (data.sellingPrice !== undefined && data.sellingPrice < 0) {
      throw new ProductValidationError("Selling price cannot be negative");
    }

    return this.productRepo.updateVariant(id, data);
  }

  async deactivateProduct(id: string): Promise<Product> {
    const existing = await this.productRepo.findByIdWithVariants(id);
    if (!existing) {
      throw new ProductNotFoundError(id);
    }

    if (this.inventoryRepo) {
      for (const variant of existing.variants) {
        const hasAllocated = await this.inventoryRepo.hasAllocatedInventory(
          variant.id,
        );
        if (hasAllocated) {
          throw new ProductHasAllocatedInventoryError(
            id,
            `Cannot deactivate product: variant ${variant.sku} has allocated inventory`,
          );
        }
      }
    }

    return this.productRepo.deactivate(id);
  }
}

// ============================================================================
// Errors
// ============================================================================

export class ProductNotFoundError extends Error {
  constructor(public readonly productId: string) {
    super(`Product not found: ${productId}`);
    this.name = "ProductNotFoundError";
  }
}

export class VariantNotFoundError extends Error {
  constructor(public readonly variantId: string) {
    super(`Variant not found: ${variantId}`);
    this.name = "VariantNotFoundError";
  }
}

export class ProductImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductImportError";
  }
}

export class ProductValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductValidationError";
  }
}

export class ProductSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductSearchError";
  }
}

export class ProductHasAllocatedInventoryError extends Error {
  constructor(
    public readonly productId: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductHasAllocatedInventoryError";
  }
}
