/**
 * Pick Queue Page
 * Shows orders ready for picking (ALLOCATED) and in-progress (PICKING).
 * Mobile-first design optimized for Zebra TC22 warehouse scanners.
 *
 * Save to: apps/web/src/pages/pick/index.tsx
 *
 * Route: /pick
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  PackageCheck,
  Search,
  RefreshCw,
  ScanBarcode,
  AlertCircle,
  Loader2,
  Clock,
  MapPin,
  ArrowRight,
  CheckCircle2,
  Filter,
  ChevronDown,
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

type QueueFilter = "all" | "ready" | "in_progress";

const PRIORITY_ORDER: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  NORMAL: "bg-gray-100 text-gray-600 border-gray-200",
  LOW: "bg-gray-50 text-gray-500 border-gray-100",
};

// ============================================================================
// Main Component
// ============================================================================

export function PickPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [stats, setStats] = useState({ ready: 0, inProgress: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Data Fetching ─────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("take", "100");

      if (filter === "ready") {
        params.set("status", "ALLOCATED");
      } else if (filter === "in_progress") {
        params.set("status", "PICKING");
      } else {
        params.set("status", "ALLOCATED,PICKING");
      }

      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      const data = await apiClient.get<{ orders: Order[]; total: number }>(
        `/orders?${params}`,
      );

      // Sort: URGENT/HIGH first, then by creation date
      const sorted = (data.orders || []).sort((a, b) => {
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
        ready: data.counts?.ALLOCATED ?? 0,
        inProgress: data.counts?.PICKING ?? 0,
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

  // ── Barcode Scanner ───────────────────────────────────────────────────
  // Scanning an order barcode navigates directly to fulfillment
  useBarcodeScanner({
    onScan: async (barcode) => {
      // Try to find by order number
      const match = orders.find(
        (o) => o.orderNumber === barcode || o.orderNumber === `#${barcode}`,
      );
      if (match) {
        navigate(`/fulfillment/${match.id}`);
        return;
      }
      // If not found in current list, search the API
      try {
        const data = await apiClient.get<{ orders: Order[] }>(
          `/orders?q=${encodeURIComponent(barcode)}&status=ALLOCATED,PICKING&take=1`,
        );
        if (data.orders?.length > 0) {
          navigate(`/fulfillment/${data.orders[0].id}`);
        }
      } catch {
        // ignore
      }
    },
    enabled: true,
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

  const handleStartPicking = (orderId: string) => {
    navigate(`/fulfillment/${orderId}`);
  };

  const getItemCount = (order: Order) => {
    if (!order.lineItems) return 0;
    return order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
  };

  const getPickProgress = (order: Order) => {
    if (!order.lineItems) return null;
    const total = order.lineItems.reduce((sum, i) => sum + i.quantity, 0);
    const picked = order.lineItems.reduce(
      (sum, i) => sum + i.quantityPicked,
      0,
    );
    if (total === 0) return null;
    return { total, picked, percent: Math.round((picked / total) * 100) };
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

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <PackageCheck className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">Pick Queue</h1>
            <p className="text-gray-500 text-xs lg:text-sm">
              {stats.ready} ready · {stats.inProgress} in progress
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

      {/* ── Stats Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => setFilter(filter === "ready" ? "all" : "ready")}
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "ready"
              ? "bg-blue-50 border-blue-200 ring-2 ring-blue-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <ScanBarcode className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Ready
            </span>
          </div>
          <span className="text-2xl font-bold">{stats.ready}</span>
        </button>

        <button
          onClick={() =>
            setFilter(filter === "in_progress" ? "all" : "in_progress")
          }
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "in_progress"
              ? "bg-amber-50 border-amber-200 ring-2 ring-amber-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Loader2 className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              In Progress
            </span>
          </div>
          <span className="text-2xl font-bold">{stats.inProgress}</span>
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
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
        <span>Scan an order barcode to jump directly to picking</span>
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
                <div className="h-5 bg-gray-200 rounded w-16" />
              </div>
              <div className="h-4 bg-gray-100 rounded w-40 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <PackageCheck className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 font-medium">No orders in pick queue</p>
          <p className="text-gray-400 text-sm mt-1">
            {filter !== "all"
              ? "Try clearing the filter"
              : "Orders will appear here once allocated"}
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
            const progress = getPickProgress(order);
            const isInProgress = order.status === "PICKING";
            const isUrgent =
              order.priority === "URGENT" || order.priority === "HIGH";

            return (
              <button
                key={order.id}
                onClick={() => handleStartPicking(order.id)}
                className={`cursor-pointer w-full text-left bg-white border rounded-lg p-4 hover:shadow-md transition-all active:scale-[0.99] ${
                  isUrgent
                    ? "border-l-4 border-l-red-400 border-gray-200"
                    : "border-gray-200"
                }`}
              >
                {/* Top row: order number, status, priority */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {order.orderNumber}
                    </span>
                    {isInProgress && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        <ScanBarcode className="w-3 h-3" />
                        Picking
                      </span>
                    )}
                    {!isInProgress && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        Ready
                      </span>
                    )}
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

                {/* Customer & item count */}
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-1">
                  <span className="truncate">{order.customerName}</span>
                  <span className="flex-shrink-0 text-gray-400">·</span>
                  <span className="flex-shrink-0">
                    {getItemCount(order)} item
                    {getItemCount(order) !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Time & progress */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {timeAgo(order.createdAt)}
                  </div>

                  {/* Pick progress bar (only for in-progress) */}
                  {isInProgress && progress && (
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all"
                          style={{ width: `${progress.percent}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-500">
                        {progress.picked}/{progress.total}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PickPage;
