/**
 * Pack Queue Page
 * Shows orders ready for packing (PICKED) and in-progress (PACKING).
 * Includes bin barcode scan entry point for bin-based packing workflow.
 * Mobile-first design optimized for Zebra TC22 warehouse scanners.
 *
 * Save to: apps/web/src/pages/pack/index.tsx
 *
 * Route: /pack
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Package,
  Search,
  RefreshCw,
  ScanBarcode,
  AlertCircle,
  Loader2,
  Clock,
  ArrowRight,
  CheckCircle2,
  Inbox,
  BoxIcon,
  XCircle,
  Camera,
  Scale,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";

// ============================================================================
// Types
// ============================================================================

interface OrderItem {
  id: string;
  sku: string;
  quantity: number;
  quantityAllocated: number;
  quantityPicked: number;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  priority: string;
  totalAmount?: number;
  createdAt: string;
  lineItems?: OrderItem[];
}

interface BinLookupResult {
  orderId: string;
  orderNumber: string;
  order: {
    id: string;
    customerName: string;
    priority: string;
  };
  bin: {
    id: string;
    binNumber: string;
    barcode: string;
    status: string;
    items: Array<{
      id: string;
      sku: string;
      quantity: number;
      verifiedQty: number;
    }>;
  };
}

const PRIORITY_ORDER: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  NORMAL: "bg-gray-100 text-gray-600",
  LOW: "bg-gray-50 text-gray-500",
};

type QueueFilter = "all" | "ready" | "in_progress" | "packed";

// ============================================================================
// Main Component
// ============================================================================

export function PackPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState({ ready: 0, inProgress: 0, packed: 0 });
  const [refreshing, setRefreshing] = useState(false);

  // Bin scan state
  const [binScanMode, setBinScanMode] = useState(false);
  const [binBarcode, setBinBarcode] = useState("");
  const [binLooking, setBinLooking] = useState(false);
  const [binError, setBinError] = useState<string | null>(null);
  const binInputRef = useRef<HTMLInputElement>(null);

  // ── Data Fetching ─────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("take", "100");

      if (filter === "ready") {
        params.set("status", "PICKED");
      } else if (filter === "in_progress") {
        params.set("status", "PACKING");
      } else if (filter === "packed") {
        params.set("status", "PACKED");
      } else {
        params.set("status", "PICKED,PACKING,PACKED");
      }

      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      const data = await apiClient.get<{ orders: Order[]; total: number }>(
        `/orders?${params}`,
      );

      const sorted = (data.orders || []).sort((a, b) => {
        // PACKING first, then PICKED, then PACKED
        const statusOrder: Record<string, number> = {
          PACKING: 0,
          PICKED: 1,
          PACKED: 2,
        };
        const sa = statusOrder[a.status] ?? 1;
        const sb = statusOrder[b.status] ?? 1;
        if (sa !== sb) return sa - sb;

        // Then by priority
        const pa = PRIORITY_ORDER[a.priority] ?? 2;
        const pb = PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;

        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });

      setOrders(sorted);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiClient.get<{ counts: Record<string, number> }>(
        "/orders/counts",
      );
      setStats({
        ready: data.counts?.PICKED ?? 0,
        inProgress: data.counts?.PACKING ?? 0,
        packed: data.counts?.PACKED ?? 0,
      });
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    fetchStats();
  }, [fetchQueue, fetchStats]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchQueue();
      fetchStats();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchQueue, fetchStats]);

  // Focus bin input when mode activates
  useEffect(() => {
    if (binScanMode && binInputRef.current) {
      binInputRef.current.focus();
    }
  }, [binScanMode]);

  // ── Bin Lookup ────────────────────────────────────────────────────────
  const handleBinLookup = async (barcode: string) => {
    if (!barcode.trim()) return;
    setBinLooking(true);
    setBinError(null);

    try {
      const result = await apiClient.get<BinLookupResult>(
        `/fulfillment/bin/${encodeURIComponent(barcode.trim())}`,
      );
      // Navigate to fulfillment detail with bin mode
      navigate(`/fulfillment/${result.orderId}?fromBin=true`);
    } catch (err: any) {
      setBinError(err.message || "Bin not found");
    } finally {
      setBinLooking(false);
    }
  };

  const handleBinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleBinLookup(binBarcode);
  };

  // ── Barcode Scanner ───────────────────────────────────────────────────
  useBarcodeScanner({
    onScan: async (barcode) => {
      // First try bin lookup (bin barcodes start with BIN-)
      if (barcode.startsWith("BIN-")) {
        handleBinLookup(barcode);
        return;
      }

      // Try order number match
      const match = orders.find(
        (o) => o.orderNumber === barcode || o.orderNumber === `#${barcode}`,
      );
      if (match) {
        navigate(`/fulfillment/${match.id}`);
        return;
      }

      // If not found, try bin lookup anyway (might be a custom bin barcode)
      handleBinLookup(barcode);
    },
    enabled: !binScanMode, // Disable global scanner when bin input is focused
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleRefresh = () => {
    setRefreshing(true);
    fetchQueue();
    fetchStats();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    fetchQueue();
  };

  const handleStartPacking = (orderId: string) => {
    navigate(`/fulfillment/${orderId}`);
  };

  const getItemCount = (order: Order) => {
    if (!order.lineItems) return 0;
    return order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "PICKED":
        return {
          label: "Ready to Pack",
          color: "bg-cyan-100 text-cyan-700",
          icon: CheckCircle2,
        };
      case "PACKING":
        return {
          label: "Packing",
          color: "bg-purple-100 text-purple-700",
          icon: BoxIcon,
        };
      case "PACKED":
        return {
          label: "Packed",
          color: "bg-indigo-100 text-indigo-700",
          icon: Package,
        };
      default:
        return {
          label: status,
          color: "bg-gray-100 text-gray-700",
          icon: Package,
        };
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Package className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">Pack Queue</h1>
            <p className="text-gray-500 text-xs lg:text-sm">
              {stats.ready} ready · {stats.inProgress} packing · {stats.packed}{" "}
              packed
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="cursor-pointer p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg transition"
          title="Refresh"
        >
          <RefreshCw
            className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* ── Bin Scan Card ──────────────────────────────────────────────────── */}
      <div className="mb-4 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg overflow-hidden">
        <button
          onClick={() => {
            setBinScanMode(!binScanMode);
            setBinError(null);
          }}
          className="cursor-pointer w-full p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Inbox className="w-5 h-5 text-purple-600" />
            <div className="text-left">
              <div className="font-medium text-gray-900 text-sm">
                Scan Bin Barcode
              </div>
              <div className="text-xs text-gray-500">
                Scan or enter a bin barcode to start packing
              </div>
            </div>
          </div>
          <ScanBarcode
            className={`w-5 h-5 transition ${binScanMode ? "text-purple-600" : "text-gray-400"}`}
          />
        </button>

        {binScanMode && (
          <div className="px-4 pb-4">
            <form onSubmit={handleBinSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={binInputRef}
                  type="text"
                  value={binBarcode}
                  onChange={(e) => setBinBarcode(e.target.value)}
                  placeholder="BIN-000001 or scan…"
                  className="w-full px-3 py-2.5 border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-400 focus:outline-none bg-white text-sm font-mono"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={binLooking || !binBarcode.trim()}
                className="cursor-pointer px-4 py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition flex items-center gap-2 text-sm"
              >
                {binLooking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                Go
              </button>
            </form>
            {binError && (
              <div className="mt-2 flex items-center gap-2 text-red-600 text-xs">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {binError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Stats Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <button
          onClick={() => setFilter(filter === "ready" ? "all" : "ready")}
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "ready"
              ? "bg-cyan-50 border-cyan-200 ring-2 ring-cyan-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-500" />
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Ready
            </span>
          </div>
          <span className="text-xl font-bold">{stats.ready}</span>
        </button>

        <button
          onClick={() =>
            setFilter(filter === "in_progress" ? "all" : "in_progress")
          }
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "in_progress"
              ? "bg-purple-50 border-purple-200 ring-2 ring-purple-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <BoxIcon className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Packing
            </span>
          </div>
          <span className="text-xl font-bold">{stats.inProgress}</span>
        </button>

        <button
          onClick={() => setFilter(filter === "packed" ? "all" : "packed")}
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "packed"
              ? "bg-indigo-50 border-indigo-200 ring-2 ring-indigo-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Package className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Packed
            </span>
          </div>
          <span className="text-xl font-bold">{stats.packed}</span>
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search order # or customer…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white text-sm"
          />
        </div>
      </form>

      {/* ── Scanner Hint ───────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2 text-xs text-gray-400 px-1">
        <ScanBarcode className="w-3.5 h-3.5" />
        <span>
          Scan a bin barcode (BIN-*) or order barcode to start packing
        </span>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── Order Queue ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse"
            >
              <div className="flex justify-between mb-3">
                <div className="h-5 bg-gray-200 rounded w-24" />
                <div className="h-5 bg-gray-200 rounded w-20" />
              </div>
              <div className="h-4 bg-gray-100 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 font-medium">No orders in pack queue</p>
          <p className="text-gray-400 text-sm mt-1">
            {filter !== "all"
              ? "Try clearing the filter"
              : "Picked orders will appear here"}
          </p>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              className="cursor-pointer mt-4 text-blue-600 text-sm hover:underline"
            >
              Show all orders
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const statusConfig = getStatusConfig(order.status);
            const StatusIcon = statusConfig.icon;
            const isUrgent =
              order.priority === "URGENT" || order.priority === "HIGH";
            const isPacked = order.status === "PACKED";

            return (
              <button
                key={order.id}
                onClick={() => handleStartPacking(order.id)}
                className={`cursor-pointer w-full text-left bg-white border rounded-lg p-4 hover:shadow-md transition-all active:scale-[0.99] ${
                  isUrgent
                    ? "border-l-4 border-l-red-400 border-gray-200"
                    : isPacked
                      ? "border-gray-200 opacity-75"
                      : "border-gray-200"
                }`}
              >
                {/* Top row: order number + status */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {order.orderNumber}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}
                    >
                      <StatusIcon className="w-3 h-3" />
                      {statusConfig.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isUrgent && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_STYLES[order.priority]}`}
                      >
                        {order.priority}
                      </span>
                    )}
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                </div>

                {/* Customer & items */}
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-1">
                  <span className="truncate">{order.customerName}</span>
                  <span className="flex-shrink-0 text-gray-400">·</span>
                  <span className="flex-shrink-0">
                    {getItemCount(order)} item
                    {getItemCount(order) !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Time */}
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  {timeAgo(order.createdAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PackPage;
