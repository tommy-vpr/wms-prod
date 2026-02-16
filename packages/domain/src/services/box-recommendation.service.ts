/**
 * BoxRecommendationService
 * Computes optimal box/package assignments for order items
 * Uses first-fit decreasing bin packing algorithm
 *
 * Save to: packages/domain/src/services/box-recommendation.service.ts
 */

// =============================================================================
// Types
// =============================================================================

export interface BoxDefinition {
  id: string;
  label: string;
  dimensions: { length: number; width: number; height: number };
  maxWeight?: number; // oz — optional weight limit per box
  usedBy: string[]; // ["all"], ["usps"], ["ups"]
  isFlatRate?: boolean;
  purpose?: string;
}

export interface VariantDimensions {
  productVariantId: string;
  sku: string;
  name: string;
  weight: number | null; // oz (normalized)
  length: number | null; // in (normalized)
  width: number | null; // in (normalized)
  height: number | null; // in (normalized)
}

export interface OrderItemInput {
  productVariantId: string;
  sku: string;
  name: string;
  quantity: number;
  weight: number | null;
  weightUnit: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string | null;
}

export interface PackageRecommendation {
  sequence: number;
  box: BoxDefinition;
  items: PackageItemRecommendation[];
  estimatedWeight: number; // oz
  weightUnit: string;
  fillPercent: number; // 0-100
  volumeUsed: number; // cubic inches
  volumeAvailable: number; // cubic inches
}

export interface PackageItemRecommendation {
  productVariantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitWeight: number | null; // oz
}

export interface RecommendationResult {
  packages: PackageRecommendation[];
  warnings: string[];
  totalEstimatedWeight: number; // oz
  totalItems: number;
  itemsMissingDimensions: string[]; // SKUs without dimensions
  itemsMissingWeight: string[]; // SKUs without weight
}

// =============================================================================
// Default Box Definitions
// Matches BOX_DEFINITIONS in shipping.service.ts — single source of truth
// =============================================================================

const DEFAULT_BOXES: BoxDefinition[] = [
  {
    id: "small-box",
    label: "Small Box (8×6×4)",
    dimensions: { length: 8, width: 6, height: 4 },
    maxWeight: 1120, // 70 lbs in oz
    usedBy: ["all"],
    purpose: "Small items",
  },
  {
    id: "medium-box",
    label: "Medium Box (12×10×6)",
    dimensions: { length: 12, width: 10, height: 6 },
    maxWeight: 1120,
    usedBy: ["all"],
    purpose: "Standard shipments",
  },
  {
    id: "large-box",
    label: "Large Box (18×14×10)",
    dimensions: { length: 18, width: 14, height: 10 },
    maxWeight: 1120,
    usedBy: ["all"],
    purpose: "Large shipments",
  },
  // USPS Flat Rate boxes — useful when weight-based shipping is expensive
  {
    id: "usps-flat-small",
    label: "USPS Small Flat Rate Box",
    dimensions: { length: 8.625, width: 5.375, height: 1.625 },
    maxWeight: 1120,
    usedBy: ["usps"],
    isFlatRate: true,
    purpose: "USPS flat rate — small",
  },
  {
    id: "usps-flat-medium",
    label: "USPS Medium Flat Rate Box",
    dimensions: { length: 11.25, width: 8.75, height: 6 },
    maxWeight: 1120,
    usedBy: ["usps"],
    isFlatRate: true,
    purpose: "USPS flat rate — medium",
  },
  {
    id: "usps-flat-large",
    label: "USPS Large Flat Rate Box",
    dimensions: { length: 12.25, width: 12.25, height: 6 },
    maxWeight: 1120,
    usedBy: ["usps"],
    isFlatRate: true,
    purpose: "USPS flat rate — large",
  },
];

// =============================================================================
// Unit Conversion Helpers
// =============================================================================

/** Convert weight to ounces */
function toOunces(value: number, unit: string | null): number {
  if (!unit) return value; // assume oz
  switch (unit.toLowerCase()) {
    case "oz":
      return value;
    case "lbs":
    case "lb":
      return value * 16;
    case "g":
      return value * 0.035274;
    case "kg":
      return value * 35.274;
    default:
      return value;
  }
}

/** Convert dimension to inches */
function toInches(value: number, unit: string | null): number {
  if (!unit) return value; // assume inches
  switch (unit.toLowerCase()) {
    case "in":
      return value;
    case "cm":
      return value * 0.393701;
    case "mm":
      return value * 0.0393701;
    default:
      return value;
  }
}

/** Calculate volume of a box in cubic inches */
function boxVolume(dims: {
  length: number;
  width: number;
  height: number;
}): number {
  return dims.length * dims.width * dims.height;
}

/** Calculate volume of a single item in cubic inches (with padding factor) */
function itemVolume(
  length: number | null,
  width: number | null,
  height: number | null,
): number | null {
  if (length == null || width == null || height == null) return null;
  // 10% padding for packing inefficiency (items don't tessellate perfectly)
  return length * width * height * 1.1;
}

// =============================================================================
// Bin Packing Algorithm
// =============================================================================

interface PackingItem {
  productVariantId: string;
  sku: string;
  name: string;
  volume: number | null; // cubic inches per unit (null = unknown)
  weight: number | null; // oz per unit (null = unknown)
  quantity: number;
}

interface PackingBin {
  box: BoxDefinition;
  items: { item: PackingItem; quantity: number }[];
  usedVolume: number;
  usedWeight: number;
  maxVolume: number;
  maxWeight: number;
}

/**
 * First-Fit Decreasing bin packing
 *
 * 1. Expand all items into individual units
 * 2. Sort by volume descending (largest first)
 * 3. For each unit, try to fit into existing bins (smallest first)
 * 4. If no bin fits, open the smallest box that can hold it
 * 5. Collapse back into sku+quantity per bin
 */
function packItems(items: PackingItem[], boxes: BoxDefinition[]): PackingBin[] {
  // Sort boxes by volume ascending (try smallest first)
  const sortedBoxes = [...boxes]
    .filter((b) => !b.isFlatRate) // exclude flat rate for auto-recommendation
    .sort((a, b) => boxVolume(a.dimensions) - boxVolume(b.dimensions));

  if (sortedBoxes.length === 0) {
    throw new Error("No box definitions available for recommendation");
  }

  // Expand items into individual unit entries, sorted by volume desc
  const units: PackingItem[] = [];
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      units.push({ ...item, quantity: 1 });
    }
  }

  // Sort by volume descending (largest items first for better packing)
  // Items with unknown volume go last (they'll just be weight-constrained)
  units.sort((a, b) => {
    if (a.volume == null && b.volume == null) return 0;
    if (a.volume == null) return 1;
    if (b.volume == null) return -1;
    return b.volume - a.volume;
  });

  const bins: PackingBin[] = [];

  for (const unit of units) {
    const unitVol = unit.volume ?? 0;
    const unitWt = unit.weight ?? 0;

    // Try to fit into existing bin (first-fit)
    let placed = false;
    for (const bin of bins) {
      const fitsVolume = bin.usedVolume + unitVol <= bin.maxVolume;
      const fitsWeight = bin.usedWeight + unitWt <= bin.maxWeight;

      if (fitsVolume && fitsWeight) {
        // Add to existing bin
        const existing = bin.items.find(
          (i) => i.item.productVariantId === unit.productVariantId,
        );
        if (existing) {
          existing.quantity += 1;
        } else {
          bin.items.push({ item: unit, quantity: 1 });
        }
        bin.usedVolume += unitVol;
        bin.usedWeight += unitWt;
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Open new bin — find smallest box that can hold this unit
      const suitableBox = sortedBoxes.find((box) => {
        const vol = boxVolume(box.dimensions);
        const wt = box.maxWeight ?? Infinity;
        return unitVol <= vol && unitWt <= wt;
      });

      // Fallback to largest box if nothing fits (oversized item)
      const box = suitableBox ?? sortedBoxes[sortedBoxes.length - 1];

      bins.push({
        box,
        items: [{ item: unit, quantity: 1 }],
        usedVolume: unitVol,
        usedWeight: unitWt,
        maxVolume: boxVolume(box.dimensions),
        maxWeight: box.maxWeight ?? 1120,
      });
    }
  }

  return bins;
}

// =============================================================================
// Service
// =============================================================================

export interface BoxRecommendationServiceDeps {
  boxes?: BoxDefinition[];
}

export class BoxRecommendationService {
  private boxes: BoxDefinition[];

  constructor(deps?: BoxRecommendationServiceDeps) {
    this.boxes = deps?.boxes ?? DEFAULT_BOXES;
  }

  /**
   * Get all available box definitions
   */
  getBoxes(carrier?: string): BoxDefinition[] {
    if (!carrier) return this.boxes;
    return this.boxes.filter(
      (b) => b.usedBy.includes("all") || b.usedBy.includes(carrier),
    );
  }

  /**
   * Recommend optimal packages for an order's items
   *
   * @param orderItems - items with variant dimension/weight data
   * @returns Recommendation with packages, warnings, and totals
   */
  recommend(orderItems: OrderItemInput[]): RecommendationResult {
    const warnings: string[] = [];
    const itemsMissingDimensions: string[] = [];
    const itemsMissingWeight: string[] = [];

    // Normalize units and build packing items
    const packingItems: PackingItem[] = [];

    for (const item of orderItems) {
      // Normalize weight to oz
      const weightOz =
        item.weight != null ? toOunces(item.weight, item.weightUnit) : null;

      // Normalize dimensions to inches
      const lengthIn =
        item.length != null ? toInches(item.length, item.dimensionUnit) : null;
      const widthIn =
        item.width != null ? toInches(item.width, item.dimensionUnit) : null;
      const heightIn =
        item.height != null ? toInches(item.height, item.dimensionUnit) : null;

      const vol = itemVolume(lengthIn, widthIn, heightIn);

      // Track missing data
      if (vol == null) {
        itemsMissingDimensions.push(item.sku);
      }
      if (weightOz == null) {
        itemsMissingWeight.push(item.sku);
      }

      packingItems.push({
        productVariantId: item.productVariantId,
        sku: item.sku,
        name: item.name,
        volume: vol,
        weight: weightOz,
        quantity: item.quantity,
      });
    }

    // Add warnings
    if (itemsMissingDimensions.length > 0) {
      warnings.push(
        `${itemsMissingDimensions.length} item(s) missing dimensions — box size may be inaccurate`,
      );
    }
    if (itemsMissingWeight.length > 0) {
      warnings.push(
        `${itemsMissingWeight.length} item(s) missing weight — estimated weight may be inaccurate`,
      );
    }

    // If ALL items are missing dimensions, just use a single medium box
    const allMissingDims = packingItems.every((i) => i.volume == null);
    if (allMissingDims) {
      const fallbackBox =
        this.boxes.find((b) => b.id === "medium-box") ?? this.boxes[0];
      const totalWeight = packingItems.reduce(
        (sum, i) => sum + (i.weight ?? 0) * i.quantity,
        0,
      );

      warnings.push(
        "No dimension data available — defaulting to Medium Box. Update product dimensions for better recommendations.",
      );

      return {
        packages: [
          {
            sequence: 1,
            box: fallbackBox,
            items: packingItems.map((i) => ({
              productVariantId: i.productVariantId,
              sku: i.sku,
              name: i.name,
              quantity: i.quantity,
              unitWeight: i.weight,
            })),
            estimatedWeight: totalWeight,
            weightUnit: "oz",
            fillPercent: 0, // unknown
            volumeUsed: 0,
            volumeAvailable: boxVolume(fallbackBox.dimensions),
          },
        ],
        warnings,
        totalEstimatedWeight: totalWeight,
        totalItems: orderItems.reduce((sum, i) => sum + i.quantity, 0),
        itemsMissingDimensions,
        itemsMissingWeight,
      };
    }

    // Run bin packing algorithm
    const bins = packItems(packingItems, this.boxes);

    // Convert bins to recommendations
    const packages: PackageRecommendation[] = bins.map((bin, idx) => {
      const volumeAvailable = boxVolume(bin.box.dimensions);
      const fillPercent =
        volumeAvailable > 0
          ? Math.round((bin.usedVolume / volumeAvailable) * 100)
          : 0;

      return {
        sequence: idx + 1,
        box: bin.box,
        items: bin.items.map((bi) => ({
          productVariantId: bi.item.productVariantId,
          sku: bi.item.sku,
          name: bi.item.name,
          quantity: bi.quantity,
          unitWeight: bi.item.weight,
        })),
        estimatedWeight: bin.usedWeight,
        weightUnit: "oz",
        fillPercent,
        volumeUsed: Math.round(bin.usedVolume * 100) / 100,
        volumeAvailable: Math.round(volumeAvailable * 100) / 100,
      };
    });

    const totalEstimatedWeight = packages.reduce(
      (sum, p) => sum + p.estimatedWeight,
      0,
    );

    return {
      packages,
      warnings,
      totalEstimatedWeight,
      totalItems: orderItems.reduce((sum, i) => sum + i.quantity, 0),
      itemsMissingDimensions,
      itemsMissingWeight,
    };
  }
}
