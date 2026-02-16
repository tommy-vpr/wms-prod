/**
 * useFulfillmentStream
 * React hook for real-time fulfillment events via SSE
 *
 * Save to: apps/web/src/hooks/useFulfillmentStream.ts
 *
 * Usage:
 *   // All events (dashboard)
 *   const { events, connected } = useFulfillmentStream();
 *
 *   // Filtered to one order (order detail page)
 *   const { events, connected } = useFulfillmentStream({ orderId: "abc123" });
 */

import { useState, useEffect, useCallback, useRef } from "react";

// =============================================================================
// Types
// =============================================================================

export interface FulfillmentEvent {
  id: string;
  type: string;
  orderId?: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  userId?: string;
  timestamp: string;
}

interface UseFulfillmentStreamOptions {
  /** Filter events to a specific order */
  orderId?: string;
  /** SSE endpoint base URL (defaults to env var or /events) */
  baseUrl?: string;
  /** Max events to keep in state (prevents memory leaks) */
  maxEvents?: number;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Enable/disable the stream */
  enabled?: boolean;
}

interface UseFulfillmentStreamReturn {
  /** All received events (newest last) */
  events: FulfillmentEvent[];
  /** Whether SSE is connected */
  connected: boolean;
  /** Last event received */
  lastEvent: FulfillmentEvent | null;
  /** Connection error if any */
  error: string | null;
  /** Manually disconnect */
  disconnect: () => void;
  /** Manually reconnect */
  reconnect: () => void;
  /** Clear event history */
  clearEvents: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useFulfillmentStream(
  options: UseFulfillmentStreamOptions = {},
): UseFulfillmentStreamReturn {
  const {
    orderId,
    baseUrl,
    maxEvents = 500,
    autoReconnect = true,
    enabled = true,
  } = options;

  const [events, setEvents] = useState<FulfillmentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<FulfillmentEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectAttempts = useRef(0);

  const getSSEUrl = useCallback(() => {
    const base = baseUrl || import.meta.env.VITE_API_URL || "";
    const url = new URL("/events", base || window.location.origin);
    if (orderId) {
      url.searchParams.set("orderId", orderId);
    }
    return url.toString();
  }, [baseUrl, orderId]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = getSSEUrl();
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // ─── Connection opened ────────────────────────────────────────────
    es.addEventListener("connected", (e: MessageEvent) => {
      setConnected(true);
      setError(null);
      reconnectAttempts.current = 0;
      console.log("[SSE] Connected:", JSON.parse(e.data));
    });

    // ─── Fulfillment events ───────────────────────────────────────────
    // Listen to each event type from the pubsub package
    const eventTypes = [
      "order:created",
      "order:allocated",
      "order:processing",
      "order:picked",
      "order:packed",
      "order:shipped",
      "order:completed",
      "picklist:generated",
      "picklist:item_picked",
      "picklist:completed",
      "packing:started",
      "packing:item_verified",
      "packing:completed",
      "shipping:label_created",
      "inventory:updated",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as FulfillmentEvent;
          setLastEvent(event);
          setEvents((prev) => {
            const next = [...prev, event];
            // Trim to max events
            return next.length > maxEvents ? next.slice(-maxEvents) : next;
          });
        } catch (err) {
          console.error("[SSE] Failed to parse event:", err);
        }
      });
    }

    // ─── Error handling ───────────────────────────────────────────────
    es.onerror = () => {
      setConnected(false);

      if (es.readyState === EventSource.CLOSED) {
        setError("Connection closed");

        // Auto-reconnect with exponential backoff
        if (autoReconnect) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.current),
            30000,
          );
          reconnectAttempts.current++;
          console.log(
            `[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`,
          );
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      }
    };
  }, [getSSEUrl, maxEvents, autoReconnect]);

  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttempts.current = 0;
    connect();
  }, [disconnect, connect]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  // ─── Lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    events,
    connected,
    lastEvent,
    error,
    disconnect,
    reconnect,
    clearEvents,
  };
}

// =============================================================================
// Helper: Filter events by type
// =============================================================================

export function filterEventsByType(
  events: FulfillmentEvent[],
  ...types: string[]
): FulfillmentEvent[] {
  return events.filter((e) => types.includes(e.type));
}

// =============================================================================
// Helper: Get fulfillment progress from events
// =============================================================================

export interface FulfillmentProgress {
  step:
    | "pending"
    | "picking"
    | "picked"
    | "packing"
    | "packed"
    | "shipping"
    | "shipped"
    | "completed";
  percentage: number;
  pickProgress: { completed: number; total: number } | null;
  packProgress: { completed: number; total: number } | null;
  trackingNumber: string | null;
  carrier: string | null;
  labelUrl: string | null;
}

export function deriveFulfillmentProgress(
  events: FulfillmentEvent[],
): FulfillmentProgress {
  const progress: FulfillmentProgress = {
    step: "pending",
    percentage: 0,
    pickProgress: null,
    packProgress: null,
    trackingNumber: null,
    carrier: null,
    labelUrl: null,
  };

  for (const event of events) {
    switch (event.type) {
      case "order:processing":
      case "picklist:generated":
        progress.step = "picking";
        progress.percentage = 10;
        if (event.payload.totalItems) {
          progress.pickProgress = {
            completed: 0,
            total: event.payload.totalItems as number,
          };
        }
        break;

      case "picklist:item_picked":
        progress.step = "picking";
        if (event.payload.progress) {
          const [done, total] = (event.payload.progress as string)
            .split("/")
            .map(Number);
          progress.pickProgress = { completed: done, total };
          progress.percentage = 10 + Math.round((done / total) * 25);
        }
        break;

      case "picklist:completed":
      case "order:picked":
        progress.step = "picked";
        progress.percentage = 35;
        break;

      case "packing:started":
        progress.step = "packing";
        progress.percentage = 40;
        if (event.payload.totalItems) {
          progress.packProgress = {
            completed: 0,
            total: event.payload.totalItems as number,
          };
        }
        break;

      case "packing:item_verified":
        progress.step = "packing";
        if (event.payload.progress) {
          const [done, total] = (event.payload.progress as string)
            .split("/")
            .map(Number);
          progress.packProgress = { completed: done, total };
          progress.percentage = 40 + Math.round((done / total) * 25);
        }
        break;

      case "packing:completed":
      case "order:packed":
        progress.step = "packed";
        progress.percentage = 70;
        break;

      case "shipping:label_created":
        progress.step = "shipping";
        progress.percentage = 85;
        progress.trackingNumber =
          (event.payload.trackingNumber as string) ?? null;
        progress.carrier = (event.payload.carrier as string) ?? null;
        progress.labelUrl = (event.payload.labelUrl as string) ?? null;
        break;

      case "order:shipped":
        progress.step = "shipped";
        progress.percentage = 95;
        progress.trackingNumber =
          (event.payload.trackingNumber as string) ?? progress.trackingNumber;
        progress.carrier =
          (event.payload.carrier as string) ?? progress.carrier;
        break;

      case "order:completed":
        progress.step = "completed";
        progress.percentage = 100;
        break;
    }
  }

  return progress;
}
