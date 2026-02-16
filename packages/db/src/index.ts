/**
 * @wms/db - Database package
 *
 * Exports Prisma client, enums, and repositories.
 *
 *
 *
 * IMPORTANT: To avoid naming conflicts between Prisma-generated types
 * and repository types, we use selective exports.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Prisma Client
// ─────────────────────────────────────────────────────────────────────────────
export { prisma, PrismaClient } from "./client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Prisma Namespace (for Prisma.ProductWhereInput, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Prisma Enums
// ─────────────────────────────────────────────────────────────────────────────
export {
  // User & Auth
  UserRole,

  // Orders
  OrderStatus,
  PaymentStatus,
  Priority,

  // Inventory
  InventoryStatus,
  AllocationStatus,
  LocationType,

  // Work Tasks
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskBlockReason,
  WorkTaskItemStatus,
  WorkTaskEventType,

  // Fulfillment
  PickBinStatus,
  OrderPackageStatus,

  // Receiving
  ReceivingSessionStatus,
  ReceivingLineStatus,
  ReceivingExceptionType,
  ReceivingExceptionStatus,

  // Cycle Count
  CycleCountTaskStatus,
  CycleCountSessionStatus,
  CycleCountLineStatus,
  AdjustmentStatus,

  // Invoice
  InvoiceStatus,
} from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Repositories
// ─────────────────────────────────────────────────────────────────────────────
export * from "./repositories/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Prisma Model Types
// Export these when you need the raw Prisma-generated types
// ─────────────────────────────────────────────────────────────────────────────
export type {
  User,
  RefreshToken,
  PasswordResetToken,
  Product,
  ProductVariant,
  Location,
  InventoryUnit,
  Allocation,
  Order,
  OrderItem,
  WorkTask,
  TaskItem,
  TaskEvent,
  FulfillmentEvent,
  ShippingPackage,
  ShippingPackageItem,
  ShippingLabel,
  ReceivingSession,
  ReceivingLine,
  ReceivingException,
  CycleCountTask,
  CycleCountSession,
  CycleCountLine,
  CycleCountAudit,
  InventoryAdjustment,
  AuditLog,
  Notification,
  PackingImage,
  PickBin,
  PickBinItem,
  InventoryDiscrepancy,
  FulfillmentMetric,
  UserPerformance,
  OrderPackage,
  OrderPackageItem,
  Invoice,
  InvoiceItem,
} from "@prisma/client";
