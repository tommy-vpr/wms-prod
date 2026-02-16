/**
 * Fulfillment Processor
 * BullMQ processor for fulfillment pipeline jobs
 *
 * Save to: apps/worker/src/processors/fulfillment.processor.ts
 */

import { Job } from "bullmq";
import { FULFILLMENT_JOBS } from "@wms/queue";
import { FulfillmentService } from "@wms/domain"; // Adjust path
import { prisma } from "@wms/db"; // Adjust to your prisma singleton

// =============================================================================
// Processor
// =============================================================================

const service = new FulfillmentService(prisma);

export async function processFulfillmentJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case FULFILLMENT_JOBS.SHOPIFY_FULFILL:
      return handleShopifyFulfill(job);

    case FULFILLMENT_JOBS.CREATE_SHIPPING_LABEL:
      return handleCreateShippingLabel(job);

    default:
      throw new Error(`Unknown fulfillment job: ${job.name}`);
  }
}

// =============================================================================
// Job Handlers
// =============================================================================

/**
 * SHOPIFY_FULFILL
 * After shipping, mark the order as fulfilled in Shopify.
 *
 * Data: { orderId, trackingNumber, carrier }
 */
async function handleShopifyFulfill(job: Job): Promise<unknown> {
  const { orderId, trackingNumber, carrier } = job.data;

  console.log(`[Fulfillment] Shopify fulfill for order ${orderId}`);

  // Load order with Shopify data
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: {
          shopifyLineItemId: true,
          shopifyFulfillmentOrderLineItemId: true,
          quantity: true,
        },
      },
    },
  });

  if (!order?.shopifyOrderId) {
    console.log(`[Fulfillment] Order ${orderId} has no Shopify ID, skipping`);
    return { skipped: true, reason: "no_shopify_order_id" };
  }

  // ─── YOUR SHOPIFY FULFILLMENT API CALL ──────────────────────────────
  //
  // Use the Shopify Fulfillment API to mark the order as fulfilled.
  // You likely already have this in your Shopify service.
  //
  // Example using Shopify REST Admin API:
  //
  // const fulfillmentOrderId = await getShopifyFulfillmentOrderId(order.shopifyOrderId);
  //
  // await shopifyClient.post(`/fulfillments.json`, {
  //   fulfillment: {
  //     line_items_by_fulfillment_order: [{
  //       fulfillment_order_id: fulfillmentOrderId,
  //       fulfillment_order_line_items: order.items
  //         .filter(i => i.shopifyFulfillmentOrderLineItemId)
  //         .map(i => ({
  //           id: i.shopifyFulfillmentOrderLineItemId,
  //           quantity: i.quantity,
  //         })),
  //     }],
  //     tracking_info: {
  //       number: trackingNumber,
  //       company: carrier,
  //     },
  //     notify_customer: true,
  //   },
  // });
  //
  // ────────────────────────────────────────────────────────────────────

  console.log(
    `[Fulfillment] TODO: Call Shopify fulfillment API for ${order.shopifyOrderId}`,
  );

  return {
    success: true,
    orderId,
    shopifyOrderId: order.shopifyOrderId,
    trackingNumber,
  };
}

/**
 * CREATE_SHIPPING_LABEL
 * Background job to create a shipping label via ShipEngine.
 * Useful if you want to decouple label creation from the request cycle.
 *
 * Data: { orderId, carrier, service, weight, dimensions, userId }
 */
async function handleCreateShippingLabel(job: Job): Promise<unknown> {
  const { orderId, userId, ...shipOptions } = job.data;

  console.log(`[Fulfillment] Creating shipping label for order ${orderId}`);

  // ─── YOUR SHIPENGINE CALL ──────────────────────────────────────────
  //
  // const labelData = await shipEngineService.createLabel({
  //   orderId,
  //   carrier: shipOptions.carrier,
  //   service: shipOptions.service,
  //   weight: shipOptions.weight,
  //   dimensions: shipOptions.dimensions,
  // });
  //
  // await service.createShippingLabel(orderId, labelData, userId);
  //
  // ──────────────────────────────────────────────────────────────────

  return { success: true, orderId };
}
