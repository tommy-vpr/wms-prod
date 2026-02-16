/**
 * Ship Queue Page
 * Shows orders ready for shipping (PACKED), awaiting ship, and shipped.
 * Supports order barcode scanning to jump directly to shipping flow.
 * Mobile-first design optimized for Zebra TC22 warehouse scanners.
 *
 * Save to: apps/web/src/pages/ship/index.tsx
 *
 * Route: /ship
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck,
  Search,
  RefreshCw,
  ScanBarcode,
  AlertCircle,
  Loader2,
  Clock,
  ArrowRight,
  Package,
  CheckCircle2,
  MapPin,
  Tag,
  ExternalLink,
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

interface ShippingPackage {
  id: string;
  trackingNumber: string | null;
  carrierCode: string | null;
  labelUrl: string | null;
  cost: number;
  shippedAt: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  priority: string;
  totalAmount?: number;
  trackingNumber: string | null;
  shippedAt: string | null;
  shippingAddress: any;
  createdAt: string;
  updatedAt: string;
  lineItems?: OrderItem[];
  shippingPackages?: ShippingPackage[];
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

type QueueFilter = "all" | "ready" | "shipped";

// ============================================================================
// Helpers
// ============================================================================

function parseAddress(raw: any): { city?: string; state?: string } {
  if (!raw) return {};
  try {
    const addr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      city: addr.city,
      state: addr.province_code || addr.state,
    };
  } catch {
    return {};
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getItemCount(order: Order) {
  if (!order.lineItems) return 0;
  return order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
}

// ============================================================================
// Main Component
// ============================================================================

export function ShipPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState({ ready: 0, shipped: 0 });
  const [refreshing, setRefreshing] = useState(false);

  // ── Data Fetching ─────────────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("take", "100");

      if (filter === "ready") {
        params.set("status", "PACKED");
      } else if (filter === "shipped") {
        params.set("status", "SHIPPED");
      } else {
        params.set("status", "PACKED,SHIPPED");
      }

      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      const data = await apiClient.get<{ orders: Order[]; total: number }>(
        `/orders?${params}`,
      );

      const sorted = (data.orders || []).sort((a, b) => {
        // PACKED first (needs action), then SHIPPED
        const statusOrder: Record<string, number> = {
          PACKED: 0,
          SHIPPED: 1,
        };
        const sa = statusOrder[a.status] ?? 0;
        const sb = statusOrder[b.status] ?? 0;
        if (sa !== sb) return sa - sb;

        // Then by priority
        const pa = PRIORITY_ORDER[a.priority] ?? 2;
        const pb = PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;

        // Then oldest first (FIFO)
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
        ready: data.counts?.PACKED ?? 0,
        shipped: data.counts?.SHIPPED ?? 0,
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

  useBarcodeScanner({
    onScan: async (barcode) => {
      // Try order number match
      const match = orders.find(
        (o) => o.orderNumber === barcode || o.orderNumber === `#${barcode}`,
      );
      if (match) {
        navigate(`/fulfillment/${match.id}`);
        return;
      }

      // Try tracking number match
      const trackingMatch = orders.find((o) => o.trackingNumber === barcode);
      if (trackingMatch) {
        navigate(`/fulfillment/${trackingMatch.id}`);
        return;
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

  const handleOpenOrder = (orderId: string) => {
    navigate(`/fulfillment/${orderId}`);
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "PACKED":
        return {
          label: "Ready to Ship",
          color: "bg-amber-100 text-amber-700",
          icon: Package,
        };
      case "SHIPPED":
        return {
          label: "Shipped",
          color: "bg-green-100 text-green-700",
          icon: CheckCircle2,
        };
      default:
        return {
          label: status,
          color: "bg-gray-100 text-gray-700",
          icon: Truck,
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
          <div className="p-2 bg-amber-100 rounded-lg">
            <Truck className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">Shipping</h1>
            <p className="text-xs lg:text-sm">
              {stats.ready} ready to ship · {stats.shipped} shipped
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
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setFilter(filter === "ready" ? "all" : "ready")}
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "ready"
              ? "bg-amber-50 border-amber-200 ring-2 ring-amber-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Package className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Ready to Ship
            </span>
          </div>
          <span className="text-xl font-bold">{stats.ready}</span>
        </button>

        <button
          onClick={() => setFilter(filter === "shipped" ? "all" : "shipped")}
          className={`cursor-pointer p-3 rounded-lg border text-left transition ${
            filter === "shipped"
              ? "bg-green-50 border-green-200 ring-2 ring-green-300"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Shipped
            </span>
          </div>
          <span className="text-xl font-bold">{stats.shipped}</span>
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
            placeholder="Search order #, customer, or tracking…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white text-sm"
          />
        </div>
      </form>

      {/* ── Scanner Hint ───────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2 text-xs text-gray-400 px-1">
        <ScanBarcode className="w-3.5 h-3.5" />
        <span>Scan an order barcode to jump to shipping</span>
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
          <Truck className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 font-medium">No orders in ship queue</p>
          <p className="text-gray-400 text-sm mt-1">
            {filter !== "all"
              ? "Try clearing the filter"
              : "Packed orders will appear here"}
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
            const isShipped = order.status === "SHIPPED";
            const addr = parseAddress(order.shippingAddress);

            return (
              <button
                key={order.id}
                onClick={() => handleOpenOrder(order.id)}
                className={`cursor-pointer w-full text-left bg-white border border-border rounded-lg p-4 hover:shadow-md transition-all active:scale-[0.99]`}
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

                {/* Customer, items, destination */}
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-1">
                  <span className="truncate">{order.customerName}</span>
                  <span className="flex-shrink-0 text-gray-400">·</span>
                  <span className="flex-shrink-0">
                    {getItemCount(order)} item
                    {getItemCount(order) !== 1 ? "s" : ""}
                  </span>
                  {addr.city && (
                    <>
                      <span className="flex-shrink-0 text-gray-400">·</span>
                      <span className="flex-shrink-0 flex items-center gap-1 text-gray-400">
                        <MapPin className="w-3 h-3" />
                        {addr.city}
                        {addr.state ? `, ${addr.state}` : ""}
                      </span>
                    </>
                  )}
                </div>

                {/* Tracking or time */}
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  {order.trackingNumber ? (
                    <span className="flex items-center gap-1 text-blue-500">
                      <Tag className="w-3 h-3" />
                      {order.trackingNumber}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(order.createdAt)}
                    </span>
                  )}
                  {order.shippedAt && (
                    <span className="flex items-center gap-1 text-green-500">
                      <CheckCircle2 className="w-3 h-3" />
                      Shipped {timeAgo(order.shippedAt)}
                    </span>
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

export default ShipPage;
