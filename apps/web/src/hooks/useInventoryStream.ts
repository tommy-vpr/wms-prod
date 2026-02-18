import { useState, useEffect, useCallback, useRef } from "react";

interface InventoryEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface SyncResult {
  updated: number;
  unchanged: number;
  skipped: number;
  unassignedCount: number;
  duration: number;
}

interface UseInventoryStreamOptions {
  onSyncStarted?: (payload: { userId: string }) => void;
  onSyncCompleted?: (payload: SyncResult) => void;
  onSyncFailed?: (payload: { error: string }) => void;
  onInventoryUpdated?: (payload: {
    sku: string;
    quantityBefore: number;
    quantityAfter: number;
  }) => void;
  enabled?: boolean;
}

export function useInventoryStream(options: UseInventoryStreamOptions = {}) {
  const {
    onSyncStarted,
    onSyncCompleted,
    onSyncFailed,
    onInventoryUpdated,
    enabled = true,
  } = options;

  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const baseUrl = import.meta.env.VITE_API_URL || "";
    const url = `${baseUrl}/events`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
      reconnectAttempts.current = 0;
    });

    es.addEventListener("inventory:sync_started", (e: MessageEvent) => {
      const event = JSON.parse(e.data) as InventoryEvent;
      setSyncing(true);
      onSyncStarted?.(event.payload as any);
    });

    es.addEventListener("inventory:sync_completed", (e: MessageEvent) => {
      const event = JSON.parse(e.data) as InventoryEvent;
      setSyncing(false);
      setLastSync(new Date());
      onSyncCompleted?.(event.payload as any);
    });

    es.addEventListener("inventory:sync_failed", (e: MessageEvent) => {
      const event = JSON.parse(e.data) as InventoryEvent;
      setSyncing(false);
      onSyncFailed?.(event.payload as any);
    });

    es.addEventListener("inventory:updated", (e: MessageEvent) => {
      const event = JSON.parse(e.data) as InventoryEvent;
      onInventoryUpdated?.(event.payload as any);
    });

    es.onerror = () => {
      setConnected(false);
      eventSourceRef.current?.close();

      // Auto-reconnect with exponential backoff
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttempts.current),
        30000,
      );
      reconnectAttempts.current++;

      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    return es;
  }, [onSyncStarted, onSyncCompleted, onSyncFailed, onInventoryUpdated]);

  useEffect(() => {
    if (!enabled) return;

    connect();

    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, connect]);

  return { connected, syncing, lastSync };
}
