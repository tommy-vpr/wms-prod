/**
 * Product CSV Parser
 * Transforms raw CSV rows into ImportProductData + ImportVariantData
 *
 * Save to: packages/domain/src/services/product-csv-parser.ts
 */

import type {
  ImportProductData,
  ImportVariantData,
} from "./product.service.js";

// ============================================================================
// Types
// ============================================================================

export interface CsvRow {
  [key: string]: string;
}

export interface ProductImportGroup {
  product: ImportProductData;
  variants: ImportVariantData[];
}

export interface CsvParseResult {
  groups: ProductImportGroup[];
  errors: string[];
  skipped: number;
  totalRows: number;
}

interface ParsedWeight {
  value: number;
  unit: string;
}

interface ParsedDimensions {
  length: number;
  width: number;
  height: number;
  unit: string;
}

// ============================================================================
// Field Parsers
// ============================================================================

/**
 * Parse weight string: "35 lbs", "5.59oz", "12 lbs"
 */
export function parseWeight(raw: string | undefined): ParsedWeight | null {
  if (!raw || !raw.trim()) return null;

  const match = raw.trim().match(/^([\d.]+)\s*(oz|lbs?|g|kg)$/i);
  if (!match) return null;

  let unit = match[2].toLowerCase();
  if (unit === "lb") unit = "lbs";

  return { value: parseFloat(match[1]), unit };
}

/**
 * Parse dimension string: "17 in x17 in x 5 in", "1.6 in x 4.7 in x 1.6 in"
 */
export function parseDimensions(
  raw: string | undefined,
): ParsedDimensions | null {
  if (!raw || !raw.trim()) return null;

  const match = raw
    .trim()
    .match(/([\d.]+)\s*(\w+)\s*x\s*([\d.]+)\s*\w*\s*x\s*([\d.]+)\s*(\w+)/i);

  if (!match) return null;

  return {
    length: parseFloat(match[1]),
    width: parseFloat(match[3]),
    height: parseFloat(match[4]),
    unit: match[5].toLowerCase(),
  };
}

// ============================================================================
// Row → Variant
// ============================================================================

/**
 * Normalize CSV headers to uppercase for consistent access
 */
function normalizeRow(row: CsvRow): CsvRow {
  const normalized: CsvRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key.toUpperCase().trim()] = (value ?? "").trim();
  }
  return normalized;
}

/**
 * Convert a normalized CSV row into ImportVariantData with all weight/dimension fields
 */
function rowToVariantData(row: CsvRow): ImportVariantData {
  const singleWeight = parseWeight(
    row["SINGLE WEIGHT"] || row["SINGLE_WEIGHT"] || row["WEIGHT"],
  );
  const singleDims = parseDimensions(
    row["SINGLE DIMENSION"] || row["SINGLE_DIMENSION"],
  );
  const mcWeight = parseWeight(row["MC WEIGHT"] || row["MC_WEIGHT"]);
  const mcDims = parseDimensions(row["MC DIMENSION"] || row["MC_DIMENSION"]);
  const mcQty = row["MC QTY"] || row["MC_QTY"];
  const parsedMcQty = mcQty ? parseInt(mcQty, 10) : undefined;

  // Build a descriptive variant name
  const parts = [row["NAME"], row["VOLUME"], row["STRENGTH"]].filter(Boolean);
  const variantName = parts.join(" ") || row["PRODUCT"] || row["SKU"];

  return {
    sku: row["SKU"],
    upc: row["UPC"] || undefined,
    barcode: row["UPC"] || row["BARCODE"] || undefined,
    name: variantName,

    // Single unit
    weight: singleWeight?.value,
    weightUnit: singleWeight?.unit,
    length: singleDims?.length,
    width: singleDims?.width,
    height: singleDims?.height,
    dimensionUnit: singleDims?.unit,

    // Master case
    mcQuantity: isNaN(parsedMcQty!) ? undefined : parsedMcQty,
    mcWeight: mcWeight?.value,
    mcWeightUnit: mcWeight?.unit,
    mcLength: mcDims?.length,
    mcWidth: mcDims?.width,
    mcHeight: mcDims?.height,
    mcDimensionUnit: mcDims?.unit,
  };
}

// ============================================================================
// Grouped Parse (multiple variants per product)
// ============================================================================

/**
 * Parse CSV rows into grouped ProductImportGroups.
 *
 * Groups by CATEGORY + NAME so each flavor/product line becomes one Product
 * with multiple variants (one per volume/strength combo).
 *
 * CSV columns (case-insensitive):
 *   PRODUCT, UPC, SKU, NAME, CATEGORY, VOLUME, STRENGTH,
 *   MC WEIGHT, MC QTY, MC DIMENSION, SINGLE DIMENSION, SINGLE WEIGHT
 *
 * Usage:
 * ```ts
 * import { parseProductCsv } from "@wms/domain";
 *
 * const result = parseProductCsv(csvRows);
 * for (const group of result.groups) {
 *   await productService.importProduct(group.product, group.variants);
 * }
 * ```
 */
export function parseProductCsv(rows: CsvRow[]): CsvParseResult {
  const errors: string[] = [];
  let skipped = 0;

  const groupMap = new Map<
    string,
    { product: ImportProductData; variants: ImportVariantData[] }
  >();

  for (let i = 0; i < rows.length; i++) {
    const row = normalizeRow(rows[i]);
    const rowNum = i + 2; // +2 for 1-indexed + header row

    // Validate required fields
    if (!row["SKU"]) {
      errors.push(`Row ${rowNum}: missing SKU`);
      skipped++;
      continue;
    }

    if (!row["NAME"] && !row["PRODUCT"]) {
      errors.push(`Row ${rowNum} (${row["SKU"]}): missing NAME and PRODUCT`);
      skipped++;
      continue;
    }

    // Group key: CATEGORY + NAME → one product per flavor-per-line
    const category = row["CATEGORY"] || "General";
    const name = row["NAME"] || row["PRODUCT"] || "Unknown";
    const groupKey = `${category}::${name}`;

    if (!groupMap.has(groupKey)) {
      // Derive a product-level SKU from the first variant's SKU base
      const baseSku = row["SKU"].replace(/-\d+$/, "");

      groupMap.set(groupKey, {
        product: {
          sku: baseSku,
          name,
          brand: category,
          category,
        },
        variants: [],
      });
    }

    groupMap.get(groupKey)!.variants.push(rowToVariantData(row));
  }

  return {
    groups: Array.from(groupMap.values()),
    errors,
    skipped,
    totalRows: rows.length,
  };
}

// ============================================================================
// Flat Parse (each row = one product + one variant)
// ============================================================================

/**
 * Alternative: each CSV row becomes its own product with a single variant.
 * Use this when every SKU should be its own product.
 */
export function parseProductCsvFlat(rows: CsvRow[]): CsvParseResult {
  const errors: string[] = [];
  let skipped = 0;
  const groups: ProductImportGroup[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = normalizeRow(rows[i]);
    const rowNum = i + 2;

    if (!row["SKU"]) {
      errors.push(`Row ${rowNum}: missing SKU`);
      skipped++;
      continue;
    }

    const product: ImportProductData = {
      sku: row["SKU"],
      name: row["PRODUCT"] || row["NAME"] || row["SKU"],
      brand: row["CATEGORY"] || undefined,
      category: row["CATEGORY"] || undefined,
    };

    groups.push({ product, variants: [rowToVariantData(row)] });
  }

  return { groups, errors, skipped, totalRows: rows.length };
}
