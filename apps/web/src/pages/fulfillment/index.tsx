/**
 * Fulfillment List Page
 * Shows orders grouped by fulfillment stage with actions to start/continue.
 *
 * Save to: apps/web/src/pages/fulfillment/index.tsx
 *
 * Route: /fulfillment
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Package,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowRight,
  Clock,
  CheckCircle2,
  Truck,
  AlertCircle,
  ScanBarcode,
  BoxIcon,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { TableRowSkeleton } from "@/components/ui/loading";

// ============================================================================
// Types
// ============================================================================

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  priority: string;
  itemCount?: number;
  totalAmount?: number;
  trackingNumber: string | null;
  shippedAt: string | null;
  createdAt: string;
  //   items?: Array<{ id: string; quantity: number }>;
  lineItems?: Array<{ id: string; quantity: number }>;
}

const PAGE_SIZE = 50;

// Fulfillment-relevant statuses in pipeline order
const FULFILLMENT_STATUSES = [
  "ALLOCATED",
  "PICKING",
  "PICKED",
  "PACKING",
  "PACKED",
  "SHIPPED",
] as const;

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof Package }
> = {
  PENDING: {
    label: "Pending",
    color: "bg-gray-100 text-gray-700",
    icon: Clock,
  },
  CONFIRMED: {
    label: "Confirmed",
    color: "bg-gray-100 text-gray-700",
    icon: Clock,
  },
  ALLOCATED: {
    label: "Allocated",
    color: "bg-blue-100 text-blue-700",
    icon: Package,
  },
  PICKING: {
    label: "Picking",
    color: "bg-amber-100 text-amber-700",
    icon: ScanBarcode,
  },
  PICKED: {
    label: "Picked",
    color: "bg-cyan-100 text-cyan-700",
    icon: CheckCircle2,
  },
  PACKING: {
    label: "Packing",
    color: "bg-purple-100 text-purple-700",
    icon: BoxIcon,
  },
  PACKED: {
    label: "Packed",
    color: "bg-indigo-100 text-indigo-700",
    icon: Package,
  },
  SHIPPED: {
    label: "Shipped",
    color: "bg-green-100 text-green-700",
    icon: Truck,
  },
};

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700",
  HIGH: "bg-orange-100 text-orange-700",
  NORMAL: "bg-gray-100 text-gray-600",
  LOW: "bg-gray-50 text-gray-500",
};

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
    >
      <config.icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.NORMAL;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}
    >
      {priority}
    </span>
  );
}

// ============================================================================
// Step Progress Mini Bar
// ============================================================================

function MiniProgress({ status }: { status: string }) {
  const steps = FULFILLMENT_STATUSES;
  const currentIndex = steps.indexOf(status as any);

  return (
    <div className="flex gap-0.5 w-24">
      {steps.map((step, i) => (
        <div
          key={step}
          className={`h-1.5 flex-1 rounded-full ${
            i < currentIndex
              ? "bg-green-500"
              : i === currentIndex
                ? "bg-blue-500"
                : "bg-gray-200"
          }`}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function FulfillmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const statusFilter = searchParams.get("status") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String((page - 1) * PAGE_SIZE));
      params.set("take", String(PAGE_SIZE));

      // If no status filter, show all fulfillment-relevant statuses
      if (statusFilter) {
        params.set("status", statusFilter);
      } else {
        params.set("status", FULFILLMENT_STATUSES.join(","));
      }

      if (searchQuery) params.set("q", searchQuery);

      const data = await apiClient.get<{ orders: Order[]; total: number }>(
        `/orders?${params}`,
      );

      setOrders(data.orders || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchQuery]);

  const fetchCounts = useCallback(async () => {
    try {
      // Fetch counts per status for the filter tabs
      // Adjust endpoint to match your API
      const data = await apiClient.get<{
        counts: Record<string, number>;
      }>("/orders/counts");
      setCounts(data.counts || {});
    } catch {
      // Non-critical, ignore
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchCounts();
  }, [fetchOrders, fetchCounts]);

  console.log(orders);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (searchQuery) {
      params.set("q", searchQuery);
    } else {
      params.delete("q");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  const handleStatusFilter = (status: string) => {
    const params = new URLSearchParams(searchParams);
    if (status) {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    params.set("page", "1");
    setSearchParams(params);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Package className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold">Fulfillment</h1>
            <p className="text-gray-500 text-sm">Pick, pack, and ship orders</p>
          </div>
        </div>

        <button
          onClick={() => {
            fetchOrders();
            fetchCounts();
          }}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        <FilterTab
          label="All"
          count={Object.values(counts).reduce((a, b) => a + b, 0)}
          active={!statusFilter}
          onClick={() => handleStatusFilter("")}
        />
        {FULFILLMENT_STATUSES.map((status) => {
          const config = STATUS_CONFIG[status];
          return (
            <FilterTab
              key={status}
              label={config?.label || status}
              count={counts[status] || 0}
              active={statusFilter === status}
              onClick={() => handleStatusFilter(status)}
            />
          );
        })}
      </div>

      {/* Search */}
      <div className="bg-white border border-border rounded-lg p-4 mb-6">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by order number, customer name..."
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-white border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Order
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Customer
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                Items
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Status
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Progress
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Priority
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Created
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={8} />
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-gray-500"
                >
                  <Package className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No orders found</p>
                  <p className="text-sm mt-1">
                    {statusFilter
                      ? "Try a different status filter"
                      : "Orders will appear here when allocated"}
                  </p>
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/fulfillment/${order.id}`}
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {order.customerName}
                  </td>
                  <td className="px-4 py-3 text-center text-sm">
                    {order.itemCount ??
                      order.lineItems?.reduce((s, i) => s + i.quantity, 0) ??
                      "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3">
                    <MiniProgress status={order.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={order.priority} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/fulfillment/${order.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition"
                    >
                      {order.status === "SHIPPED" ? "View" : "Fulfill"}
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1} to{" "}
            {Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="cursor-pointer p-2 border border-border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-4 py-2 text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="cursor-pointer p-2 border border-border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Filter Tab
// ============================================================================

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
        active
          ? "bg-blue-100 text-blue-700 border border-blue-200"
          : "bg-white text-gray-600 border border-border hover:bg-gray-50"
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full ${
            active ? "bg-blue-200 text-blue-800" : "bg-gray-100 text-gray-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export { FulfillmentListPage };
