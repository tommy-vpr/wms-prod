/**
 * Shopify Processor
 * Handles Shopify webhook jobs
 */

import { Job } from "bullmq";
import { prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { SHOPIFY_JOBS, type ShopifyOrderCreateJobData } from "@wms/queue";
import { randomUUID } from "crypto";

// ============================================================================
// Order Processing
// ============================================================================

async function processShopifyOrderCreate(job: Job<ShopifyOrderCreateJobData>) {
  const { shopifyOrderId, payload } = job.data;
  const shopifyOrder = payload as any;

  // Debug logging
  console.log("[Shopify] Payload keys:", Object.keys(payload));
  console.log("[Shopify] payload.id:", shopifyOrder.id);
  console.log("[Shopify] payload.name:", shopifyOrder.name);
  console.log("[Shopify] payload.order_number:", shopifyOrder.order_number);

  // Use the REAL Shopify order ID from payload
  const realShopifyOrderId = shopifyOrder.id?.toString() || shopifyOrderId;
  const orderNumber =
    shopifyOrder.name ||
    shopifyOrder.order_number?.toString() ||
    `SHOP-${realShopifyOrderId}`;

  console.log(`[Shopify] Processing order: ${orderNumber}`);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Idempotency check
    const existing = await tx.order.findUnique({
      where: { shopifyOrderId: realShopifyOrderId },
    });

    if (existing) {
      console.log(`[Shopify] Order already exists: ${existing.orderNumber}`);
      return { orderId: existing.id, status: "already_exists" };
    }

    // 2. Extract customer name
    let customerName = "Unknown Customer";
    if (shopifyOrder.shipping_address) {
      customerName =
        `${shopifyOrder.shipping_address.first_name || ""} ${shopifyOrder.shipping_address.last_name || ""}`.trim();
    } else if (shopifyOrder.customer) {
      customerName =
        `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim();
    } else if (shopifyOrder.billing_address) {
      customerName =
        `${shopifyOrder.billing_address.first_name || ""} ${shopifyOrder.billing_address.last_name || ""}`.trim();
    }

    if (!customerName) {
      customerName = "Unknown Customer";
    }

    // 3. Fetch fulfillment order line items (for modern Shopify API)
    const fulfillmentLineItems =
      await fetchFulfillmentOrderLineItems(realShopifyOrderId);

    // 4. Create order (we'll update unmatchedItems count after creating items)
    const order = await tx.order.create({
      data: {
        shopifyOrderId: realShopifyOrderId,
        orderNumber,
        customerName,
        customerEmail: shopifyOrder.email || shopifyOrder.contact_email,
        totalAmount: parseFloat(
          shopifyOrder.total_price || shopifyOrder.current_total_price || "0",
        ),
        shippingAddress: shopifyOrder.shipping_address || {},
        billingAddress: shopifyOrder.billing_address || {},
        status: "PENDING",
        paymentStatus: mapPaymentStatus(shopifyOrder.financial_status),
        priority: mapPriority(shopifyOrder.tags),
        shopifyLineItems: shopifyOrder.line_items?.map((li: any) => ({
          id: li.id?.toString(),
          variantId: li.variant_id?.toString(),
          sku: li.sku,
          quantity: li.quantity,
          title: li.title,
          price: li.price,
        })),
      },
    });

    // 5. Create order items - ALWAYS create, even if variant not found
    const lineItems = shopifyOrder.line_items || [];
    let itemsCreated = 0;
    let unmatchedCount = 0;

    for (const lineItem of lineItems) {
      const productVariant = await findVariant(tx, lineItem);
      const isMatched = !!productVariant;

      if (!isMatched) {
        unmatchedCount++;
        console.log(
          `[Shopify] Unmatched item - SKU: ${lineItem.sku}, Shopify Variant: ${lineItem.variant_id}`,
        );
      }

      const variantGid = lineItem.variant_id
        ? `gid://shopify/ProductVariant/${lineItem.variant_id}`
        : null;
      const foLineItemId = variantGid
        ? fulfillmentLineItems.get(variantGid)
        : null;

      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productVariantId: productVariant?.id || null,
          sku: lineItem.sku || `UNKNOWN-${lineItem.variant_id || lineItem.id}`,
          quantity: lineItem.quantity,
          unitPrice: parseFloat(lineItem.price || "0"),
          totalPrice: parseFloat(lineItem.price || "0") * lineItem.quantity,
          matched: isMatched,
          matchError: isMatched
            ? null
            : `SKU not found: ${lineItem.sku || "N/A"}, Shopify Variant ID: ${lineItem.variant_id || "N/A"}`,
          shopifyLineItemId: lineItem.id?.toString(),
          shopifyFulfillmentOrderLineItemId: foLineItemId || undefined,
        },
      });

      itemsCreated++;
    }

    // 6. Update order with unmatched count and possibly hold it
    if (unmatchedCount > 0) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          unmatchedItems: unmatchedCount,
          // Optionally hold the order if items are unmatched
          // status: 'ON_HOLD',
          // holdReason: `${unmatchedCount} item(s) could not be matched to inventory`,
          // holdAt: new Date(),
        },
      });

      console.log(
        `[Shopify] Order ${orderNumber} has ${unmatchedCount} unmatched items`,
      );
    }

    console.log(
      `[Shopify] Created order ${orderNumber} with ${itemsCreated} items (${unmatchedCount} unmatched)`,
    );

    // 7. Auto-confirm if payment is complete
    // *********** No Auto Confirm **********
    // if (shopifyOrder.financial_status === "paid") {
    //   await tx.order.update({
    //     where: { id: order.id },
    //     data: { status: "CONFIRMED" },
    //   });
    //   console.log(`[Shopify] Order ${orderNumber} auto-confirmed (paid)`);
    // }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      itemsCreated,
      unmatchedItems: unmatchedCount,
      status: "created",
    };
  });

  // 8. Publish order:created event for real-time dashboard updates
  if (result.status === "created") {
    try {
      await publish({
        id: randomUUID(),
        type: EVENT_TYPES.ORDER_CREATED,
        orderId: result.orderId,
        payload: {
          orderNumber: result.orderNumber,
          itemCount: result.itemsCreated,
          unmatchedItems: result.unmatchedItems,
          source: "SHOPIFY",
          customerName: shopifyOrder.shipping_address
            ? `${shopifyOrder.shipping_address.first_name || ""} ${shopifyOrder.shipping_address.last_name || ""}`.trim()
            : shopifyOrder.customer
              ? `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim()
              : "Unknown",
          message: `New Shopify order ${result.orderNumber}`,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Non-critical — don't fail the job if pubsub is down
      console.warn("[Shopify] Failed to publish order:created event:", err);
    }
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchFulfillmentOrderLineItems(
  shopifyOrderId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) return map;

  try {
    const query = `
      query($orderId: ID!) {
        order(id: $orderId) {
          fulfillmentOrders(first: 5) {
            edges {
              node {
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      lineItem {
                        variant { id }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(
      `https://${domain}/admin/api/2025-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { orderId: `gid://shopify/Order/${shopifyOrderId}` },
        }),
      },
    );

    if (response.ok) {
      const result = await response.json();
      const fulfillmentOrders =
        result.data?.order?.fulfillmentOrders?.edges || [];

      for (const foEdge of fulfillmentOrders) {
        for (const liEdge of foEdge.node.lineItems.edges) {
          const variantGid = liEdge.node.lineItem.variant?.id;
          const foLineItemGid = liEdge.node.id;
          if (variantGid && foLineItemGid) {
            map.set(variantGid, foLineItemGid);
          }
        }
      }
    }
  } catch (error) {
    console.warn("[Shopify] Failed to fetch fulfillment line items:", error);
  }

  return map;
}

/**
 * Find variant by SKU or Shopify Variant ID
 * Does NOT auto-create - returns null if not found
 */
async function findVariant(tx: any, lineItem: any) {
  // Try by SKU first (most reliable)
  if (lineItem.sku) {
    const variant = await tx.productVariant.findUnique({
      where: { sku: lineItem.sku },
    });
    if (variant) return variant;
  }

  // Try by Shopify variant ID
  if (lineItem.variant_id) {
    const variant = await tx.productVariant.findFirst({
      where: { shopifyVariantId: lineItem.variant_id.toString() },
    });
    if (variant) return variant;
  }

  // Try by barcode/UPC if available
  if (lineItem.barcode) {
    const variant = await tx.productVariant.findFirst({
      where: {
        OR: [{ barcode: lineItem.barcode }, { upc: lineItem.barcode }],
      },
    });
    if (variant) return variant;
  }

  return null;
}

function mapPaymentStatus(
  shopifyStatus: string | null | undefined,
): "PENDING" | "PAID" | "REFUNDED" | "AUTHORIZED" {
  switch (shopifyStatus) {
    case "paid":
      return "PAID";
    case "authorized":
      return "AUTHORIZED";
    case "refunded":
    case "partially_refunded":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

function mapPriority(
  tags: string | null | undefined,
): "STANDARD" | "RUSH" | "EXPRESS" {
  if (!tags) return "STANDARD";
  const tagLower = tags.toLowerCase();
  if (tagLower.includes("express") || tagLower.includes("overnight")) {
    return "EXPRESS";
  }
  if (tagLower.includes("rush") || tagLower.includes("priority")) {
    return "RUSH";
  }
  return "STANDARD";
}

// ============================================================================
// Main Processor
// ============================================================================

export async function processShopifyJob(job: Job): Promise<unknown> {
  console.log(`[Shopify] Processing job: ${job.name} (${job.id})`);

  switch (job.name) {
    case SHOPIFY_JOBS.ORDER_CREATE:
      return processShopifyOrderCreate(job as Job<ShopifyOrderCreateJobData>);

    case SHOPIFY_JOBS.ORDER_UPDATE:
      // TODO: Handle order updates (address changes, etc.)
      console.log("[Shopify] ORDER_UPDATE not implemented yet");
      return { status: "not_implemented" };

    case SHOPIFY_JOBS.ORDER_CANCEL:
      // TODO: Handle cancellations (release allocations, update status)
      console.log("[Shopify] ORDER_CANCEL not implemented yet");
      return { status: "not_implemented" };

    default:
      throw new Error(`Unknown Shopify job: ${job.name}`);
  }
}
