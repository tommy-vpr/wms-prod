/**
 * Inventory Planner Sync Card
 * Shows sync status and button to trigger sync
 * UPDATED: Uses SSE for real-time updates
 *
 * Save to: apps/web/src/components/inventory/InventoryPlannerSyncCard.tsx
 */

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useInventoryStream } from "@/hooks/useInventoryStream";

interface SyncStatus {
  configured: boolean;
  stats: {
    locationId: string;
    locationName: string;
    inventoryCount: number;
    totalQuantity: number;
  } | null;
  lastSync: {
    at: string;
    by: string;
    result: {
      updated?: number;
      unchanged?: number;
      skipped?: number;
      unassignedCount?: number;
      errorCount?: number;
    };
  } | null;
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  };
  syncInProgress: boolean;
}

interface SyncResult {
  updated: number;
  unchanged: number;
  skipped: number;
  unassignedCount: number;
  duration: number;
}

export function InventoryPlannerSyncCard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<SyncStatus>("/inventory-planner/status");
      setStatus(data);
      // Only set syncing from status on initial load
      if (loading) {
        setSyncing(data.syncInProgress);
      }
    } catch (err: any) {
      console.error("Failed to fetch IP status:", err);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // Use SSE for real-time updates
  useInventoryStream({
    onSyncStarted: () => {
      setSyncing(true);
      setLastResult(null);
      setError("");
    },
    onSyncCompleted: (result) => {
      setSyncing(false);
      setLastResult(result);
      fetchStatus(); // Refresh status
    },
    onSyncFailed: ({ error }) => {
      setSyncing(false);
      setError(error);
      fetchStatus();
    },
  });

  // Initial fetch only
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Trigger sync
  const handleSync = async () => {
    setError("");
    setLastResult(null);

    try {
      await apiClient.post<{ success: boolean; jobId: string }>(
        "/inventory-planner/sync",
      );
      // SSE will handle the rest
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-border rounded-lg p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-48 mb-4" />
        <div className="h-4 bg-gray-200 rounded w-32" />
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <div className="flex items-center gap-2 text-yellow-800">
          <AlertCircle className="w-5 h-5" />
          <span className="font-medium">Inventory Planner not configured</span>
        </div>
        <p className="text-sm text-yellow-700 mt-2">
          Set INVENTORY_PLANNER_API, INVENTORY_PLANNER_KEY, and
          INVENTORY_PLANNER_ACCOUNT environment variables.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg">Inventory Planner Sync</h3>
          <p className="text-sm text-gray-500">
            Sync quantities from Inventory Planner
          </p>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className={`cursor-pointer px-4 py-2 rounded-lg flex items-center gap-2 ${
            syncing
              ? "bg-gray-100 text-gray-500 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 flex items-center gap-2">
          <XCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Syncing State */}
      {syncing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
            <span className="font-medium text-blue-800">
              Sync in progress...
            </span>
          </div>
        </div>
      )}

      {/* Sync Result */}
      {lastResult && !syncing && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="font-medium text-green-800">
              Sync completed in {(lastResult.duration / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-blue-600 font-semibold">
                {lastResult.updated}
              </div>
              <div className="text-gray-500">Updated</div>
            </div>
            <div>
              <div className="text-gray-600 font-semibold">
                {lastResult.unchanged}
              </div>
              <div className="text-gray-500">Unchanged</div>
            </div>
            <div>
              <div className="text-yellow-600 font-semibold">
                {lastResult.skipped}
              </div>
              <div className="text-gray-500">Skipped</div>
            </div>
            {lastResult.unassignedCount > 0 && (
              <div>
                <div className="text-orange-600 font-semibold">
                  {lastResult.unassignedCount}
                </div>
                <div className="text-gray-500">Unassigned</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Last Sync Info */}
      {status.lastSync && !lastResult && (
        <div className="border-t border-border pt-4 mt-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Clock className="w-4 h-4" />
            Last sync: {new Date(status.lastSync.at).toLocaleString()} by{" "}
            {status.lastSync.by}
          </div>
          {status.lastSync.result && (
            <div className="text-xs text-gray-500">
              Updated: {status.lastSync.result.updated ?? 0} | Unchanged:{" "}
              {status.lastSync.result.unchanged ?? 0} | Skipped:{" "}
              {status.lastSync.result.skipped ?? 0}
              {(status.lastSync.result.unassignedCount ?? 0) > 0 && (
                <span className="text-yellow-600 ml-2">
                  | ⚠️ {status.lastSync.result.unassignedCount} need location
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Unassigned Warning */}
      {((lastResult && lastResult.unassignedCount > 0) ||
        (status.lastSync?.result?.unassignedCount ?? 0) > 0) && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-800 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>
              <strong>
                {lastResult?.unassignedCount ??
                  status.lastSync?.result?.unassignedCount}
              </strong>{" "}
              SKUs need location assignment before quantities can sync.
            </span>
          </div>
          <p className="text-xs text-yellow-700 mt-1">
            Import locations from CSV to assign inventory locations.
          </p>
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-xs text-gray-400">
        Note: Only updates existing inventory. Import locations first for new
        SKUs.
      </div>
    </div>
  );
}
