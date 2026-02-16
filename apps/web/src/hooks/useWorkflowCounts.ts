/**
 * useWorkflowCounts
 *
 * Polls GET /workflow-counts every 30s for sidebar badge numbers.
 * Also listens to SSE fulfillment events — when any order lifecycle
 * event fires, immediately re-fetches counts for instant feedback.
 *
 * Save to: apps/web/src/hooks/useWorkflowCounts.ts
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiClient } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowCounts {
  fulfillment: number; // PENDING/CONFIRMED — need allocation
  pick: number; // ALLOCATED/READY_TO_PICK/PICKING
  pack: number; // PICKED/PACKING
  ship: number; // PACKED — need label
  orders: number; // All active orders
}

const EMPTY_COUNTS: WorkflowCounts = {
  fulfillment: 0,
  pick: 0,
  pack: 0,
  ship: 0,
  orders: 0,
};

// Events that should trigger an immediate re-fetch
const NUDGE_EVENTS = [
  "order:created",
  "order:allocated",
  "order:processing",
  "order:picked",
  "order:packed",
  "order:shipped",
  "order:completed",
  "picklist:generated",
  "picklist:completed",
  "packing:completed",
  "shipping:label_created",
];

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useWorkflowCounts(
  /** Poll interval in ms. Default 30000 (30s). Set 0 to disable polling. */
  pollInterval = 30_000,
): WorkflowCounts {
  const [counts, setCounts] = useState<WorkflowCounts>(EMPTY_COUNTS);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);

  // ─── Fetch counts ──────────────────────────────────────────────────

  const fetchCounts = useCallback(async () => {
    try {
      const data = await apiClient.get<WorkflowCounts>("/workflow-counts");
      if (mountedRef.current) {
        setCounts(data);
      }
    } catch {
      // Silent fail — stale counts are fine, next poll will catch up
    }
  }, []);

  // ─── Polling ───────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    fetchCounts();

    // Set up interval
    if (pollInterval > 0) {
      const interval = setInterval(fetchCounts, pollInterval);
      return () => {
        mountedRef.current = false;
        clearInterval(interval);
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchCounts, pollInterval]);

  // ─── SSE nudge (instant re-fetch on fulfillment events) ───────────

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL || "";
    let url: string;
    try {
      url = new URL("/events", base || window.location.origin).toString();
    } catch {
      return; // Invalid URL, skip SSE
    }

    const es = new EventSource(url);
    eventSourceRef.current = es;

    const handler = () => {
      // Debounce: wait 300ms so rapid-fire events only trigger one fetch
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(fetchCounts, 300);
    };

    for (const eventType of NUDGE_EVENTS) {
      es.addEventListener(eventType, handler);
    }

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };

    return () => {
      for (const eventType of NUDGE_EVENTS) {
        es.removeEventListener(eventType, handler);
      }
      es.close();
      eventSourceRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fetchCounts]);

  return counts;
}
