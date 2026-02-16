/**
 * Order Processor
 * Handles order allocation jobs + triggers box recommendation after allocation
 *
 * Save to: apps/worker/src/processors/order.processor.ts
 */

import { Job } from "bullmq";
import {
  ORDER_JOBS,
  type AllocateOrderJobData,
  type AllocateOrdersJobData,
  type ReleaseAllocationsJobData,
  type CheckBackordersJobData,
  enqueueAllocateOrder,
} from "@wms/queue";
import { orderAllocationService } from "@wms/domain";
import { OrderPackageService, BoxRecommendationService } from "@wms/domain";
import { orderPackageRepository } from "@wms/db";

// =============================================================================
// Initialize Services
// =============================================================================

const orderPackageService = new OrderPackageService(
  orderPackageRepository,
  new BoxRecommendationService(),
);

// =============================================================================
// Job Processors
// =============================================================================

async function processAllocateOrder(job: Job<AllocateOrderJobData>) {
  const { orderId, allowPartial = true } = job.data;

  console.log(`[Orders] Allocating order: ${orderId}`);

  const result = await orderAllocationService.allocateOrder(
    orderId,
    allowPartial,
  );

  console.log(
    `[Orders] Order ${result.orderNumber}: ${result.status} ` +
      `(${result.allocatedItems} allocated, ${result.backorderedItems} backordered, ${result.unmatchedItems} unmatched)`,
  );

  // ── Box Recommendation ──────────────────────────────────────────────────
  // After successful full allocation, generate package recommendations
  // so the packing UI has pre-computed box assignments
  if (result.status === "ALLOCATED") {
    try {
      const { recommendation, packages } =
        await orderPackageService.recommendAndSave(orderId);

      console.log(
        `[Orders] Box recommendation for ${result.orderNumber}: ` +
          `${packages.length} package(s), ` +
          `${recommendation.warnings.length} warning(s)`,
      );

      if (recommendation.itemsMissingWeight.length > 0) {
        console.warn(
          `[Orders] Missing weight data for: ${recommendation.itemsMissingWeight.join(", ")}`,
        );
      }
    } catch (err) {
      // Don't fail allocation if box recommendation fails
      // Packer can still manually assign boxes
      console.error(
        `[Orders] Box recommendation failed for ${result.orderNumber}:`,
        err,
      );
    }
  }

  return result;
}

async function processAllocateOrders(job: Job<AllocateOrdersJobData>) {
  const { orderIds, allowPartial = true } = job.data;

  console.log(`[Orders] Allocating ${orderIds.length} orders`);

  const result = await orderAllocationService.allocateOrders({
    orderIds,
    allowPartial,
  });

  console.log(
    `[Orders] Batch allocation complete: ` +
      `${result.fullyAllocated.length} allocated, ` +
      `${result.partiallyAllocated.length} partial, ` +
      `${result.backordered.length} backordered, ` +
      `${result.onHold.length} on hold, ` +
      `${result.errors.length} errors`,
  );

  // ── Box Recommendations for fully allocated orders ──────────────────────
  for (const allocated of result.fullyAllocated) {
    try {
      await orderPackageService.recommendAndSave(allocated.orderId);
    } catch (err) {
      console.error(
        `[Orders] Box recommendation failed for order ${allocated.orderId}:`,
        err,
      );
    }
  }

  return result;
}

async function processReleaseAllocations(job: Job<ReleaseAllocationsJobData>) {
  const { orderId, reason } = job.data;

  console.log(
    `[Orders] Releasing allocations for order: ${orderId}${reason ? ` (${reason})` : ""}`,
  );

  await orderAllocationService.releaseAllocations(orderId);

  return { orderId, released: true };
}

async function processCheckBackorders(job: Job<CheckBackordersJobData>) {
  const { productVariantId, triggerSource } = job.data;

  console.log(
    `[Orders] Checking backorders for product variant: ${productVariantId}` +
      (triggerSource ? ` (triggered by ${triggerSource})` : ""),
  );

  const orderIds =
    await orderAllocationService.checkBackorderedOrders(productVariantId);

  if (orderIds.length > 0) {
    console.log(
      `[Orders] Found ${orderIds.length} backordered orders to retry`,
    );

    for (const orderId of orderIds) {
      await enqueueAllocateOrder({
        orderId,
        allowPartial: true,
        idempotencyKey: `backorder-retry-${orderId}-${Date.now()}`,
      });
    }
  }

  return { productVariantId, ordersFound: orderIds.length, orderIds };
}

// =============================================================================
// Main Processor
// =============================================================================

export async function processOrderJob(job: Job): Promise<unknown> {
  console.log(`[Orders] Processing job: ${job.name} (${job.id})`);

  switch (job.name) {
    case ORDER_JOBS.ALLOCATE_ORDER:
      return processAllocateOrder(job as Job<AllocateOrderJobData>);

    case ORDER_JOBS.ALLOCATE_ORDERS:
      return processAllocateOrders(job as Job<AllocateOrdersJobData>);

    case ORDER_JOBS.RELEASE_ALLOCATIONS:
      return processReleaseAllocations(job as Job<ReleaseAllocationsJobData>);

    case ORDER_JOBS.CHECK_BACKORDERS:
      return processCheckBackorders(job as Job<CheckBackordersJobData>);

    default:
      throw new Error(`Unknown order job: ${job.name}`);
  }
}
