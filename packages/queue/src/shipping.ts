/**
 * Shipping Queue Additions
 *
 * Add these to your @wms/queue package (packages/queue/src/index.ts)
 * or create as packages/queue/src/shipping.ts and export from index
 */

import { Queue } from "bullmq";
import { getConnection } from "./connection.js"; // Your existing connection helper

// =============================================================================
// Queue Name
// =============================================================================

// Add to your QUEUES constant:
// export const QUEUES = {
//   ...existing,
//   SHIPPING: "shipping",
// } as const;

export const SHIPPING_QUEUE = "shipping";

// =============================================================================
// Job Names
// =============================================================================

export const SHIPPING_JOBS = {
  /** Create shipping label via ShipEngine */
  CREATE_LABEL: "create-label",

  /** Sync fulfillment to Shopify after shipping */
  SYNC_SHOPIFY_FULFILLMENT: "sync-shopify-fulfillment",

  /** Void a shipping label */
  VOID_LABEL: "void-label",

  /** Update tracking status (scheduled job) */
  UPDATE_TRACKING: "update-tracking",

  /** Process batch of shipments */
  BATCH_CREATE_LABELS: "batch-create-labels",
} as const;

// =============================================================================
// Queue Factory
// =============================================================================

let shippingQueue: Queue | null = null;

export function getShippingQueue(): Queue {
  if (!shippingQueue) {
    shippingQueue = new Queue(SHIPPING_QUEUE, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
    });
  }
  return shippingQueue;
}

// =============================================================================
// Job Data Types (for type safety)
// =============================================================================

export interface CreateLabelJobData {
  orderId: string;
  carrierCode: string;
  serviceCode: string;
  packages: Array<{
    packageCode: string;
    weight: number;
    length?: number;
    width?: number;
    height?: number;
    items?: Array<{
      sku: string;
      quantity: number;
      productName?: string;
      unitPrice?: number;
    }>;
  }>;
  shippingAddress?: {
    name: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
    phone?: string;
  };
  items?: Array<{
    sku: string;
    quantity: number;
    productName?: string;
    unitPrice?: number;
  }>;
  notes?: string;
  userId: string;
}

export interface SyncShopifyFulfillmentJobData {
  orderId: string;
  shopifyOrderId: string;
  trackingNumbers: string[];
  carrier: string;
  items?: Array<{
    sku: string;
    quantity: number;
  }>;
}

export interface VoidLabelJobData {
  labelId: string;
  packageId?: string;
  orderId?: string;
  userId?: string;
}

// =============================================================================
// Helper: Add job with typed data
// =============================================================================

export async function addShippingJob<T extends keyof typeof SHIPPING_JOBS>(
  jobName: T,
  data: T extends "CREATE_LABEL"
    ? CreateLabelJobData
    : T extends "SYNC_SHOPIFY_FULFILLMENT"
      ? SyncShopifyFulfillmentJobData
      : T extends "VOID_LABEL"
        ? VoidLabelJobData
        : Record<string, unknown>,
  options?: { jobId?: string; delay?: number; priority?: number },
) {
  const queue = getShippingQueue();
  return queue.add(SHIPPING_JOBS[jobName], data, {
    jobId: options?.jobId,
    delay: options?.delay,
    priority: options?.priority,
  });
}
