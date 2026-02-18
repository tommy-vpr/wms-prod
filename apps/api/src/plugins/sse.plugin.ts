/**
 * SSE Plugin for Fastify
 * Subscribes to Redis pub/sub and streams fulfillment events to browsers.
 *
 * Save to: apps/api/src/plugins/sse.plugin.ts
 *
 * Register in app.ts:
 *   import { ssePlugin } from "./plugins/sse.plugin.js";
 *   await app.register(ssePlugin);
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { subscribe, closePubSub, type FulfillmentEvent } from "@wms/pubsub";

// Track connected SSE clients
interface SSEClient {
  id: string;
  reply: FastifyReply;
  orderId?: string; // Optional filter — only send events for this order
}

const clients = new Map<string, SSEClient>();
let unsubscribe: (() => Promise<void>) | null = null;
let clientCounter = 0;

/**
 * Send an SSE message to a single client
 */
function sendToClient(client: SSEClient, event: FulfillmentEvent): boolean {
  try {
    const { reply } = client;
    if (reply.raw.destroyed || reply.raw.writableEnded) {
      return false; // Client disconnected
    }

    // If client is filtering by orderId, skip non-matching events
    if (client.orderId && event.orderId && event.orderId !== client.orderId) {
      return true; // Still alive, just filtered
    }

    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`id: ${event.id}\n`);
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Broadcast event to all connected clients
 */
function broadcast(event: FulfillmentEvent): void {
  for (const [id, client] of clients) {
    const alive = sendToClient(client, event);
    if (!alive) {
      clients.delete(id);
    }
  }
}

/**
 * SSE Plugin
 */
const ssePluginImpl: FastifyPluginAsync = async (app) => {
  // Subscribe to Redis pub/sub on startup
  unsubscribe = await subscribe((event) => {
    broadcast(event);
  });

  app.log.info(`[SSE] Plugin registered, ${clients.size} clients connected`);

  /**
   * GET /events
   * Server-Sent Events stream
   *
   * Query params:
   *   ?orderId=xxx  — filter events for a specific order
   */
  app.get(
    "/events",
    async (
      request: FastifyRequest<{ Querystring: { orderId?: string } }>,
      reply: FastifyReply,
    ) => {
      const clientId = `sse-${++clientCounter}`;
      const orderId = request.query.orderId;

      // SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
        "Access-Control-Allow-Origin":
          request.headers.origin || "https://app.hq.team",
        "Access-Control-Allow-Credentials": "true",
      });

      // Send initial connection event
      reply.raw.write(
        `event: connected\ndata: ${JSON.stringify({
          clientId,
          orderId: orderId || null,
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );

      // Register client
      clients.set(clientId, {
        id: clientId,
        reply,
        orderId,
      });

      app.log.info(
        { clientId, orderId, total: clients.size },
        "[SSE] Client connected",
      );

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        if (reply.raw.destroyed || reply.raw.writableEnded) {
          clearInterval(heartbeat);
          clients.delete(clientId);
          return;
        }
        reply.raw.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      }, 30_000);

      // Cleanup on disconnect
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(clientId);
        app.log.info(
          { clientId, total: clients.size },
          "[SSE] Client disconnected",
        );
      });

      // Don't end the response — SSE keeps the connection open
      // Fastify will NOT auto-end because we're writing to raw
    },
  );

  /**
   * GET /events/clients
   * Debug endpoint — show connected SSE client count
   */
  app.get("/events/clients", async () => {
    return {
      count: clients.size,
      clients: Array.from(clients.values()).map((c) => ({
        id: c.id,
        orderId: c.orderId || null,
      })),
    };
  });

  // Cleanup on server close
  app.addHook("onClose", async () => {
    // Close all client connections
    for (const [id, client] of clients) {
      try {
        if (!client.reply.raw.destroyed) {
          client.reply.raw.end();
        }
      } catch {
        // Ignore
      }
      clients.delete(id);
    }

    // Unsubscribe from Redis
    if (unsubscribe) {
      await unsubscribe();
      unsubscribe = null;
    }

    await closePubSub();
    app.log.info("[SSE] Plugin closed");
  });
};

// Skip encapsulation so /events is available globally
// This replaces fastify-plugin (fp) — same effect, zero dependencies
(ssePluginImpl as unknown as Record<symbol, unknown>)[
  Symbol.for("skip-override")
] = true;

export const ssePlugin = ssePluginImpl;
