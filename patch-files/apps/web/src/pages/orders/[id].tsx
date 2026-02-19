/**
 * Order Detail Page
 * View order details, line items, allocation status, shipping, and actions
 *
 * Save to: apps/web/src/pages/orders/[id].tsx
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  ShoppingCart,
  Package,
  Truck,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  MapPin,
  Mail,
  User,
  Calendar,
  RefreshCw,
  Loader2,
  ClipboardList,
  PackageCheck,
  Ban,
  ExternalLink,
  DollarSign,
  Zap,
  Receipt,
  Archive,
  PauseCircle,
  Scissors,
  Tag,
  Unlink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Loading } from "@/components/ui/loading";
import { PackingImage, PackingImages } from "@/components/orders/PackingImages";

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
  productVariantId: string | null;
  allocationStatus:
    | "ALLOCATED"
    | "PARTIAL"
    | "UNALLOCATED"
    | "BACKORDERED"
    | "UNMATCHED";
  matched: boolean;
  matchError: string | null;
}

interface OrderAllocation {
  id: string;
  quantity: number;
  status: string;
  location: { id: string; name: string } | null;
  lotNumber: string | null;
}

interface ShippingPackage {
  id: string;
  carrierCode: string;
  serviceCode: string;
  packageCode: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  cost: number;
  weight: number | null;
  dimensions: {
    length: number;
    width: number;
    height: number;
    unit: string;
  } | null;
  voidedAt: string | null;
  shippedAt: string | null;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
  }>;
  createdAt: string;
}

interface WorkTask {
  id: string;
  taskNumber: string;
  type: string;
  status: string;
  assignedTo: { name: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  totalItems: number;
  completedItems: number;
  shortItems: number;
  createdAt: string;
}

interface FulfillmentEvent {
  id: string;
  type: string;
  payload: any;
  correlationId: string | null;
  createdAt: string;
}

interface Order {
  id: string;
  orderNumber: string;
  externalId: string | null;
  source: string;
  status: OrderStatus;
  priority: Priority;
  paymentStatus: string;
  customerName: string | null;
  customerEmail: string | null;
  shippingName: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  holdReason: string | null;
  holdAt: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  totalAmount: number;
  unmatchedItems: number;
  notes: string | null;
  lineItems: OrderLineItem[];
  allocations: OrderAllocation[];
  workTasks: WorkTask[];
  shippingPackages?: ShippingPackage[];
  fulfillmentEvents?: FulfillmentEvent[];
  packingImages: PackingImage[];
  createdAt: string;
  updatedAt: string;
}

type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "READY_TO_PICK"
  | "ALLOCATED"
  | "PARTIALLY_ALLOCATED"
  | "BACKORDERED"
  | "PICKING"
  | "PICKED"
  | "PACKING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "ON_HOLD";

type Priority = "STANDARD" | "RUSH" | "EXPRESS";

// ============================================================================
// Status Config
// ============================================================================

const statusConfig: Record<
  OrderStatus,
  { label: string; color: string; bgColor: string; icon: typeof Clock }
> = {
  PENDING: {
    label: "Pending",
    color: "text-yellow-700",
    bgColor: "bg-yellow-100",
    icon: Clock,
  },
  CONFIRMED: {
    label: "Confirmed",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    icon: CheckCircle,
  },
  READY_TO_PICK: {
    label: "Ready to Pick",
    color: "text-teal-700",
    bgColor: "bg-teal-100",
    icon: ClipboardList,
  },
  ALLOCATED: {
    label: "Allocated",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    icon: Package,
  },
  PARTIALLY_ALLOCATED: {
    label: "Partially Allocated",
    color: "text-orange-700",
    bgColor: "bg-orange-100",
    icon: AlertCircle,
  },
  BACKORDERED: {
    label: "Backordered",
    color: "text-red-700",
    bgColor: "bg-red-100",
    icon: PauseCircle,
  },
  PICKING: {
    label: "Picking",
    color: "text-amber-700",
    bgColor: "bg-amber-100",
    icon: PackageCheck,
  },
  PICKED: {
    label: "Picked",
    color: "text-indigo-700",
    bgColor: "bg-indigo-100",
    icon: CheckCircle,
  },
  PACKING: {
    label: "Packing",
    color: "text-pink-700",
    bgColor: "bg-pink-100",
    icon: Package,
  },
  PACKED: {
    label: "Packed",
    color: "text-cyan-700",
    bgColor: "bg-cyan-100",
    icon: CheckCircle,
  },
  SHIPPED: {
    label: "Shipped",
    color: "text-green-700",
    bgColor: "bg-green-100",
    icon: Truck,
  },
  DELIVERED: {
    label: "Delivered",
    color: "text-green-700",
    bgColor: "bg-green-100",
    icon: Archive,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-red-700",
    bgColor: "bg-red-100",
    icon: XCircle,
  },
  ON_HOLD: {
    label: "On Hold",
    color: "text-gray-700",
    bgColor: "bg-gray-100",
    icon: AlertCircle,
  },
};

const priorityConfig: Record<
  Priority,
  { label: string; color: string; bgColor: string; icon: typeof Tag }
> = {
  STANDARD: {
    label: "Standard",
    color: "text-gray-600",
    bgColor: "bg-gray-100",
    icon: Tag,
  },
  RUSH: {
    label: "Rush",
    color: "text-orange-700",
    bgColor: "bg-orange-100",
    icon: Zap,
  },
  EXPRESS: {
    label: "Express",
    color: "text-red-700",
    bgColor: "bg-red-100",
    icon: Zap,
  },
};

// ============================================================================
// Helpers
// ============================================================================

function getCarrierDisplayName(carrierCode: string): string {
  switch (carrierCode?.toLowerCase()) {
    case "stamps_com":
    case "usps":
      return "USPS";
    case "ups":
      return "UPS";
    case "fedex":
      return "FedEx";
    default:
      return carrierCode?.toUpperCase() || "Unknown";
  }
}

function getTrackingUrl(carrierCode: string, trackingNumber: string): string {
  switch (carrierCode?.toLowerCase()) {
    case "stamps_com":
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${trackingNumber}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    default:
      return "";
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// ============================================================================
// Main Component
// ============================================================================

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchOrder = async () => {
    if (!id) return;
    setLoading(true);
    setError("");

    try {
      const data = await apiClient.get<Order>(`/orders/${id}`);
      setOrder(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
  }, [id]);

  console.log(order);

  // ============================================================================
  // Actions
  // ============================================================================

  const handleAction = async (
    action: string,
    endpoint: string,
    successMsg: string,
    body?: Record<string, unknown>,
  ) => {
    if (!order) return;
    setActionLoading(action);
    setActionMessage(null);

    try {
      await apiClient.post(endpoint, body);
      setActionMessage({ type: "success", text: successMsg });
      fetchOrder();
    } catch (err: any) {
      setActionMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const handleAllocate = () =>
    handleAction(
      "allocate",
      `/orders/${order!.id}/allocate`,
      "Inventory allocated successfully",
    );

  const handleCreatePickTask = () =>
    handleAction(
      "pick",
      `/orders/${order!.id}/tasks/pick`,
      "Pick task created successfully",
    );

  const handleHold = () =>
    handleAction("hold", `/orders/${order!.id}/hold`, "Order placed on hold");

  const handleRelease = () =>
    handleAction(
      "release",
      `/orders/${order!.id}/release`,
      "Order released from hold",
    );

  const handleCancel = async () => {
    if (!order) return;
    if (!confirm("Are you sure you want to cancel this order?")) return;
    handleAction("cancel", `/orders/${order.id}/cancel`, "Order cancelled");
  };

  const handleSplitBackorder = async () => {
    if (!order) return;
    if (
      !confirm(
        "This will split the order: allocated items will ship now, unallocated items will become a new backorder. Continue?",
      )
    )
      return;
    handleAction(
      "split",
      `/orders/${order.id}/split-backorder`,
      "Order split — backorder created for remaining items",
    );
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) return <Loading />;

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
        <Link
          to="/orders"
          className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Orders
        </Link>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">Order not found</p>
        </div>
      </div>
    );
  }

  const status = statusConfig[order.status] || statusConfig.PENDING;
  const StatusIcon = status.icon;
  const priority = priorityConfig[order.priority] || priorityConfig.STANDARD;
  const showPriority = order.priority !== "STANDARD";

  const totalItems = order.lineItems.reduce((sum, li) => sum + li.quantity, 0);
  const allocatedItems = order.lineItems.reduce(
    (sum, li) => sum + li.quantityAllocated,
    0,
  );
  const pickedItems = order.lineItems.reduce(
    (sum, li) => sum + li.quantityPicked,
    0,
  );
  const shippedItems = order.lineItems.reduce(
    (sum, li) => sum + li.quantityShipped,
    0,
  );

  const isTerminal = ["SHIPPED", "DELIVERED", "CANCELLED"].includes(
    order.status,
  );
  const hasUnmatched = order.unmatchedItems > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/orders"
            className="p-2 hover:bg-gray-100 rounded-lg"
            title="Back to Orders"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">Order {order.orderNumber}</h1>
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${status.bgColor} ${status.color}`}
              >
                <StatusIcon className="w-4 h-4" />
                {status.label}
              </span>
              {showPriority && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${priority.bgColor} ${priority.color}`}
                >
                  <priority.icon className="w-3 h-3" />
                  {priority.label}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-0.5">
              Created {new Date(order.createdAt).toLocaleString()}
              {order.totalAmount > 0 && (
                <span className="ml-3">
                  {formatCurrency(order.totalAmount)}
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={fetchOrder}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Hold Reason Banner */}
      {order.status === "ON_HOLD" && order.holdReason && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Order is on hold</div>
            <div className="text-sm mt-0.5">{order.holdReason}</div>
            {order.holdAt && (
              <div className="text-xs text-amber-600 mt-1">
                Since {new Date(order.holdAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unmatched Items Warning */}
      {hasUnmatched && (
        <div className="mb-6 p-4 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 flex items-start gap-3">
          <Unlink className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              {order.unmatchedItems} unmatched item
              {order.unmatchedItems !== 1 ? "s" : ""}
            </div>
            <div className="text-sm mt-0.5">
              Some SKUs couldn't be matched to products. These items cannot be
              allocated or picked until matched.
            </div>
          </div>
        </div>
      )}

      {/* Action Message */}
      {actionMessage && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
            actionMessage.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {actionMessage.type === "success" ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          {actionMessage.text}
        </div>
      )}

      {/* Actions */}
      {!isTerminal && (
        <div className="bg-white border border-border rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-3">Actions</h2>
          <div className="flex flex-wrap gap-2">
            {["PENDING", "CONFIRMED", "BACKORDERED"].includes(order.status) && (
              <ActionButton
                onClick={handleAllocate}
                loading={actionLoading === "allocate"}
                disabled={!!actionLoading}
                icon={Package}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {order.status === "BACKORDERED"
                  ? "Retry Allocation"
                  : "Allocate Inventory"}
              </ActionButton>
            )}

            {["PARTIALLY_ALLOCATED"].includes(order.status) && (
              <ActionButton
                onClick={handleSplitBackorder}
                loading={actionLoading === "split"}
                disabled={!!actionLoading}
                icon={Scissors}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                Split &amp; Ship Allocated
              </ActionButton>
            )}

            {["ALLOCATED", "PARTIALLY_ALLOCATED", "READY_TO_PICK"].includes(
              order.status,
            ) && (
              <ActionButton
                onClick={handleCreatePickTask}
                loading={actionLoading === "pick"}
                disabled={!!actionLoading}
                icon={ClipboardList}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                Create Pick Task
              </ActionButton>
            )}

            {order.status === "ON_HOLD" && (
              <ActionButton
                onClick={handleRelease}
                loading={actionLoading === "release"}
                disabled={!!actionLoading}
                icon={CheckCircle}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                Release Hold
              </ActionButton>
            )}

            {order.status !== "ON_HOLD" && (
              <ActionButton
                onClick={handleHold}
                loading={actionLoading === "hold"}
                disabled={!!actionLoading}
                icon={AlertCircle}
                className="border text-gray-700 hover:bg-gray-50"
              >
                Put On Hold
              </ActionButton>
            )}

            <ActionButton
              onClick={handleCancel}
              loading={actionLoading === "cancel"}
              disabled={!!actionLoading}
              icon={Ban}
              className="border border-red-200 text-red-600 hover:bg-red-50"
            >
              Cancel Order
            </ActionButton>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="font-semibold mb-4">Fulfillment Progress</h2>
            <div className="grid grid-cols-3 gap-4">
              <ProgressCard
                label="Allocated"
                current={allocatedItems}
                total={totalItems}
                color="blue"
              />
              <ProgressCard
                label="Picked"
                current={pickedItems}
                total={totalItems}
                color="amber"
              />
              <ProgressCard
                label="Shipped"
                current={shippedItems}
                total={totalItems}
                color="green"
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold">
                Line Items ({order.lineItems.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2 text-sm font-medium text-gray-500">
                      Product
                    </th>
                    <th className="text-center px-4 py-2 text-sm font-medium text-gray-500">
                      Qty
                    </th>
                    <th className="text-center px-4 py-2 text-sm font-medium text-gray-500">
                      Allocated
                    </th>
                    <th className="text-center px-4 py-2 text-sm font-medium text-gray-500">
                      Picked
                    </th>
                    <th className="text-left px-4 py-2 text-sm font-medium text-gray-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {order.lineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-gray-500">{item.sku}</div>
                        {item.matchError && (
                          <div className="text-xs text-red-500 mt-0.5">
                            {item.matchError}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{item.quantity}</td>
                      <td className="px-4 py-3 text-center">
                        <QtyIndicator
                          current={item.quantityAllocated}
                          total={item.quantity}
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <QtyIndicator
                          current={item.quantityPicked}
                          total={item.quantity}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <AllocationBadge status={item.allocationStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Shipping Packages */}
          {order.shippingPackages && order.shippingPackages.length > 0 && (
            <div className="bg-white border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-semibold">
                  Shipping Packages ({order.shippingPackages.length})
                </h2>
              </div>
              <div className="divide-y divide-border">
                {order.shippingPackages.map((pkg) => (
                  <ShippingPackageCard key={pkg.id} pkg={pkg} />
                ))}
              </div>
            </div>
          )}

          {/* Work Tasks */}
          {order.workTasks && order.workTasks.length > 0 && (
            <div className="bg-white border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-semibold">Work Tasks</h2>
              </div>
              <div className="divide-y divide-border">
                {order.workTasks.map((task) => (
                  <div key={task.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          to={`/fulfillment/${order.id}`}
                          className="font-medium text-blue-600 hover:underline truncate"
                        >
                          {task.taskNumber || task.type}
                        </Link>
                        <TaskTypeBadge type={task.type} />
                      </div>
                      <TaskStatusBadge status={task.status} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>{task.assignedTo?.name || "Unassigned"}</span>
                      <span>
                        Items: {task.completedItems}/{task.totalItems}
                        {task.shortItems > 0 && (
                          <span className="text-red-500 ml-1">
                            ({task.shortItems} short)
                          </span>
                        )}
                      </span>
                      {task.startedAt && (
                        <span>
                          Started {new Date(task.startedAt).toLocaleString()}
                        </span>
                      )}
                      {task.completedAt && (
                        <span>
                          Completed{" "}
                          {new Date(task.completedAt).toLocaleString()}
                        </span>
                      )}
                      {!task.startedAt && (
                        <span>
                          Created{" "}
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    {task.totalItems > 0 && (
                      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            task.status === "COMPLETED"
                              ? "bg-green-500"
                              : "bg-blue-500"
                          }`}
                          style={{
                            width: `${Math.round(
                              (task.completedItems / task.totalItems) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fulfillment Events */}
          {order.fulfillmentEvents && order.fulfillmentEvents.length > 0 && (
            <FulfillmentTimeline events={order.fulfillmentEvents} />
          )}

          {/* Allocations Detail */}
          {order.allocations && order.allocations.length > 0 && (
            <div className="bg-white border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="font-semibold">
                  Allocations ({order.allocations.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2 text-sm font-medium text-gray-500">
                        Location
                      </th>
                      <th className="text-center px-4 py-2 text-sm font-medium text-gray-500">
                        Qty
                      </th>
                      <th className="text-left px-4 py-2 text-sm font-medium text-gray-500">
                        Lot
                      </th>
                      <th className="text-left px-4 py-2 text-sm font-medium text-gray-500">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {order.allocations.map((alloc) => (
                      <tr key={alloc.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">
                          {alloc.location?.name || "—"}
                        </td>
                        <td className="px-4 py-2 text-sm text-center">
                          {alloc.quantity}
                        </td>
                        <td className="px-4 py-2 text-sm font-mono text-gray-500">
                          {alloc.lotNumber || "—"}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              alloc.status === "PICKED"
                                ? "bg-green-100 text-green-700"
                                : alloc.status === "ALLOCATED"
                                  ? "bg-blue-100 text-blue-700"
                                  : alloc.status === "RELEASED"
                                    ? "bg-red-100 text-red-500"
                                    : "bg-red-100 text-red-700"
                            }`}
                          >
                            {alloc.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Packing Images */}
          <PackingImages images={order.packingImages} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Order Info */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="font-semibold mb-3">Order Info</h2>
            <div className="space-y-3 text-sm">
              <SidebarRow icon={Calendar} label="Created">
                {new Date(order.createdAt).toLocaleString()}
              </SidebarRow>
              <SidebarRow icon={Package} label="Source">
                {order.source}
              </SidebarRow>
              {order.externalId && (
                <SidebarRow icon={ShoppingCart} label="External ID">
                  <span className="font-mono text-xs">{order.externalId}</span>
                </SidebarRow>
              )}
              <SidebarRow icon={Receipt} label="Payment">
                <PaymentBadge status={order.paymentStatus} />
              </SidebarRow>
              {order.totalAmount > 0 && (
                <SidebarRow icon={DollarSign} label="Total">
                  {formatCurrency(order.totalAmount)}
                </SidebarRow>
              )}
            </div>
          </div>

          {/* Customer */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="font-semibold mb-3">Customer</h2>
            <div className="space-y-3 text-sm">
              {order.customerName && (
                <SidebarRow icon={User}>{order.customerName}</SidebarRow>
              )}
              {order.customerEmail && (
                <SidebarRow icon={Mail}>{order.customerEmail}</SidebarRow>
              )}
              {!order.customerName && !order.customerEmail && (
                <p className="text-gray-400 text-sm">No customer info</p>
              )}
            </div>
          </div>

          {/* Shipping Address */}
          {order.shippingAddress1 && (
            <div className="bg-white border border-border rounded-lg p-4">
              <h2 className="font-semibold mb-3">Shipping Address</h2>
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div>
                  {order.shippingName && <div>{order.shippingName}</div>}
                  <div>{order.shippingAddress1}</div>
                  {order.shippingAddress2 && (
                    <div>{order.shippingAddress2}</div>
                  )}
                  <div>
                    {order.shippingCity}, {order.shippingState}{" "}
                    {order.shippingZip}
                  </div>
                  {order.shippingCountry && <div>{order.shippingCountry}</div>}
                  {order.shippingPhone && (
                    <div className="mt-2 text-gray-500">
                      {order.shippingPhone}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tracking (quick summary in sidebar) */}
          {order.trackingNumber && (
            <div className="bg-white border border-border rounded-lg p-4">
              <h2 className="font-semibold mb-3">Tracking</h2>
              <div className="space-y-2 text-sm">
                {order.trackingNumber.split(",").map((tn, i) => {
                  const trimmed = tn.trim();
                  // Try to determine carrier from shipping packages
                  const pkg = order.shippingPackages?.find(
                    (p) => p.trackingNumber === trimmed,
                  );
                  const carrier = pkg?.carrierCode || "";
                  const url = getTrackingUrl(carrier, trimmed);

                  return (
                    <div key={i} className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-gray-400 shrink-0" />
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-xs flex items-center gap-1"
                        >
                          {trimmed}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{trimmed}</span>
                      )}
                    </div>
                  );
                })}
                {order.shippedAt && (
                  <div className="text-xs text-gray-500 mt-1">
                    Shipped {new Date(order.shippedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {order.notes && (
            <div className="bg-white border border-border rounded-lg p-4">
              <h2 className="font-semibold mb-3">Notes</h2>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">
                {order.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function ActionButton({
  onClick,
  loading,
  disabled,
  icon: Icon,
  className = "",
  children,
}: {
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
  icon: typeof Package;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer transition inline-flex items-center gap-2 px-4 py-2 rounded-lg disabled:opacity-50 ${className}`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      {children}
    </button>
  );
}

function ProgressCard({
  label,
  current,
  total,
  color,
}: {
  label: string;
  current: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  const colors: Record<string, { bar: string; text: string }> = {
    blue: { bar: "bg-blue-500", text: "text-blue-600" },
    amber: { bar: "bg-amber-500", text: "text-amber-600" },
    green: { bar: "bg-green-500", text: "text-green-600" },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-500">{label}</span>
        <span className={`text-sm font-medium ${colors[color].text}`}>
          {current}/{total}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colors[color].bar} transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function QtyIndicator({ current, total }: { current: number; total: number }) {
  return (
    <span
      className={
        current >= total
          ? "text-green-600"
          : current > 0
            ? "text-yellow-600"
            : "text-gray-400"
      }
    >
      {current}
    </span>
  );
}

function AllocationBadge({
  status,
}: {
  status: "ALLOCATED" | "PARTIAL" | "UNALLOCATED" | "BACKORDERED" | "UNMATCHED";
}) {
  const config: Record<string, { label: string; color: string }> = {
    ALLOCATED: { label: "Allocated", color: "bg-green-100 text-green-700" },
    PARTIAL: { label: "Partial", color: "bg-yellow-100 text-yellow-700" },
    UNALLOCATED: {
      label: "Unallocated",
      color: "bg-gray-100 text-gray-700",
    },
    BACKORDERED: {
      label: "Backordered",
      color: "bg-red-100 text-red-700",
    },
    UNMATCHED: {
      label: "Unmatched",
      color: "bg-orange-100 text-orange-700",
    },
  };

  const c = config[status] || config.UNALLOCATED;

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.color}`}>
      {c.label}
    </span>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: "bg-green-100 text-green-700",
    IN_PROGRESS: "bg-blue-100 text-blue-700",
    ASSIGNED: "bg-amber-100 text-amber-700",
    BLOCKED: "bg-red-100 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-500",
    PENDING: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`px-2 py-1 rounded-full font-semibold text-[10px] ${
        colors[status] || colors.PENDING
      }`}
    >
      {status}
    </span>
  );
}

function TaskTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; color: string }> = {
    PICKING: { label: "Picking", color: "bg-amber-100 text-amber-700" },
    PACKING: { label: "Packing", color: "bg-purple-100 text-purple-700" },
  };

  const c = config[type] || { label: type, color: "bg-gray-100 text-gray-500" };

  return (
    <span
      className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${c.color}`}
    >
      {c.label}
    </span>
  );
}

function PaymentBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PAID: "text-green-600",
    AUTHORIZED: "text-blue-600",
    PENDING: "text-yellow-600",
    REFUNDED: "text-gray-500",
    PARTIALLY_REFUNDED: "text-orange-600",
    FAILED: "text-red-600",
  };

  return (
    <span className={`font-medium ${colors[status] || "text-gray-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  children,
}: {
  icon?: typeof Calendar;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}
      <div>
        {label && <div className="text-gray-500">{label}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

function ShippingPackageCard({ pkg }: { pkg: ShippingPackage }) {
  const carrier = getCarrierDisplayName(pkg.carrierCode);
  const isVoided = !!pkg.voidedAt;
  const trackingUrl = pkg.trackingNumber
    ? getTrackingUrl(pkg.carrierCode, pkg.trackingNumber)
    : "";

  return (
    <div className={`px-4 py-3 ${isVoided ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {carrier} — {pkg.serviceCode.replace(/_/g, " ")}
            </span>
            {isVoided && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                Voided
              </span>
            )}
          </div>

          {pkg.trackingNumber && (
            <div className="mt-1">
              {trackingUrl ? (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm font-mono flex items-center gap-1"
                >
                  {pkg.trackingNumber}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-sm font-mono text-gray-600">
                  {pkg.trackingNumber}
                </span>
              )}
            </div>
          )}

          {pkg.items && pkg.items.length > 0 && (
            <div className="mt-1.5 text-xs text-gray-500">
              {pkg.items.map((item) => (
                <span key={item.id} className="mr-3">
                  {item.sku} ×{item.quantity}
                </span>
              ))}
            </div>
          )}

          <div className="mt-1 text-xs text-gray-400">
            {new Date(pkg.createdAt).toLocaleString()}
            {pkg.weight && <span className="ml-2">{pkg.weight} oz</span>}
            {pkg.dimensions && (
              <span className="ml-2">
                {pkg.dimensions.length}×{pkg.dimensions.width}×
                {pkg.dimensions.height} in
              </span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-medium">{formatCurrency(pkg.cost)}</div>
          {pkg.labelUrl && !isVoided && (
            <a
              href={pkg.labelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"
            >
              Label PDF
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Fulfillment Events Timeline
// ============================================================================

function FulfillmentTimeline({ events }: { events: FulfillmentEvent[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer w-full flex items-center justify-between px-4 py-3 border-b border-border text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          Fulfillment Activity
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
            {events.length}
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {expanded && (
        <div className="max-h-[500px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              No events yet
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {[...events].reverse().map((event) => (
                <div key={event.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <EventBadge type={event.type} />
                    <span className="text-[10px] text-gray-400 font-mono">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {eventDescription(event)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; color: string }> = {
    "order:processing": {
      label: "PROC",
      color: "bg-green-100 text-green-700",
    },
    "order:picked": { label: "PICKD", color: "bg-amber-100 text-amber-700" },
    "order:packed": { label: "PACKD", color: "bg-purple-100 text-purple-700" },
    "order:shipped": { label: "SHIP", color: "bg-cyan-100 text-cyan-700" },
    "picklist:generated": {
      label: "PLIST",
      color: "bg-amber-100 text-amber-700",
    },
    "picklist:item_picked": {
      label: "SCAN",
      color: "bg-yellow-100 text-yellow-700",
    },
    "picklist:completed": {
      label: "PICK✓",
      color: "bg-green-100 text-green-700",
    },
    "pickbin:created": { label: "BIN", color: "bg-blue-100 text-blue-700" },
    "pickbin:item_verified": {
      label: "VRFY",
      color: "bg-purple-100 text-purple-700",
    },
    "pickbin:completed": {
      label: "BIN✓",
      color: "bg-green-100 text-green-700",
    },
    "packing:started": {
      label: "PACK",
      color: "bg-purple-100 text-purple-700",
    },
    "packing:item_verified": {
      label: "VRFY",
      color: "bg-purple-100 text-purple-700",
    },
    "packing:completed": {
      label: "PACK✓",
      color: "bg-green-100 text-green-700",
    },
    "packing:image_uploaded": {
      label: "IMG",
      color: "bg-pink-100 text-pink-700",
    },
    "shipping:label_created": {
      label: "LABEL",
      color: "bg-cyan-100 text-cyan-700",
    },
    "inventory:updated": {
      label: "INV",
      color: "bg-orange-100 text-orange-700",
    },
  };

  const c = config[type] || {
    label: "EVT",
    color: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${c.color}`}
    >
      {c.label}
    </span>
  );
}

function eventDescription(event: { type: string; payload: any }): string {
  const p = event.payload;
  if (!p) return event.type;

  switch (event.type) {
    case "picklist:generated":
      return `Pick list generated — ${p.totalItems ?? p.itemCount ?? "?"} items`;
    case "picklist:item_picked":
      return `${p.sku}: ${p.quantity}x from ${p.location || "—"}`;
    case "picklist:completed":
      return p.bin ? `Completed → Bin ${p.bin.binNumber}` : "All items picked";
    case "pickbin:created":
      return `Bin ${p.binNumber} created (${p.itemCount} SKUs)`;
    case "pickbin:item_verified":
      return `${p.sku}: verified (${p.progress})`;
    case "pickbin:completed":
      return `Bin verification complete`;
    case "packing:started":
      return `Packing started — ${p.totalItems ?? p.itemCount ?? "?"} items`;
    case "packing:item_verified":
      return `${p.sku}: verified`;
    case "packing:completed":
      return `${p.weight || "?"}${p.weightUnit || "oz"}`;
    case "packing:image_uploaded":
      return `Packing photo uploaded`;
    case "shipping:label_created": {
      const trackingNums = p.trackingNumbers?.length
        ? `${p.trackingNumbers.length} tracking #s`
        : p.trackingNumber || "";
      return `${(p.carrier || "").toUpperCase()} ${p.service || ""} — ${trackingNums}`;
    }
    case "order:picked":
      return "Order picked";
    case "order:packed":
      return "Order packed";
    case "order:shipped":
      return p.message || "Order shipped";
    default:
      return p.message || event.type;
  }
}
