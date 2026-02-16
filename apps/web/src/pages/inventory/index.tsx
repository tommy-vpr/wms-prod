/**
 * Inventory List Page
 * View and manage inventory units
 *
 * Save to: apps/web/src/pages/inventory/index.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Warehouse,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Package,
  MapPin,
  AlertCircle,
  Calendar,
  Box,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { TableRowSkeleton } from "@/components/ui/loading";
import { InventoryPlannerSyncCard } from "@/components/inventory/InventoryPlannerSyncCard";
import { LocationImportCard } from "@/components/inventory/LocationImportCard";
import { ProductImportCard } from "@/components/inventory/ProductImportCard";

// ============================================================================
// Types
// ============================================================================

interface InventoryUnit {
  id: string;
  quantity: number;
  status: InventoryStatus;
  lotNumber: string | null;
  expiryDate: string | null;
  receivedAt: string;
  productVariant: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
    product?: {
      brand: string | null;
      category: string | null;
    };
  };
  location: {
    id: string;
    name: string;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    bin: string | null;
    pickSequence: number | null;
  } | null;
}

type InventoryStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "PICKED"
  | "DAMAGED"
  | "IN_TRANSIT"
  | "QUARANTINE";

interface InventoryStats {
  totalUnits: number;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  byStatus: Array<{ status: string; quantity: number; count: number }>;
  lowStockCount: number;
  expiringCount: number;
}

const PAGE_SIZE = 50;

// ============================================================================
// Status Badge
// ============================================================================

const statusConfig: Record<InventoryStatus, { label: string; color: string }> =
  {
    AVAILABLE: { label: "Available", color: "bg-green-100 text-green-800" },
    RESERVED: { label: "Reserved", color: "bg-blue-100 text-blue-800" },
    PICKED: { label: "Picked", color: "bg-purple-100 text-purple-800" },
    DAMAGED: { label: "Damaged", color: "bg-red-100 text-red-800" },
    IN_TRANSIT: { label: "In Transit", color: "bg-yellow-100 text-yellow-800" },
    QUARANTINE: { label: "Quarantine", color: "bg-orange-100 text-orange-800" },
  };

function StatusBadge({ status }: { status: InventoryStatus }) {
  const config = statusConfig[status] || statusConfig.AVAILABLE;
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
    >
      {config.label}
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [inventory, setInventory] = useState<InventoryUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") || "",
  );
  const [zoneFilter, setZoneFilter] = useState<string>(
    searchParams.get("zone") || "",
  );

  const page = parseInt(searchParams.get("page") || "1", 10);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String((page - 1) * PAGE_SIZE));
      params.set("take", String(PAGE_SIZE));
      if (statusFilter) params.set("status", statusFilter);
      if (zoneFilter) params.set("zone", zoneFilter);
      if (searchQuery) params.set("q", searchQuery);

      const data = await apiClient.get<{
        inventory: InventoryUnit[];
        total: number;
      }>(`/inventory?${params}`);
      setInventory(data.inventory);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, zoneFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiClient.get<InventoryStats>("/inventory/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
    fetchStats();
  }, [fetchInventory, fetchStats]);

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
    fetchInventory();
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
  // Helper to get damaged quantity
  // ============================================================================

  const getDamagedQuantity = (): number => {
    if (!stats?.byStatus) return 0;
    const damaged = stats.byStatus.find((s) => s.status === "DAMAGED");
    return damaged?.quantity ?? 0;
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Warehouse className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold">Inventory</h1>
            <p className="text-gray-500 text-sm">
              {(stats?.totalQuantity ?? 0).toLocaleString()} units across{" "}
              {(stats?.totalUnits ?? 0).toLocaleString()} locations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/inventory/receive"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex 
            items-center gap-2 transition"
          >
            <Package className="w-4 h-4" />
            Receive
          </Link>
          <Link
            to="/inventory/locations"
            className="px-4 py-2 border border-border rounded-lg hover:bg-gray-50 flex 
            items-center gap-2 transition"
          >
            <MapPin className="w-4 h-4" />
            Locations
          </Link>
          <button
            onClick={handleRefresh}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            label="Total"
            value={stats.totalQuantity ?? 0}
            onClick={() => handleStatusFilter("")}
            active={!statusFilter}
          />
          <StatCard
            label="Available"
            value={stats.availableQuantity ?? 0}
            color="green"
            onClick={() => handleStatusFilter("AVAILABLE")}
            active={statusFilter === "AVAILABLE"}
          />
          <StatCard
            label="Reserved"
            value={stats.reservedQuantity ?? 0}
            color="blue"
            onClick={() => handleStatusFilter("RESERVED")}
            active={statusFilter === "RESERVED"}
          />
          <StatCard
            label="Damaged"
            value={getDamagedQuantity()}
            color="red"
            onClick={() => handleStatusFilter("DAMAGED")}
            active={statusFilter === "DAMAGED"}
          />
          <StatCard
            label="Expiring"
            value={stats.expiringCount ?? 0}
            color="yellow"
            onClick={() => {}}
            active={false}
            subtitle="Next 30 days"
          />
        </div>
      )}

      {/* Imports and Sync */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProductImportCard />
        <LocationImportCard />
      </div>
      <div className="my-6">
        <InventoryPlannerSyncCard />
      </div>

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
                placeholder="Search by SKU, name, barcode, lot number, location..."
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
              />
            </div>
          </form>

          {/* Zone Filter */}
          <select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value);
              const params = new URLSearchParams(searchParams);
              if (e.target.value) {
                params.set("zone", e.target.value);
              } else {
                params.delete("zone");
              }
              params.set("page", "1");
              setSearchParams(params);
            }}
            className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-green-500 focus:outline-none"
          >
            <option value="">All Zones</option>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
            <option value="RECEIVING">Receiving</option>
            <option value="SHIPPING">Shipping</option>
          </select>
        </div>
      </div>

      {/* Low Stock Alert */}
      {stats && stats.lowStockCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <span className="font-semibold text-yellow-800">
              {stats.lowStockCount} items with low stock (≤5 units)
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Inventory Table */}
      <div className="bg-white border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                SKU / Product
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Location
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">
                Qty
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Status
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Lot / Expiry
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">
                Received
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={6} />
              ))
            ) : inventory.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-gray-500"
                >
                  <Box className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No inventory found</p>
                </td>
              </tr>
            ) : (
              inventory.map((unit) => (
                <tr key={unit.id} className="hover:bg-gray-50 border-border">
                  <td className="px-4 py-3">
                    <Link
                      to={`/inventory/${unit.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {unit.productVariant.sku}
                    </Link>
                    <div className="text-sm text-gray-500 truncate max-w-xs">
                      {unit.productVariant.name}
                    </div>
                    {unit.productVariant.product?.brand && (
                      <div className="text-xs text-gray-400">
                        {unit.productVariant.product.brand}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {unit.location ? (
                      <>
                        <Link
                          to={`/inventory/locations/${unit.location.id}`}
                          className="font-medium hover:text-blue-600"
                        >
                          {unit.location.name}
                        </Link>
                        {unit.location.zone && (
                          <div className="text-xs text-gray-400">
                            Zone {unit.location.zone}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">Unassigned</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-lg ${
                        unit.quantity <= 0
                          ? "text-red-500 font-semibold"
                          : unit.quantity < 200
                            ? "text-orange-500 font-semibold"
                            : "text-gray-900"
                      }`}
                    >
                      {unit.quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={unit.status} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {unit.lotNumber && (
                      <div className="font-mono text-xs">{unit.lotNumber}</div>
                    )}
                    {unit.expiryDate && (
                      <div
                        className={`flex items-center gap-1 text-xs ${
                          new Date(unit.expiryDate) <
                          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                            ? "text-red-600"
                            : "text-gray-500"
                        }`}
                      >
                        <Calendar className="w-3 h-3" />
                        {new Date(unit.expiryDate).toLocaleDateString()}
                      </div>
                    )}
                    {!unit.lotNumber && !unit.expiryDate && (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(unit.receivedAt).toLocaleDateString()}
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
// Stat Card Component
// ============================================================================

function StatCard({
  label,
  value,
  color = "gray",
  onClick,
  active,
  subtitle,
}: {
  label: string;
  value: number;
  color?: string;
  onClick: () => void;
  active: boolean;
  subtitle?: string;
}) {
  const colors: Record<string, string> = {
    gray: "text-gray-600",
    green: "text-green-600",
    blue: "text-blue-600",
    red: "text-red-600",
    yellow: "text-yellow-600",
  };

  // Ensure value is a number and default to 0 if undefined/null
  const safeValue = typeof value === "number" ? value : 0;

  return (
    <button
      onClick={onClick}
      className={`bg-white border border-border rounded-lg p-4 text-left hover:shadow-md transition-shadow ${
        active ? "ring-2 ring-green-500" : ""
      }`}
    >
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${colors[color]}`}>
        {safeValue.toLocaleString()}
      </div>
      {subtitle && <div className="text-xs text-gray-400">{subtitle}</div>}
    </button>
  );
}

export { InventoryPage };
