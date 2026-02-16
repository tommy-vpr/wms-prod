/**
 * Shopify Webhook Routes
 * Receives webhooks, validates, enqueues for processing
 */

import { FastifyPluginAsync } from "fastify";
import crypto from "crypto";
import { enqueueShopifyOrderCreate } from "@wms/queue";

function verifyShopifyWebhook(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

export const shopifyWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Disable automatic body parsing for raw body access
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      done(null, body);
    },
  );

  /**
   * POST /webhooks/shopify/orders/create
   * Receives order creation webhook from Shopify
   */
  app.post("/orders/create", async (request, reply) => {
    const signature = request.headers["x-shopify-hmac-sha256"] as string;
    const shopifyOrderId = request.headers["x-shopify-order-id"] as string;
    const rawBody = request.body as string;

    // 1. Verify signature (skip in development if needed)
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      if (!verifyShopifyWebhook(rawBody, signature, webhookSecret)) {
        return reply.status(401).send({ error: "Invalid signature" });
      }
    }

    // 2. Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ error: "Invalid JSON" });
    }

    const orderId = (payload.id as number)?.toString();
    const orderName = payload.name as string;

    app.log.info({ orderId, orderName }, "Shopify order webhook received");

    // 3. Enqueue for processing (fast response to Shopify)
    const job = await enqueueShopifyOrderCreate({
      shopifyOrderId: orderId,
      payload,
      receivedAt: new Date().toISOString(),
      idempotencyKey: `shopify-order-${orderId}`,
    });

    app.log.info({ jobId: job.id, orderId }, "Shopify order enqueued");

    // 4. Return 200 immediately (Shopify expects fast response)
    return reply.status(200).send({
      success: true,
      jobId: job.id,
      message: `Order ${orderName} queued for processing`,
    });
  });

  /**
   * POST /webhooks/shopify/orders/updated
   */
  app.post("/orders/updated", async (request, reply) => {
    // Similar pattern - enqueue and return fast
    return reply.status(200).send({ success: true });
  });

  /**
   * POST /webhooks/shopify/orders/cancelled
   */
  app.post("/orders/cancelled", async (request, reply) => {
    // Similar pattern
    return reply.status(200).send({ success: true });
  });
};
