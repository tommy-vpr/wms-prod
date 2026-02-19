/**
 * Queue Instances & Helpers
 * Functions to enqueue jobs from the API
 */

import { Queue, type JobsOptions } from "bullmq";
import { getConnection } from "./connection.js";
import {
  QUEUES,
  WORK_TASK_JOBS,
  SHOPIFY_JOBS,
  ORDER_JOBS,
  PRODUCT_JOBS,
  SHIPPING_JOBS,
  RECEIVING_JOBS,
  CYCLE_COUNT_JOBS,
  PACKING_IMAGE_JOBS, // Add this
  type CreateLabelJobData,
  type SyncShopifyFulfillmentJobData,
  type VoidLabelJobData,
  type CreatePickingTaskJobData,
  type AssignTaskJobData,
  type StartTaskJobData,
  type CancelTaskJobData,
  type ShopifyOrderCreateJobData,
  type AllocateOrderJobData,
  type AllocateOrdersJobData,
  type ReleaseAllocationsJobData,
  type CheckBackordersJobData,
  type ImportProductsJobData,
  type ImportSingleProductJobData,
  type SyncShopifyProductsJobData,
  type SyncInventoryPlannerJobData,
  INVENTORY_PLANNER_JOBS,
  FULFILLMENT_JOBS,
  type CreateShippingLabelJobData,
  type ShopifyFulfillJobData,
  type SyncPurchaseOrdersJobData,
  type ProcessApprovalJobData,
  type NotifyApproversJobData,
  type AutoApproveSessionJobData,
  type GenerateBarcodeLabelsJobData,
  type ProcessCycleCountApprovalJobData,
  type GenerateCycleCountTasksJobData,
  type NotifyCycleCountReviewersJobData,
  type GenerateVarianceReportJobData,
  // Packing Images - Add these
  type ProcessPackingImageJobData,
  type DeletePackingImageJobData,
  type GenerateThumbnailJobData,
  type CleanupOrphanedImagesJobData,
  PICK_BIN_JOBS,
  type PrintBinLabelJobData,
  type NotifyPackStationJobData,
  type HandleShortPickJobData,
  type RecordPickMetricsJobData,
} from "./types.js";

// ============================================================================
// Queue Instances
// ============================================================================

let workTaskQueue: Queue | null = null;
let shopifyQueue: Queue | null = null;
let ordersQueue: Queue | null = null;
let productsQueue: Queue | null = null;
let inventoryPlannerQueue: Queue | null = null;
let fulfillmentQueue: Queue | null = null;
let shippingQueue: Queue | null = null;
let receivingQueue: Queue | null = null;
let cycleCountQueue: Queue | null = null;
let packingImagesQueue: Queue | null = null;
let pickBinQueue: Queue | null = null;

export function getPickBinQueue(): Queue {
  if (!pickBinQueue) {
    pickBinQueue = new Queue(QUEUES.PICK_BIN, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 500, age: 24 * 60 * 60 },
        removeOnFail: { count: 1000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return pickBinQueue;
}

export async function enqueuePrintBinLabel(
  data: PrintBinLabelJobData,
  options?: JobsOptions,
) {
  const queue = getPickBinQueue();
  return queue.add(PICK_BIN_JOBS.PRINT_LABEL, data, {
    priority: 1, // High - picker waiting
    ...options,
  });
}

export async function enqueueNotifyPackStation(
  data: NotifyPackStationJobData,
  options?: JobsOptions,
) {
  const queue = getPickBinQueue();
  return queue.add(PICK_BIN_JOBS.NOTIFY_PACK_STATION, data, {
    priority: 2,
    ...options,
  });
}

export async function enqueueHandleShortPick(
  data: HandleShortPickJobData,
  options?: JobsOptions,
) {
  const queue = getPickBinQueue();
  return queue.add(PICK_BIN_JOBS.HANDLE_SHORT_PICK, data, {
    priority: 5,
    ...options,
  });
}

export async function enqueueRecordPickMetrics(
  data: RecordPickMetricsJobData,
  options?: JobsOptions,
) {
  const queue = getPickBinQueue();
  return queue.add(PICK_BIN_JOBS.RECORD_METRICS, data, {
    priority: 10, // Lowest - analytics
    ...options,
  });
}

export function getWorkTaskQueue(): Queue {
  if (!workTaskQueue) {
    workTaskQueue = new Queue(QUEUES.WORK_TASKS, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 60 * 60,
        },
        removeOnFail: {
          count: 5000,
          age: 7 * 24 * 60 * 60,
        },
      },
    });
  }
  return workTaskQueue;
}

export function getFulfillmentQueue(): Queue {
  if (!fulfillmentQueue) {
    fulfillmentQueue = new Queue(QUEUES.FULFILLMENT, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
        removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return fulfillmentQueue;
}

export async function enqueueCreateShippingLabel(
  data: CreateShippingLabelJobData,
  options?: JobsOptions,
) {
  const queue = getFulfillmentQueue();
  return queue.add(FULFILLMENT_JOBS.CREATE_SHIPPING_LABEL, data, {
    ...options,
    jobId: data.idempotencyKey,
  });
}

/**
 * Enqueue Shopify fulfillment after an order is shipped
 * Sends tracking number to Shopify and marks order as fulfilled
 */
export async function enqueueShopifyFulfill(
  data: ShopifyFulfillJobData,
  options?: JobsOptions,
) {
  const queue = getFulfillmentQueue();
  return queue.add(FULFILLMENT_JOBS.SHOPIFY_FULFILL, data, {
    ...options,
    jobId: data.idempotencyKey,
  });
}

export function getShopifyQueue(): Queue {
  if (!shopifyQueue) {
    shopifyQueue = new Queue(QUEUES.SHOPIFY, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 5, // More retries for external webhooks
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
        removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return shopifyQueue;
}

export function getOrdersQueue(): Queue {
  if (!ordersQueue) {
    ordersQueue = new Queue(QUEUES.ORDERS, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
        removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return ordersQueue;
}

export function getProductsQueue(): Queue {
  if (!productsQueue) {
    productsQueue = new Queue(QUEUES.PRODUCTS, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
        removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return productsQueue;
}

export function getInventoryPlannerQueue(): Queue {
  if (!inventoryPlannerQueue) {
    inventoryPlannerQueue = new Queue(QUEUES.INVENTORY_PLANNER, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100, age: 24 * 60 * 60 },
        removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return inventoryPlannerQueue;
}

export function getReceivingQueue(): Queue {
  if (!receivingQueue) {
    receivingQueue = new Queue(QUEUES.RECEIVING, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 500, age: 24 * 60 * 60 },
        removeOnFail: { count: 2000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return receivingQueue;
}

export function getCycleCountQueue(): Queue {
  if (!cycleCountQueue) {
    cycleCountQueue = new Queue(QUEUES.CYCLE_COUNT, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 500, age: 24 * 60 * 60 },
        removeOnFail: { count: 2000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return cycleCountQueue;
}

// ============================================================================
// Packing Images Queue - Add this section
// ============================================================================

export function getPackingImagesQueue(): Queue {
  if (!packingImagesQueue) {
    packingImagesQueue = new Queue(QUEUES.PACKING_IMAGES, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return packingImagesQueue;
}

export async function enqueueProcessPackingImage(
  data: ProcessPackingImageJobData,
  options?: JobsOptions,
) {
  const queue = getPackingImagesQueue();
  return queue.add(PACKING_IMAGE_JOBS.PROCESS_IMAGE, data, {
    priority: 5,
    ...options,
  });
}

export async function enqueueDeletePackingImage(
  data: DeletePackingImageJobData,
  options?: JobsOptions,
) {
  const queue = getPackingImagesQueue();
  return queue.add(PACKING_IMAGE_JOBS.DELETE_IMAGE, data, {
    priority: 10,
    ...options,
  });
}

export async function enqueueGenerateThumbnail(
  data: GenerateThumbnailJobData,
  options?: JobsOptions,
) {
  const queue = getPackingImagesQueue();
  return queue.add(PACKING_IMAGE_JOBS.GENERATE_THUMBNAIL, data, {
    priority: 15,
    ...options,
  });
}

export async function enqueueCleanupOrphanedImages(
  data: CleanupOrphanedImagesJobData = {},
  options?: JobsOptions,
) {
  const queue = getPackingImagesQueue();
  return queue.add(PACKING_IMAGE_JOBS.CLEANUP_ORPHANED, data, {
    priority: 20,
    ...options,
  });
}

export async function getPackingImagesQueueStats() {
  const queue = getPackingImagesQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

// ============================================================================
// Enqueue Helpers
// ============================================================================

const DEFAULT_JOB_OPTIONS: JobsOptions = {};

/**
 * Enqueue a job to create a picking task for orders
 */
export async function enqueueCreatePickingTask(
  data: CreatePickingTaskJobData,
  options?: JobsOptions,
) {
  const queue = getWorkTaskQueue();
  return queue.add(WORK_TASK_JOBS.CREATE_PICKING_TASK, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    // Use idempotencyKey as job ID to prevent duplicates
    jobId: data.idempotencyKey,
  });
}

/**
 * Enqueue a job to assign a task to a user
 */
export async function enqueueAssignTask(
  data: AssignTaskJobData,
  options?: JobsOptions,
) {
  const queue = getWorkTaskQueue();
  return queue.add(WORK_TASK_JOBS.ASSIGN_TASK, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

/**
 * Enqueue a job to start a task
 */
export async function enqueueStartTask(
  data: StartTaskJobData,
  options?: JobsOptions,
) {
  const queue = getWorkTaskQueue();
  return queue.add(WORK_TASK_JOBS.START_TASK, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

/**
 * Enqueue a job to cancel a task
 */
export async function enqueueCancelTask(
  data: CancelTaskJobData,
  options?: JobsOptions,
) {
  const queue = getWorkTaskQueue();
  return queue.add(WORK_TASK_JOBS.CANCEL_TASK, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

/**
 * Enqueue a Shopify order creation job
 */
export async function enqueueShopifyOrderCreate(
  data: ShopifyOrderCreateJobData,
  options?: JobsOptions,
) {
  const queue = getShopifyQueue();
  return queue.add(SHOPIFY_JOBS.ORDER_CREATE, data, {
    ...options,
    jobId: data.idempotencyKey, // Prevent duplicates
  });
}

/**
 * Enqueue a job to allocate a single order
 */
export async function enqueueAllocateOrder(
  data: AllocateOrderJobData,
  options?: JobsOptions,
) {
  const queue = getOrdersQueue();
  return queue.add(ORDER_JOBS.ALLOCATE_ORDER, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `allocate-${data.orderId}-${Date.now()}`,
  });
}

/**
 * Enqueue a job to allocate multiple orders
 */
export async function enqueueAllocateOrders(
  data: AllocateOrdersJobData,
  options?: JobsOptions,
) {
  const queue = getOrdersQueue();
  return queue.add(ORDER_JOBS.ALLOCATE_ORDERS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `allocate-batch-${Date.now()}`,
  });
}

/**
 * Enqueue a job to release allocations for an order
 */
export async function enqueueReleaseAllocations(
  data: ReleaseAllocationsJobData,
  options?: JobsOptions,
) {
  const queue = getOrdersQueue();
  return queue.add(ORDER_JOBS.RELEASE_ALLOCATIONS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

/**
 * Enqueue a job to check backordered orders when inventory is received.
 * Uses dedup jobId so only one check runs per variant at a time.
 * A 3-second delay batches rapid receiving scans into a single check.
 */
export async function enqueueCheckBackorders(
  data: CheckBackordersJobData,
  options?: JobsOptions,
) {
  const queue = getOrdersQueue();
  return queue.add(ORDER_JOBS.CHECK_BACKORDERS, data, {
    ...DEFAULT_JOB_OPTIONS,
    jobId: `check-backorders-${data.productVariantId}`,
    delay: 3000, // 3s debounce — rapid scans collapse into one job
    removeOnComplete: true,
    ...options,
  });
}

/**
 * Enqueue a bulk product import job
 */
export async function enqueueImportProducts(
  data: ImportProductsJobData,
  options?: JobsOptions,
) {
  const queue = getProductsQueue();
  return queue.add(PRODUCT_JOBS.IMPORT_PRODUCTS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey,
  });
}

/**
 * Enqueue a single product import job
 */
export async function enqueueImportSingleProduct(
  data: ImportSingleProductJobData,
  options?: JobsOptions,
) {
  const queue = getProductsQueue();
  return queue.add(PRODUCT_JOBS.IMPORT_SINGLE, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

/**
 * Enqueue a Shopify product sync job
 */
export async function enqueueSyncShopifyProducts(
  data: SyncShopifyProductsJobData,
  options?: JobsOptions,
) {
  const queue = getProductsQueue();
  return queue.add(PRODUCT_JOBS.SYNC_SHOPIFY_PRODUCTS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey,
  });
}

export async function enqueueSyncInventoryPlanner(
  data: SyncInventoryPlannerJobData,
) {
  const queue = getInventoryPlannerQueue();
  return queue.add(INVENTORY_PLANNER_JOBS.SYNC_INVENTORY, data, {
    jobId: data.idempotencyKey,
  });
}

export async function enqueueSyncPurchaseOrders(
  data: SyncPurchaseOrdersJobData,
  options?: JobsOptions,
) {
  const queue = getReceivingQueue();
  return queue.add(RECEIVING_JOBS.SYNC_PURCHASE_ORDERS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `sync-po-${Date.now()}`,
  });
}

export async function enqueueProcessApproval(
  data: ProcessApprovalJobData,
  options?: JobsOptions,
) {
  const queue = getReceivingQueue();
  return queue.add(RECEIVING_JOBS.PROCESS_APPROVAL, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `approve-${data.sessionId}`,
    attempts: 1, // Don't retry approvals
  });
}

export async function enqueueNotifyApprovers(
  data: NotifyApproversJobData,
  options?: JobsOptions,
) {
  const queue = getReceivingQueue();
  return queue.add(RECEIVING_JOBS.NOTIFY_APPROVERS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: `notify-${data.sessionId}`,
  });
}

export async function enqueueAutoApproveSession(
  data: AutoApproveSessionJobData,
  options?: JobsOptions,
) {
  const queue = getReceivingQueue();
  return queue.add(RECEIVING_JOBS.AUTO_APPROVE_SESSION, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `auto-approve-${data.sessionId}`,
  });
}

export async function enqueueGenerateBarcodeLabels(
  data: GenerateBarcodeLabelsJobData,
  options?: JobsOptions,
) {
  const queue = getReceivingQueue();
  return queue.add(RECEIVING_JOBS.GENERATE_BARCODE_LABELS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: `labels-${data.sessionId}`,
  });
}

export async function enqueueProcessCycleCountApproval(
  data: ProcessCycleCountApprovalJobData,
  options?: JobsOptions,
) {
  const queue = getCycleCountQueue();
  return queue.add(CYCLE_COUNT_JOBS.PROCESS_APPROVAL, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `cc-approve-${data.sessionId}`,
    attempts: 1, // Don't retry approvals - could double-adjust inventory
  });
}

export async function enqueueGenerateCycleCountTasks(
  data: GenerateCycleCountTasksJobData,
  options?: JobsOptions,
) {
  const queue = getCycleCountQueue();
  return queue.add(CYCLE_COUNT_JOBS.GENERATE_TASKS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `cc-generate-${Date.now()}`,
  });
}

export async function enqueueNotifyCycleCountReviewers(
  data: NotifyCycleCountReviewersJobData,
  options?: JobsOptions,
) {
  const queue = getCycleCountQueue();
  return queue.add(CYCLE_COUNT_JOBS.NOTIFY_REVIEWERS, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `cc-notify-${data.sessionId}`,
  });
}

export async function enqueueGenerateVarianceReport(
  data: GenerateVarianceReportJobData,
  options?: JobsOptions,
) {
  const queue = getCycleCountQueue();
  return queue.add(CYCLE_COUNT_JOBS.GENERATE_VARIANCE_REPORT, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
    jobId: data.idempotencyKey || `cc-report-${data.sessionId}`,
  });
}

export async function getCycleCountQueueStats() {
  const queue = getCycleCountQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Get queue stats
 */
export async function getWorkTaskQueueStats() {
  const queue = getWorkTaskQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Inventory planner queue stats
 */
export async function getInventoryPlannerQueueStats() {
  const queue = getInventoryPlannerQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}
/**
 * Receiving queue stats
 */
export async function getReceivingQueueStats() {
  const queue = getReceivingQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

/**
 * Close all queues
 */
export async function closeQueues() {
  if (workTaskQueue) {
    await workTaskQueue.close();
    workTaskQueue = null;
  }
  if (shopifyQueue) {
    await shopifyQueue.close();
    shopifyQueue = null;
  }
  if (ordersQueue) {
    await ordersQueue.close();
    ordersQueue = null;
  }
  if (productsQueue) {
    await productsQueue.close();
    productsQueue = null;
  }

  if (inventoryPlannerQueue) {
    await inventoryPlannerQueue.close();
    inventoryPlannerQueue = null;
  }

  if (shippingQueue) {
    await shippingQueue.close();
    shippingQueue = null;
  }

  if (receivingQueue) {
    await receivingQueue.close();
    receivingQueue = null;
  }

  if (cycleCountQueue) {
    await cycleCountQueue.close();
    cycleCountQueue = null;
  }

  if (packingImagesQueue) {
    await packingImagesQueue.close();
    packingImagesQueue = null;
  }

  if (pickBinQueue) {
    await pickBinQueue.close();
    pickBinQueue = null;
  }
}

// ==============================================================
// SHIPPING
// ==============================================================
// Add getter
export function getShippingQueue(): Queue {
  if (!shippingQueue) {
    shippingQueue = new Queue(QUEUES.SHIPPING, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
        removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return shippingQueue;
}

// Add enqueue helpers
export async function enqueueCreateLabel(
  data: CreateLabelJobData,
  options?: JobsOptions,
) {
  const queue = getShippingQueue();
  return queue.add(SHIPPING_JOBS.CREATE_LABEL, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

export async function enqueueSyncShopifyFulfillment(
  data: SyncShopifyFulfillmentJobData,
  options?: JobsOptions,
) {
  const queue = getShippingQueue();
  return queue.add(SHIPPING_JOBS.SYNC_SHOPIFY_FULFILLMENT, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}

export async function enqueueVoidLabel(
  data: VoidLabelJobData,
  options?: JobsOptions,
) {
  const queue = getShippingQueue();
  return queue.add(SHIPPING_JOBS.VOID_LABEL, data, {
    ...DEFAULT_JOB_OPTIONS,
    ...options,
  });
}
