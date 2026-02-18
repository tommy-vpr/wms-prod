/**
 * @wms/pubsub - Redis Pub/Sub wrapper for fulfillment events
 *
 * Thin layer over ioredis pub/sub. Publish from domain services,
 * subscribe from SSE plugin. Two separate Redis connections required
 * (ioredis requirement: subscriber connection can't do other commands).
 */

import { Redis } from "ioredis";

// =============================================================================
// Channels
// =============================================================================

export const CHANNELS = {
  FULFILLMENT: "fulfillment",
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

// =============================================================================
// Event Types
// =============================================================================

export const EVENT_TYPES = {
  // Order lifecycle
  ORDER_CREATED: "order:created",
  ORDER_ALLOCATED: "order:allocated",
  ORDER_PROCESSING: "order:processing",
  ORDER_PICKED: "order:picked",
  ORDER_PACKED: "order:packed",
  ORDER_SHIPPED: "order:shipped",
  ORDER_COMPLETED: "order:completed",
  // Picking
  PICKLIST_GENERATED: "picklist:generated",
  PICKLIST_ITEM_PICKED: "picklist:item_picked",
  PICKLIST_COMPLETED: "picklist:completed",
  // Packing
  PACKING_STARTED: "packing:started",
  PACKING_ITEM_VERIFIED: "packing:item_verified",
  PACKING_COMPLETED: "packing:completed",
  PACKING_IMAGE_UPLOADED: "packing:image_uploaded",
  PACKING_IMAGE_DELETED: "packing:image_deleted",
  // Shipping
  SHIPPING_LABEL_CREATED: "shipping:label_created",
  // Inventory
  INVENTORY_UPDATED: "inventory:updated",
  INVENTORY_SYNC_STARTED: "inventory:sync_started",
  INVENTORY_SYNC_COMPLETED: "inventory:sync_completed",
  INVENTORY_SYNC_FAILED: "inventory:sync_failed",
  // Cycle Count
  CYCLE_COUNT_STARTED: "cycle_count:started",
  CYCLE_COUNT_SUBMITTED: "cycle_count:submitted",
  CYCLE_COUNT_APPROVED: "cycle_count:approved",
  CYCLE_COUNT_REJECTED: "cycle_count:rejected",
  // Pick Bin lifecycle
  PICKBIN_CREATED: "pickbin:created",
  PICKBIN_LABEL_PRINTED: "pickbin:label_printed",
  PICKBIN_STAGED: "pickbin:staged",
  PICKBIN_SCANNING: "pickbin:scanning",
  PICKBIN_ITEM_VERIFIED: "pickbin:item_verified",
  PICKBIN_COMPLETED: "pickbin:completed",

  // Pack Station notifications
  PACKSTATION_BIN_READY: "packstation:bin_ready",

  // Short pick
  SHORT_PICK_DETECTED: "short_pick:detected",
  SHORT_PICK_RESOLVED: "short_pick:resolved",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// =============================================================================
// Event Envelope
// =============================================================================

export interface FulfillmentEvent {
  id: string;
  type: EventType;
  orderId?: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  userId?: string;
  timestamp: string; // ISO 8601
}

// =============================================================================
// Connection Management
// =============================================================================

let pubClient: Redis | null = null;
let subClient: Redis | null = null;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("[pubsub] REDIS_URL not set");
  return url;
}

function createConnection(label: string): Redis {
  const connection = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  connection.on("connect", () => {
    console.log(`[pubsub] ${label} connected`);
  });

  connection.on("error", (err) => {
    console.error(`[pubsub] ${label} error:`, err.message);
  });

  return connection;
}

/**
 * Get the publisher connection (lazy-initialized)
 */
export function getPublisher(): Redis {
  if (!pubClient) {
    pubClient = createConnection("publisher");
  }
  return pubClient;
}

/**
 * Get the subscriber connection (lazy-initialized)
 * Separate connection required — ioredis subscriber can't do other commands
 */
export function getSubscriber(): Redis {
  if (!subClient) {
    subClient = createConnection("subscriber");
  }
  return subClient;
}

// =============================================================================
// Publish / Subscribe
// =============================================================================

/**
 * Publish a fulfillment event to Redis
 */
export async function publish(event: FulfillmentEvent): Promise<void> {
  const pub = getPublisher();
  if (pub.status !== "ready") {
    await pub.connect();
  }
  const message = JSON.stringify(event);
  await pub.publish(CHANNELS.FULFILLMENT, message);
}

/**
 * Subscribe to fulfillment events
 * Returns an unsubscribe function
 */
export async function subscribe(
  handler: (event: FulfillmentEvent) => void,
): Promise<() => Promise<void>> {
  const sub = getSubscriber();
  if (sub.status !== "ready") {
    await sub.connect();
  }

  sub.on("message", (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message) as FulfillmentEvent;
      handler(event);
    } catch (err) {
      console.error("[pubsub] Failed to parse event:", err);
    }
  });

  await sub.subscribe(CHANNELS.FULFILLMENT);
  console.log(`[pubsub] Subscribed to ${CHANNELS.FULFILLMENT}`);

  // Return unsubscribe function
  return async () => {
    await sub.unsubscribe(CHANNELS.FULFILLMENT);
    console.log(`[pubsub] Unsubscribed from ${CHANNELS.FULFILLMENT}`);
  };
}

// =============================================================================
// Cleanup
// =============================================================================

export async function closePubSub(): Promise<void> {
  if (pubClient) {
    await pubClient.quit();
    pubClient = null;
  }
  if (subClient) {
    await subClient.quit();
    subClient = null;
  }
  console.log("[pubsub] Connections closed");
}
