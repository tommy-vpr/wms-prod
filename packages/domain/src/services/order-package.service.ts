/**
 * OrderPackageService
 * Manages OrderPackage lifecycle: create from recommendation → packing → shipping
 * Bridges BoxRecommendationService (pure logic) with database persistence
 *
 * Save to: packages/domain/src/services/order-package.service.ts
 */

import {
  BoxRecommendationService,
  type OrderItemInput,
  type RecommendationResult,
} from "./box-recommendation.service.js";
import type {
  OrderPackageRepository,
  OrderPackageRecord,
  CreatePackageInput,
  CreatePackageItemInput,
  UpdatePackageInput,
  PackedPackageInput,
} from "@wms/db";

// =============================================================================
// Service
// =============================================================================

export class OrderPackageService {
  constructor(
    private repo: OrderPackageRepository,
    private boxService: BoxRecommendationService = new BoxRecommendationService(),
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Generate Recommendation & Persist
  // Called after successful allocation
  // ─────────────────────────────────────────────────────────────────────────

  async recommendAndSave(orderId: string): Promise<{
    recommendation: RecommendationResult;
    packages: OrderPackageRecord[];
  }> {
    // 1. Load order items with variant dimensions
    const orderItems = await this.repo.findOrderItemsWithDimensions(orderId);

    if (orderItems.length === 0) {
      return {
        recommendation: {
          packages: [],
          warnings: ["No order items found"],
          totalEstimatedWeight: 0,
          totalItems: 0,
          itemsMissingDimensions: [],
          itemsMissingWeight: [],
        },
        packages: [],
      };
    }

    // 2. Run box recommendation algorithm
    const recommendation = this.boxService.recommend(orderItems);

    // 3. Delete any existing DRAFT packages (re-recommendation scenario)
    await this.repo.deleteDraftPackages(orderId);

    // 4. Persist as OrderPackage records
    const createInputs: CreatePackageInput[] = recommendation.packages.map(
      (pkg) => ({
        sequence: pkg.sequence,
        boxId: pkg.box.id,
        boxLabel: pkg.box.label,
        length: pkg.box.dimensions.length,
        width: pkg.box.dimensions.width,
        height: pkg.box.dimensions.height,
        dimensionUnit: "in",
        estimatedWeight: pkg.estimatedWeight,
        weightUnit: pkg.weightUnit,
        items: pkg.items.map((item) => ({
          productVariantId: item.productVariantId,
          sku: item.sku,
          quantity: item.quantity,
          unitWeight: item.unitWeight,
          unitWeightUnit: "oz",
        })),
      }),
    );

    const packages = await this.repo.createPackages(orderId, createInputs);

    return { recommendation, packages };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Get packages for an order (packing / shipping screens load this)
  // ─────────────────────────────────────────────────────────────────────────

  async getPackages(orderId: string): Promise<OrderPackageRecord[]> {
    return this.repo.findByOrderId(orderId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Packer adjustments — change box, adjust items, add/remove packages
  // ─────────────────────────────────────────────────────────────────────────

  async updatePackage(
    packageId: string,
    data: UpdatePackageInput,
  ): Promise<OrderPackageRecord> {
    return this.repo.updatePackage(packageId, data);
  }

  async replacePackageItems(
    packageId: string,
    items: CreatePackageItemInput[],
  ): Promise<void> {
    return this.repo.replacePackageItems(packageId, items);
  }

  async addPackage(orderId: string): Promise<OrderPackageRecord> {
    const existing = await this.repo.findByOrderId(orderId);
    const maxSeq = existing.reduce((max, p) => Math.max(max, p.sequence), 0);
    return this.repo.addPackage(orderId, maxSeq + 1);
  }

  async removePackage(packageId: string): Promise<void> {
    return this.repo.deletePackage(packageId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mark packages as packed (packer completes packing step)
  // ─────────────────────────────────────────────────────────────────────────

  async markPacked(
    orderId: string,
    packData: PackedPackageInput[],
  ): Promise<void> {
    return this.repo.markPacked(orderId, packData);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mark packages as shipped (after label creation)
  // ─────────────────────────────────────────────────────────────────────────

  async markShipped(orderId: string): Promise<void> {
    return this.repo.markShipped(orderId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Re-recommend (packer wants to reset to algorithm suggestion)
  // ─────────────────────────────────────────────────────────────────────────

  async reRecommend(orderId: string): Promise<{
    recommendation: RecommendationResult;
    packages: OrderPackageRecord[];
  }> {
    return this.recommendAndSave(orderId);
  }
}
