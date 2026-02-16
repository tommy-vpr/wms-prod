/**
 * Shipping Processor
 * BullMQ processor for shipping background jobs
 *
 * Save to: apps/worker/src/processors/shipping.processor.ts
 */

import { Job } from "bullmq";
import { SHIPPING_JOBS } from "@wms/queue";
import { ShippingService, getShopifyCarrierName } from "@wms/domain";
import { prisma } from "@wms/db";

// =============================================================================
// Processor
// =============================================================================

const service = new ShippingService(prisma);

export async function processShippingJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case SHIPPING_JOBS.CREATE_LABEL:
      return handleCreateLabel(job);

    case SHIPPING_JOBS.SYNC_SHOPIFY_FULFILLMENT:
      return handleSyncShopifyFulfillment(job);

    case SHIPPING_JOBS.VOID_LABEL:
      return handleVoidLabel(job);

    default:
      throw new Error(`Unknown shipping job: ${job.name}`);
  }
}

// =============================================================================
// Job Handlers
// =============================================================================

/**
 * CREATE_LABEL
 * Create shipping label(s) via ShipEngine
 *
 * Data: { orderId, carrierCode, serviceCode, packages, shippingAddress?, items?, notes?, userId }
 */
async function handleCreateLabel(job: Job): Promise<unknown> {
  const {
    orderId,
    carrierCode,
    serviceCode,
    packages,
    shippingAddress,
    items,
    notes,
    userId,
  } = job.data;

  console.log(`[Shipping] Creating label for order ${orderId}`);

  try {
    const result = await service.createLabels(
      {
        orderId,
        carrierCode,
        serviceCode,
        packages,
        shippingAddress,
        items,
        notes,
      },
      userId,
    );

    console.log(
      `[Shipping] Labels created for order ${orderId}: ${result.labels.length} label(s), $${result.totalCost}`,
    );

    // Queue Shopify fulfillment sync if order has Shopify ID
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { shopifyOrderId: true },
    });

    if (order?.shopifyOrderId) {
      const { getShippingQueue } = await import("@wms/queue");
      const queue = getShippingQueue();

      await queue.add(SHIPPING_JOBS.SYNC_SHOPIFY_FULFILLMENT, {
        orderId,
        shopifyOrderId: order.shopifyOrderId,
        trackingNumbers: result.labels.map((l) => l.trackingNumber),
        carrier: getShopifyCarrierName(carrierCode),
        items,
      });

      console.log(
        `[Shipping] Queued Shopify fulfillment sync for order ${orderId}`,
      );
    }

    return {
      success: true,
      orderId,
      labels: result.labels,
      totalCost: result.totalCost,
    };
  } catch (error) {
    console.error(
      `[Shipping] Failed to create label for order ${orderId}:`,
      error,
    );
    throw error;
  }
}

/**
 * SYNC_SHOPIFY_FULFILLMENT
 * Sync fulfillment status to Shopify after shipping
 *
 * Data: { orderId, shopifyOrderId, trackingNumbers, carrier, items }
 */
async function handleSyncShopifyFulfillment(job: Job): Promise<unknown> {
  const { orderId, shopifyOrderId, trackingNumbers, carrier, items } = job.data;

  console.log(`[Shipping] Syncing Shopify fulfillment for order ${orderId}`);

  // Load order with Shopify line item IDs
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          productVariant: {
            select: { sku: true, shopifyVariantId: true },
          },
        },
      },
    },
  });

  if (!order) {
    console.warn(`[Shipping] Order ${orderId} not found`);
    return { skipped: true, reason: "order_not_found" };
  }

  // ─── YOUR SHOPIFY FULFILLMENT API CALL ──────────────────────────────────
  //
  // Use your existing Shopify service/client to create fulfillment.
  // Example structure:
  //
  // const lineItems = (items || order.items).map(item => {
  //   const orderItem = order.items.find(oi => oi.productVariant?.sku === item.sku);
  //   return {
  //     id: orderItem?.shopifyLineItemId,
  //     quantity: item.quantity,
  //   };
  // }).filter(i => i.id);
  //
  // await shopifyService.createFulfillment({
  //   orderId: shopifyOrderId,
  //   trackingNumbers,
  //   trackingCompany: carrier,
  //   lineItems,
  //   notifyCustomer: true,
  // });
  //
  // ────────────────────────────────────────────────────────────────────────

  console.log(`[Shipping] TODO: Implement Shopify fulfillment API call`);
  console.log(`  Shopify Order ID: ${shopifyOrderId}`);
  console.log(`  Tracking Numbers: ${trackingNumbers.join(", ")}`);
  console.log(`  Carrier: ${carrier}`);

  return {
    success: true,
    orderId,
    shopifyOrderId,
    trackingNumbers,
    carrier,
  };
}

/**
 * VOID_LABEL
 * Void a shipping label (background)
 *
 * Data: { labelId, packageId?, orderId, userId }
 */
async function handleVoidLabel(job: Job): Promise<unknown> {
  const { labelId, packageId, orderId, userId } = job.data;

  console.log(`[Shipping] Voiding label ${labelId}`);

  try {
    const result = await service.voidLabel(labelId, packageId, userId);

    if (result.approved) {
      console.log(`[Shipping] Label ${labelId} voided successfully`);

      // If package is associated with an order, potentially update order status
      if (packageId) {
        const pkg = await prisma.shippingPackage.findUnique({
          where: { id: packageId },
          include: { order: { select: { id: true, status: true } } },
        });

        if (pkg?.order && pkg.order.status === "SHIPPED") {
          // Check if all packages for this order are voided
          const activePackages = await prisma.shippingPackage.count({
            where: {
              orderId: pkg.order.id,
              voidedAt: null,
            },
          });

          if (activePackages === 0) {
            await prisma.order.update({
              where: { id: pkg.order.id },
              data: { status: "PACKED" },
            });
            console.log(`[Shipping] Order ${pkg.order.id} reverted to PACKED`);
          }
        }
      }
    }

    return {
      success: true,
      labelId,
      approved: result.approved,
      message: result.message,
    };
  } catch (error) {
    console.error(`[Shipping] Failed to void label ${labelId}:`, error);
    throw error;
  }
}
