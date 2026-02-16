/**
 * Repository Exports
 *
 * Uses named exports to avoid conflicts with Prisma types.
 */

// Work Tasks
export {
  workTaskRepository,
  taskItemRepository,
  taskEventRepository,
} from "./work-task.repo.js";

// Allocation
export { allocationRepository } from "./allocation.repo.js";

// Inventory
export { inventoryRepository } from "./inventory.repo.js";

// Orders
export { orderRepository } from "./order.repo.js";

// Products - named exports only (no export *)
export { productRepository } from "./product.repo.js";
export type {
  ProductWithVariants,
  UpsertProductData,
  UpsertVariantData,
  ImportResult as ProductImportResult,
} from "./product.repo.js";

// Order Packages
export { orderPackageRepository } from "./order-package.repo.js";

// Fulfillment Pipeline - Picking
export { pickingRepository } from "./picking.repo.js";
export type { PickingRepository } from "./picking.repo.js";

// Fulfillment Pipeline - Packing
export { packingRepository } from "./packing.repo.js";
export type { PackingRepository } from "./packing.repo.js";

// Fulfillment Pipeline - Main
export { fulfillmentRepository } from "./fulfillment.repo.js";
export type {
  FulfillmentRepository,
  FulfillmentWorkTask,
} from "./fulfillment.repo.js";
