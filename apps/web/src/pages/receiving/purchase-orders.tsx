/**
 * Purchase Orders Page - Production Version
 *
 * Save to: apps/web/src/pages/receiving/purchase-orders.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  Search,
  RefreshCw,
  ChevronRight,
  Calendar,
  Truck,
  CheckCircle,
  AlertCircle,
  Clock,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PurchaseOrder {
  id: string;
  reference: string;
  vendor: string;
  status: string;
  expectedDate: string;
  items: Array<{
    sku: string;
    productName: string;
    quantity: number;
  }>;
  receivingSession?: { id: string; status: string } | null;
  hasPendingSession?: boolean;
}

type FilterStatus = "all" | "open" | "partial" | "closed";

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("open");
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPOs = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setIsRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (filterStatus !== "all") params.set("status", filterStatus);
        params.set("limit", "50");

        const res = await apiClient.get<{ purchaseOrders: PurchaseOrder[] }>(
          `/receiving/inventory-planner/purchase-orders?${params.toString()}`,
        );

        setPurchaseOrders(res.purchaseOrders || []);
      } catch (err) {
        console.error("Failed to fetch POs:", err);
        setError("Failed to load purchase orders");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [filterStatus],
  );

  useEffect(() => {
    fetchPOs();
  }, [fetchPOs]);

  const filteredPOs = purchaseOrders.filter((po) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      po.reference?.toLowerCase().includes(q) ||
      po.vendor?.toLowerCase().includes(q) ||
      po.id?.toLowerCase().includes(q)
    );
  });

  const handleSelectPO = (po: PurchaseOrder) => {
    if (po.receivingSession?.id) {
      // Existing session - go to it
      if (po.receivingSession.status === "SUBMITTED") {
        navigate(`/receiving/approve/${po.receivingSession.id}`);
      } else {
        navigate(`/receiving/session/${po.receivingSession.id}`);
      }
    } else {
      // Start new session
      navigate(`/receiving/start/${po.id}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate("/receiving")}
              className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Purchase Orders</h1>
            <button
              onClick={() => fetchPOs(true)}
              disabled={isRefreshing}
              className="ml-auto p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            >
              <RefreshCw
                className={cn("w-5 h-5", isRefreshing && "animate-spin")}
              />
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search PO# or vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Filter Chips */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            {(["all", "open", "partial", "closed"] as FilterStatus[]).map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                    filterStatus === status
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                  )}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-lg p-4 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : !filteredPOs.length ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No purchase orders found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPOs.map((po) => (
              <PurchaseOrderCard
                key={po.id}
                po={po}
                onClick={() => handleSelectPO(po)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Order Card
// ─────────────────────────────────────────────────────────────────────────────

interface PurchaseOrderCardProps {
  po: PurchaseOrder;
  onClick: () => void;
}

function PurchaseOrderCard({ po, onClick }: PurchaseOrderCardProps) {
  const hasSession = !!po.receivingSession;
  const sessionStatus = po.receivingSession?.status;

  const getSessionBadge = () => {
    if (!hasSession) return null;

    if (sessionStatus === "IN_PROGRESS") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
          <Clock className="w-3 h-3" />
          In Progress
        </span>
      );
    }
    if (sessionStatus === "SUBMITTED") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
          <AlertCircle className="w-3 h-3" />
          Pending Approval
        </span>
      );
    }
    if (sessionStatus === "APPROVED") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
          <CheckCircle className="w-3 h-3" />
          Received
        </span>
      );
    }
    if (sessionStatus === "REJECTED") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
          Rejected
        </span>
      );
    }
    return null;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const totalItems = po.items?.length || 0;
  const totalUnits =
    po.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

  const getActionText = () => {
    if (!hasSession) return "Start Receiving →";
    if (sessionStatus === "IN_PROGRESS") return "Continue Receiving →";
    if (sessionStatus === "SUBMITTED") return "Review Approval →";
    if (sessionStatus === "REJECTED") return "Reopen Session →";
    return "View Details →";
  };

  return (
    <button
      onClick={onClick}
      className="cursor-pointer w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 text-left hover:border-blue-300 hover:shadow transition-all active:bg-gray-50"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-gray-900">
              {po.reference || po.id}
            </span>
            {getSessionBadge()}
          </div>

          {po.vendor && (
            <div className="flex items-center gap-1.5 text-sm text-gray-600 mb-2">
              <Truck className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{po.vendor}</span>
            </div>
          )}

          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>{totalItems} items</span>
            <span>{totalUnits} units</span>
            {po.expectedDate && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(po.expectedDate)}
              </span>
            )}
          </div>
        </div>

        <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" />
      </div>

      {/* Action hint */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <span className="text-sm font-medium text-blue-600">
          {getActionText()}
        </span>
      </div>
    </button>
  );
}
