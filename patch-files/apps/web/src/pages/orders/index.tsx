/**
 * Orders List Page
 * View, search, and manage orders
 *
 * Save to: apps/web/src/pages/orders/index.tsx
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ShoppingCart,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  RefreshCw,
  Package,
  Truck,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  PauseCircle,
  MoreHorizontal,
  Wifi,
  WifiOff,
  Bell,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { TableRowSkeleton } from "@/components/ui/loading";
import {
  useFulfillmentStream,
  type FulfillmentEvent,
} from "@/hooks/useFulfillmentStream";

// ============================================================================
// Types
// ============================================================================

interface OrderLineItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  quantityAllocated: number;
  quantityPicked: number;
  quantityShipped: number;
  unitPrice: number;
}

interface Order {
  id: string;
  orderNumber: string;
  externalId: string | null;
  source: string;
  status: OrderStatus;
  customerName: string | null;
  customerEmail: string | null;
  shippingAddress: string | null;
  lineItems: OrderLineItem[];
  createdAt: string;
  updatedAt: string;
}

type OrderStatus =
  | "PENDING"
  | "ALLOCATED"
  | "PARTIALLY_ALLOCATED"
  | "BACKORDERED"
  | "PICKING"
  | "PICKED"
  | "PACKING"
  | "PACKED"
  | "SHIPPED"
  | "CANCELLED"
  | "ON_HOLD";

interface OrderStats {
  total: number;
  pending: number;
  allocated: number;
  picking: number;
  packed: number;
  shipped: number;
  backordered: number;
}

const PAGE_SIZE = 20;

// ============================================================================
// Status Badge Component
// ============================================================================

const statusConfig: Record<
  OrderStatus,
  { label: string; color: string; icon: typeof Clock }
> = {
  PENDING: {
    label: "Pending",
    color: "bg-yellow-100 text-yellow-800",
    icon: Clock,
  },
  ALLOCATED: {
    label: "Allocated",
    color: "bg-blue-100 text-blue-800",
    icon: Package,
  },
  PARTIALLY_ALLOCATED: {
    label: "Partial",
    color: "bg-orange-100 text-orange-800",
    icon: AlertCircle,
  },
  BACKORDERED: {
    label: "Backordered",
    color: "bg-red-100 text-red-800",
    icon: PauseCircle,
  },
  PICKING: {
    label: "Picking",
    color: "bg-purple-100 text-purple-800",
    icon: Package,
  },
  PICKED: {
    label: "Picked",
    color: "bg-indigo-100 text-indigo-800",
    icon: CheckCircle,
  },
  PACKING: {
    label: "Packing",
    color: "bg-pink-100 text-pink-800",
    icon: Package,
  },
  PACKED: {
    label: "Packed",
    color: "bg-cyan-100 text-cyan-800",
    icon: CheckCircle,
  },
  SHIPPED: {
    label: "Shipped",
    color: "bg-green-100 text-green-800",
    icon: Truck,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-red-100 text-red-800",
    icon: XCircle,
  },
  ON_HOLD: {
    label: "On Hold",
    color: "bg-gray-100 text-gray-800",
    icon: AlertCircle,
  },
};

function StatusBadge({ status }: { status: OrderStatus }) {
  const config = statusConfig[status] || statusConfig.PENDING;
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stats, setStats] = useState<OrderStats | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") || "",
  );
  const [sourceFilter, setSourceFilter] = useState<string>(
    searchParams.get("source") || "",
  );

  const page = parseInt(searchParams.get("page") || "1", 10);

  // ============================================================================
  // Real-time updates via SSE
  // ============================================================================

  const { lastEvent, connected } = useFulfillmentStream();
  const [toast, setToast] = useState<{
    orderNumber: string;
    id: string;
  } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-refresh orders list when relevant events arrive
  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "order:created") {
      // Show toast notification
      const orderNumber =
        (lastEvent.payload?.orderNumber as string) || "New order";
      setToast({ orderNumber, id: lastEvent.id });
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
    }

    if (lastEvent.type === "order:backorder_resolved") {
      const orderNumber =
        (lastEvent.payload?.orderNumber as string) || "Order";
      setToast({ orderNumber: `${orderNumber} — backorder resolved ✓`, id: lastEvent.id });
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
    }

    if (lastEvent.type === "order:split") {
      const orderNumber =
        (lastEvent.payload?.originalOrderNumber as string) || "Order";
      const boNumber =
        (lastEvent.payload?.backorderOrderNumber as string) || "";
      setToast({
        orderNumber: `${orderNumber} split → ${boNumber} created`,
        id: lastEvent.id,
      });
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
    }

    // Debounce refresh for any order event
    if (
      [
        "order:created",
        "order:backordered",
        "order:backorder_resolved",
        "order:split",
      ].includes(lastEvent.type)
    ) {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        fetchOrdersSilent();
        fetchStats();
      }, 1500);
    }
  }, [lastEvent]);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, []);

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
      if (statusFilter) params.set("status", statusFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      if (searchQuery) params.set("q", searchQuery);

      const data = await apiClient.get<{ orders: Order[]; total: number }>(
        `/orders?${params}`,
      );
      setOrders(data.orders);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, sourceFilter, searchQuery]);

  // Silent refresh — same query, no loading spinner flash
  const fetchOrdersSilent = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("skip", String((page - 1) * PAGE_SIZE));
      params.set("take", String(PAGE_SIZE));
      if (statusFilter) params.set("status", statusFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      if (searchQuery) params.set("q", searchQuery);

      const data = await apiClient.get<{ orders: Order[]; total: number }>(
        `/orders?${params}`,
      );
      setOrders(data.orders);
      setTotal(data.total);
    } catch {
      // Silent fail — user can manual refresh
    }
  }, [page, statusFilter, sourceFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiClient.get<OrderStats>("/orders/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, [fetchOrders, fetchStats]);

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
    setStatusFilter(status);
  };

  const handleRefresh = () => {
    fetchOrders();
    fetchStats();
  };

  // ============================================================================
  // Pagination
  // ============================================================================

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
          <ShoppingCart className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold">Orders</h1>
            <p className="text-gray-500 text-sm">{total} total orders</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* SSE connection indicator */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
              connected
                ? "bg-green-50 text-green-600"
                : "bg-gray-100 text-gray-400"
            }`}
            title={
              connected ? "Live updates active" : "Live updates disconnected"
            }
          >
            {connected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {connected ? "Live" : "Offline"}
          </span>
          <button
            onClick={handleRefresh}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* New order toast notification */}
      {toast && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 animate-[fadeIn_0.3s_ease-out]">
          <Bell className="w-4 h-4 shrink-0" />
          <span>
            New order <span className="font-semibold">{toast.orderNumber}</span>{" "}
            received
          </span>
          <button
            onClick={() => setToast(null)}
            className="ml-auto text-blue-400 hover:text-blue-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-6">
          <StatCard
            label="Total"
            value={stats.total}
            onClick={() => handleStatusFilter("")}
            active={!statusFilter}
          />
          <StatCard
            label="Pending"
            value={stats.pending}
            color="yellow"
            onClick={() => handleStatusFilter("PENDING")}
            active={statusFilter === "PENDING"}
          />
          <StatCard
            label="Allocated"
            value={stats.allocated}
            color="blue"
            onClick={() => handleStatusFilter("ALLOCATED")}
            active={statusFilter === "ALLOCATED"}
          />
          <StatCard
            label="Backordered"
            value={stats.backordered}
            color="red"
            onClick={() => handleStatusFilter("BACKORDERED")}
            active={statusFilter === "BACKORDERED"}
          />
          <StatCard
            label="Picking"
            value={stats.picking}
            color="purple"
            onClick={() => handleStatusFilter("PICKING")}
            active={statusFilter === "PICKING"}
          />
          <StatCard
            label="Packed"
            value={stats.packed}
            color="cyan"
            onClick={() => handleStatusFilter("PACKED")}
            active={statusFilter === "PACKED"}
          />
          <StatCard
            label="Shipped"
            value={stats.shipped}
            color="green"
            onClick={() => handleStatusFilter("SHIPPED")}
            active={statusFilter === "SHIPPED"}
          />
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white border border-border rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by order #, customer name, email..."
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </form>

          {/* Source Filter */}
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              const params = new URLSearchParams(searchParams);
              if (e.target.value) {
                params.set("source", e.target.value);
              } else {
                params.delete("source");
              }
              params.set("page", "1");
              setSearchParams(params);
            }}
            className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">All Sources</option>
            <option value="SHOPIFY">Shopify</option>
            <option value="MANUAL">Manual</option>
            <option value="API">API</option>
          </select>
        </div>
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
                Order #
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Customer
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Source
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Items
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Status
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Created
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={7} />
              ))
            ) : orders.length === 0 ? (
              <tr className="border-border">
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-gray-500"
                >
                  <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No orders found</p>
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/orders/${order.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    {order.externalId && (
                      <div className="text-xs text-gray-400">
                        {order.externalId}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {order.customerName || "—"}
                    </div>
                    <div className="text-sm text-gray-500">
                      {order.customerEmail || ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600">
                      {order.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm">
                      {order.lineItems?.length || 0} items
                    </span>
                    <div className="text-xs text-gray-400">
                      {order.lineItems?.reduce(
                        (sum, li) => sum + li.quantity,
                        0,
                      ) || 0}{" "}
                      units
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/orders/${order.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Eye className="w-4 h-4" />
                      View
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
              className="p-2 border border-border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-4 py-2 text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="p-2 border border-border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
// Stat Card Component
// ============================================================================

function StatCard({
  label,
  value,
  color = "gray",
  onClick,
  active,
}: {
  label: string;
  value: number;
  color?: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`bg-white border border-border rounded-lg p-4 text-left hover:shadow-md transition-shadow ${
        active ? "ring-2 ring-blue-500" : ""
      }`}
    >
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold`}>{value}</div>
    </button>
  );
}

export { OrdersPage };

// /**
//  * Orders List Page
//  * View, search, and manage orders
//  *
//  * Save to: apps/web/src/pages/orders/index.tsx
//  */

// import { useState, useEffect, useCallback, useRef } from "react";
// import { Link, useSearchParams } from "react-router-dom";
// import {
//   ShoppingCart,
//   Search,
//   ChevronLeft,
//   ChevronRight,
//   Eye,
//   Filter,
//   RefreshCw,
//   Package,
//   Truck,
//   Clock,
//   CheckCircle,
//   AlertCircle,
//   XCircle,
//   MoreHorizontal,
//   Wifi,
//   WifiOff,
//   Bell,
// } from "lucide-react";
// import { apiClient } from "@/lib/api";
// import { TableRowSkeleton } from "@/components/ui/loading";
// import {
//   useFulfillmentStream,
//   type FulfillmentEvent,
// } from "@/hooks/useFulfillmentStream";

// // ============================================================================
// // Types
// // ============================================================================

// interface OrderLineItem {
//   id: string;
//   sku: string;
//   name: string;
//   quantity: number;
//   quantityAllocated: number;
//   quantityPicked: number;
//   quantityShipped: number;
//   unitPrice: number;
// }

// interface Order {
//   id: string;
//   orderNumber: string;
//   externalId: string | null;
//   source: string;
//   status: OrderStatus;
//   customerName: string | null;
//   customerEmail: string | null;
//   shippingAddress: string | null;
//   lineItems: OrderLineItem[];
//   createdAt: string;
//   updatedAt: string;
// }

// type OrderStatus =
//   | "PENDING"
//   | "ALLOCATED"
//   | "PARTIALLY_ALLOCATED"
//   | "PICKING"
//   | "PICKED"
//   | "PACKING"
//   | "PACKED"
//   | "SHIPPED"
//   | "CANCELLED"
//   | "ON_HOLD";

// interface OrderStats {
//   total: number;
//   pending: number;
//   allocated: number;
//   picking: number;
//   packed: number;
//   shipped: number;
// }

// const PAGE_SIZE = 20;

// // ============================================================================
// // Status Badge Component
// // ============================================================================

// const statusConfig: Record<
//   OrderStatus,
//   { label: string; color: string; icon: typeof Clock }
// > = {
//   PENDING: {
//     label: "Pending",
//     color: "bg-yellow-100 text-yellow-800",
//     icon: Clock,
//   },
//   ALLOCATED: {
//     label: "Allocated",
//     color: "bg-blue-100 text-blue-800",
//     icon: Package,
//   },
//   PARTIALLY_ALLOCATED: {
//     label: "Partial",
//     color: "bg-orange-100 text-orange-800",
//     icon: AlertCircle,
//   },
//   PICKING: {
//     label: "Picking",
//     color: "bg-purple-100 text-purple-800",
//     icon: Package,
//   },
//   PICKED: {
//     label: "Picked",
//     color: "bg-indigo-100 text-indigo-800",
//     icon: CheckCircle,
//   },
//   PACKING: {
//     label: "Packing",
//     color: "bg-pink-100 text-pink-800",
//     icon: Package,
//   },
//   PACKED: {
//     label: "Packed",
//     color: "bg-cyan-100 text-cyan-800",
//     icon: CheckCircle,
//   },
//   SHIPPED: {
//     label: "Shipped",
//     color: "bg-green-100 text-green-800",
//     icon: Truck,
//   },
//   CANCELLED: {
//     label: "Cancelled",
//     color: "bg-red-100 text-red-800",
//     icon: XCircle,
//   },
//   ON_HOLD: {
//     label: "On Hold",
//     color: "bg-gray-100 text-gray-800",
//     icon: AlertCircle,
//   },
// };

// function StatusBadge({ status }: { status: OrderStatus }) {
//   const config = statusConfig[status] || statusConfig.PENDING;
//   const Icon = config.icon;

//   return (
//     <span
//       className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
//     >
//       <Icon className="w-3 h-3" />
//       {config.label}
//     </span>
//   );
// }

// // ============================================================================
// // Main Component
// // ============================================================================

// export default function OrdersPage() {
//   const [searchParams, setSearchParams] = useSearchParams();

//   const [orders, setOrders] = useState<Order[]>([]);
//   const [total, setTotal] = useState(0);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState("");

//   const [stats, setStats] = useState<OrderStats | null>(null);
//   const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");

//   // Filters
//   const [statusFilter, setStatusFilter] = useState<string>(
//     searchParams.get("status") || "",
//   );
//   const [sourceFilter, setSourceFilter] = useState<string>(
//     searchParams.get("source") || "",
//   );

//   const page = parseInt(searchParams.get("page") || "1", 10);

//   // ============================================================================
//   // Real-time updates via SSE
//   // ============================================================================

//   const { lastEvent, connected } = useFulfillmentStream();
//   const [toast, setToast] = useState<{
//     orderNumber: string;
//     id: string;
//   } | null>(null);
//   const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
//   const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

//   // Auto-refresh orders list when new order:created events arrive
//   useEffect(() => {
//     if (!lastEvent) return;
//     if (lastEvent.type !== "order:created") return;

//     // Show toast notification
//     const orderNumber =
//       (lastEvent.payload?.orderNumber as string) || "New order";
//     setToast({ orderNumber, id: lastEvent.id });
//     if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
//     toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);

//     // Debounce refresh (in case multiple orders arrive rapidly)
//     if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
//     refreshDebounceRef.current = setTimeout(() => {
//       fetchOrdersSilent();
//       fetchStats();
//     }, 1500);
//   }, [lastEvent]);

//   // Cleanup timeouts
//   useEffect(() => {
//     return () => {
//       if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
//       if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
//     };
//   }, []);

//   // ============================================================================
//   // Data Fetching
//   // ============================================================================

//   const fetchOrders = useCallback(async () => {
//     setLoading(true);
//     setError("");

//     try {
//       const params = new URLSearchParams();
//       params.set("skip", String((page - 1) * PAGE_SIZE));
//       params.set("take", String(PAGE_SIZE));
//       if (statusFilter) params.set("status", statusFilter);
//       if (sourceFilter) params.set("source", sourceFilter);
//       if (searchQuery) params.set("q", searchQuery);

//       const data = await apiClient.get<{ orders: Order[]; total: number }>(
//         `/orders?${params}`,
//       );
//       setOrders(data.orders);
//       setTotal(data.total);
//     } catch (err: any) {
//       setError(err.message);
//     } finally {
//       setLoading(false);
//     }
//   }, [page, statusFilter, sourceFilter, searchQuery]);

//   // Silent refresh — same query, no loading spinner flash
//   const fetchOrdersSilent = useCallback(async () => {
//     try {
//       const params = new URLSearchParams();
//       params.set("skip", String((page - 1) * PAGE_SIZE));
//       params.set("take", String(PAGE_SIZE));
//       if (statusFilter) params.set("status", statusFilter);
//       if (sourceFilter) params.set("source", sourceFilter);
//       if (searchQuery) params.set("q", searchQuery);

//       const data = await apiClient.get<{ orders: Order[]; total: number }>(
//         `/orders?${params}`,
//       );
//       setOrders(data.orders);
//       setTotal(data.total);
//     } catch {
//       // Silent fail — user can manual refresh
//     }
//   }, [page, statusFilter, sourceFilter, searchQuery]);

//   const fetchStats = useCallback(async () => {
//     try {
//       const data = await apiClient.get<OrderStats>("/orders/stats");
//       setStats(data);
//     } catch (err) {
//       console.error("Failed to fetch stats:", err);
//     }
//   }, []);

//   useEffect(() => {
//     fetchOrders();
//     fetchStats();
//   }, [fetchOrders, fetchStats]);

//   // ============================================================================
//   // Handlers
//   // ============================================================================

//   const handleSearch = (e: React.FormEvent) => {
//     e.preventDefault();
//     const params = new URLSearchParams(searchParams);
//     if (searchQuery) {
//       params.set("q", searchQuery);
//     } else {
//       params.delete("q");
//     }
//     params.set("page", "1");
//     setSearchParams(params);
//   };

//   const handleStatusFilter = (status: string) => {
//     const params = new URLSearchParams(searchParams);
//     if (status) {
//       params.set("status", status);
//     } else {
//       params.delete("status");
//     }
//     params.set("page", "1");
//     setSearchParams(params);
//     setStatusFilter(status);
//   };

//   const handleRefresh = () => {
//     fetchOrders();
//     fetchStats();
//   };

//   // ============================================================================
//   // Pagination
//   // ============================================================================

//   const totalPages = Math.ceil(total / PAGE_SIZE);

//   const goToPage = (newPage: number) => {
//     const params = new URLSearchParams(searchParams);
//     params.set("page", String(newPage));
//     setSearchParams(params);
//   };

//   // ============================================================================
//   // Render
//   // ============================================================================

//   return (
//     <div className="p-6">
//       {/* Header */}
//       <div className="flex items-center justify-between mb-6">
//         <div className="flex items-center gap-3">
//           <ShoppingCart className="w-8 h-8 text-blue-500" />
//           <div>
//             <h1 className="text-2xl font-bold">Orders</h1>
//             <p className="text-gray-500 text-sm">{total} total orders</p>
//           </div>
//         </div>

//         <div className="flex items-center gap-2">
//           {/* SSE connection indicator */}
//           <span
//             className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
//               connected
//                 ? "bg-green-50 text-green-600"
//                 : "bg-gray-100 text-gray-400"
//             }`}
//             title={
//               connected ? "Live updates active" : "Live updates disconnected"
//             }
//           >
//             {connected ? (
//               <Wifi className="w-3 h-3" />
//             ) : (
//               <WifiOff className="w-3 h-3" />
//             )}
//             {connected ? "Live" : "Offline"}
//           </span>
//           <button
//             onClick={handleRefresh}
//             className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
//             title="Refresh"
//           >
//             <RefreshCw className="w-5 h-5" />
//           </button>
//         </div>
//       </div>

//       {/* New order toast notification */}
//       {toast && (
//         <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 animate-[fadeIn_0.3s_ease-out]">
//           <Bell className="w-4 h-4 shrink-0" />
//           <span>
//             New order <span className="font-semibold">{toast.orderNumber}</span>{" "}
//             received
//           </span>
//           <button
//             onClick={() => setToast(null)}
//             className="ml-auto text-blue-400 hover:text-blue-600"
//           >
//             ✕
//           </button>
//         </div>
//       )}

//       {/* Stats Cards */}
//       {stats && (
//         <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
//           <StatCard
//             label="Total"
//             value={stats.total}
//             onClick={() => handleStatusFilter("")}
//             active={!statusFilter}
//           />
//           <StatCard
//             label="Pending"
//             value={stats.pending}
//             color="yellow"
//             onClick={() => handleStatusFilter("PENDING")}
//             active={statusFilter === "PENDING"}
//           />
//           <StatCard
//             label="Allocated"
//             value={stats.allocated}
//             color="blue"
//             onClick={() => handleStatusFilter("ALLOCATED")}
//             active={statusFilter === "ALLOCATED"}
//           />
//           <StatCard
//             label="Picking"
//             value={stats.picking}
//             color="purple"
//             onClick={() => handleStatusFilter("PICKING")}
//             active={statusFilter === "PICKING"}
//           />
//           <StatCard
//             label="Packed"
//             value={stats.packed}
//             color="cyan"
//             onClick={() => handleStatusFilter("PACKED")}
//             active={statusFilter === "PACKED"}
//           />
//           <StatCard
//             label="Shipped"
//             value={stats.shipped}
//             color="green"
//             onClick={() => handleStatusFilter("SHIPPED")}
//             active={statusFilter === "SHIPPED"}
//           />
//         </div>
//       )}

//       {/* Search & Filters */}
//       <div className="bg-white border border-border rounded-lg p-4 mb-6">
//         <div className="flex flex-col sm:flex-row gap-4">
//           {/* Search */}
//           <form onSubmit={handleSearch} className="flex-1">
//             <div className="relative">
//               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
//               <input
//                 type="text"
//                 value={searchQuery}
//                 onChange={(e) => setSearchQuery(e.target.value)}
//                 placeholder="Search by order #, customer name, email..."
//                 className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//               />
//             </div>
//           </form>

//           {/* Source Filter */}
//           <select
//             value={sourceFilter}
//             onChange={(e) => {
//               setSourceFilter(e.target.value);
//               const params = new URLSearchParams(searchParams);
//               if (e.target.value) {
//                 params.set("source", e.target.value);
//               } else {
//                 params.delete("source");
//               }
//               params.set("page", "1");
//               setSearchParams(params);
//             }}
//             className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
//           >
//             <option value="">All Sources</option>
//             <option value="SHOPIFY">Shopify</option>
//             <option value="MANUAL">Manual</option>
//             <option value="API">API</option>
//           </select>
//         </div>
//       </div>

//       {/* Error */}
//       {error && (
//         <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6 flex items-center gap-2">
//           <AlertCircle className="w-5 h-5" />
//           {error}
//         </div>
//       )}

//       {/* Orders Table */}
//       <div className="bg-white border border-border rounded-lg overflow-hidden">
//         <table className="w-full">
//           <thead className="bg-gray-50 border-b border-border">
//             <tr>
//               <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
//                 Order #
//               </th>
//               <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
//                 Customer
//               </th>
//               <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
//                 Source
//               </th>
//               <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
//                 Items
//               </th>
//               <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
//                 Status
//               </th>
//               <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
//                 Created
//               </th>
//               <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">
//                 Actions
//               </th>
//             </tr>
//           </thead>
//           <tbody className="divide-y">
//             {loading ? (
//               Array.from({ length: 5 }).map((_, i) => (
//                 <TableRowSkeleton key={i} columns={7} />
//               ))
//             ) : orders.length === 0 ? (
//               <tr className="border-border">
//                 <td
//                   colSpan={7}
//                   className="px-4 py-12 text-center text-gray-500"
//                 >
//                   <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
//                   <p>No orders found</p>
//                 </td>
//               </tr>
//             ) : (
//               orders.map((order) => (
//                 <tr key={order.id} className="hover:bg-gray-50 border-border">
//                   <td className="px-4 py-3">
//                     <Link
//                       to={`/orders/${order.id}`}
//                       className="font-medium text-blue-600 hover:underline"
//                     >
//                       {order.orderNumber}
//                     </Link>
//                     {order.externalId && (
//                       <div className="text-xs text-gray-400">
//                         {order.externalId}
//                       </div>
//                     )}
//                   </td>
//                   <td className="px-4 py-3">
//                     <div className="font-medium">
//                       {order.customerName || "—"}
//                     </div>
//                     <div className="text-sm text-gray-500">
//                       {order.customerEmail || ""}
//                     </div>
//                   </td>
//                   <td className="px-4 py-3">
//                     <span className="text-sm text-gray-600">
//                       {order.source}
//                     </span>
//                   </td>
//                   <td className="px-4 py-3">
//                     <span className="text-sm">
//                       {order.lineItems?.length || 0} items
//                     </span>
//                     <div className="text-xs text-gray-400">
//                       {order.lineItems?.reduce(
//                         (sum, li) => sum + li.quantity,
//                         0,
//                       ) || 0}{" "}
//                       units
//                     </div>
//                   </td>
//                   <td className="px-4 py-3">
//                     <StatusBadge status={order.status} />
//                   </td>
//                   <td className="px-4 py-3 text-sm text-gray-500">
//                     {new Date(order.createdAt).toLocaleDateString()}
//                   </td>
//                   <td className="px-4 py-3 text-right">
//                     <Link
//                       to={`/orders/${order.id}`}
//                       className="inline-flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded"
//                     >
//                       <Eye className="w-4 h-4" />
//                       View
//                     </Link>
//                   </td>
//                 </tr>
//               ))
//             )}
//           </tbody>
//         </table>
//       </div>

//       {/* Pagination */}
//       {totalPages > 1 && (
//         <div className="flex items-center justify-between mt-4">
//           <p className="text-sm text-gray-500">
//             Showing {(page - 1) * PAGE_SIZE + 1} to{" "}
//             {Math.min(page * PAGE_SIZE, total)} of {total}
//           </p>
//           <div className="flex items-center gap-2">
//             <button
//               onClick={() => goToPage(page - 1)}
//               disabled={page === 1}
//               className="p-2 border border-border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               <ChevronLeft className="w-4 h-4" />
//             </button>
//             <span className="px-4 py-2 text-sm">
//               Page {page} of {totalPages}
//             </span>
//             <button
//               onClick={() => goToPage(page + 1)}
//               disabled={page === totalPages}
//               className="p-2 border border-border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               <ChevronRight className="w-4 h-4" />
//             </button>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }

// // ============================================================================
// // Stat Card Component
// // ============================================================================

// function StatCard({
//   label,
//   value,
//   color = "gray",
//   onClick,
//   active,
// }: {
//   label: string;
//   value: number;
//   color?: string;
//   onClick: () => void;
//   active: boolean;
// }) {
//   return (
//     <button
//       onClick={onClick}
//       className={`bg-white border border-border rounded-lg p-4 text-left hover:shadow-md transition-shadow ${
//         active ? "ring-2 ring-blue-500" : ""
//       }`}
//     >
//       <div className="text-sm text-gray-500">{label}</div>
//       <div className={`text-2xl font-bold`}>{value}</div>
//     </button>
//   );
// }

// export { OrdersPage };
