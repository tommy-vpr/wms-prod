/**
 * Locations Dashboard with Pagination
 *
 * Save to: apps/web/src/pages/locations/index.tsx
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  MapPin,
  Search,
  Grid3X3,
  Loader2,
  ChevronRight,
  LayoutGrid,
  List,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Pagination } from "@/components/layout/Pagination";

const PAGE_SIZE = 50;

interface Location {
  id: string;
  name: string;
  barcode: string | null;
  type: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  pickSequence: number | null;
  isPickable: boolean;
  active: boolean;
}

interface LocationWithInventory extends Location {
  _count?: {
    inventoryUnits: number;
  };
  totalQuantity?: number;
}

interface LocationStats {
  total: number;
  active: number;
  byZone: Record<string, number>;
  byType: Record<string, number>;
  withInventory: number;
}

export default function LocationsPage() {
  const [locations, setLocations] = useState<LocationWithInventory[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<LocationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [zones, setZones] = useState<string[]>([]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [zoneFilter]);

  // Load stats and zones once
  useEffect(() => {
    loadStats();
  }, []);

  // Load locations with pagination
  useEffect(() => {
    loadLocations();
  }, [page, debouncedSearch, zoneFilter]);

  const loadStats = async () => {
    try {
      // Load all locations just for stats (could be a separate endpoint)
      const data = await apiClient.get<{
        locations: LocationWithInventory[];
        total: number;
      }>("/locations?take=1000");

      const allLocations = data.locations;

      // Calculate stats
      const zoneSet: Record<string, number> = {};
      const types: Record<string, number> = {};
      let activeCount = 0;
      let withInventory = 0;

      allLocations.forEach((loc) => {
        if (loc.active) activeCount++;
        if (loc.zone) zoneSet[loc.zone] = (zoneSet[loc.zone] || 0) + 1;
        types[loc.type] = (types[loc.type] || 0) + 1;
        if ((loc._count?.inventoryUnits || 0) > 0) withInventory++;
      });

      setStats({
        total: data.total,
        active: activeCount,
        byZone: zoneSet,
        byType: types,
        withInventory,
      });

      // Set zones for filter dropdown
      setZones(Object.keys(zoneSet).sort());
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  const loadLocations = async () => {
    try {
      setLoading(true);

      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams({
        take: PAGE_SIZE.toString(),
        skip: offset.toString(),
      });

      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      if (zoneFilter) {
        params.set("zone", zoneFilter);
      }

      const data = await apiClient.get<{
        locations: LocationWithInventory[];
        total: number;
      }>(`/locations?${params.toString()}`);

      setLocations(data.locations);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to load locations:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="w-7 h-7" />
            Locations
          </h1>
          <p className="text-gray-500">Manage warehouse locations</p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-border rounded-lg p-4">
            <div className="text-sm text-gray-500">Total Locations</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-white border border-border rounded-lg p-4">
            <div className="text-sm text-gray-500">Active</div>
            <div className="text-2xl font-bold text-green-600">
              {stats.active}
            </div>
          </div>
          <div className="bg-white border border-border rounded-lg p-4">
            <div className="text-sm text-gray-500">Zones</div>
            <div className="text-2xl font-bold">
              {Object.keys(stats.byZone).length}
            </div>
          </div>
          <div className="bg-white border border-border rounded-lg p-4">
            <div className="text-sm text-gray-500">With Inventory</div>
            <div className="text-2xl font-bold text-blue-600">
              {stats.withInventory}
            </div>
          </div>
        </div>
      )}

      {/* Zone breakdown */}
      {stats && Object.keys(stats.byZone).length > 0 && (
        <div className="bg-white border border-border rounded-lg p-4 mb-6">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <Grid3X3 className="w-4 h-4" />
            Locations by Zone
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byZone)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([zone, count]) => (
                <button
                  key={zone}
                  onClick={() => setZoneFilter(zoneFilter === zone ? "" : zone)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    zoneFilter === zone
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Zone {zone}: {count}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white border border-border rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search locations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Zones</option>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  Zone {zone}
                </option>
              ))}
            </select>
            <div className="flex border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 ${
                  viewMode === "list"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 ${
                  viewMode === "grid"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Locations List/Grid */}
          {viewMode === "list" ? (
            <div className="bg-white border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                      Location
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                      Zone
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                      Aisle / Rack / Shelf
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                      Pick Seq
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                      Type
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                      Status
                    </th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y border-border">
                  {locations.map((location) => (
                    <tr
                      key={location.id}
                      className="hover:bg-gray-50 border-border"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">{location.name}</span>
                        </div>
                        {location.barcode && (
                          <div className="text-xs text-gray-400 ml-6">
                            {location.barcode}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {location.zone ? (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm">
                            {location.zone}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {[location.aisle, location.rack, location.shelf]
                          .filter(Boolean)
                          .join(" / ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {location.pickSequence ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">
                          {location.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            location.active
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {location.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/locations/${location.id}`}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {locations.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No locations found
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {locations.map((location) => (
                <Link
                  key={location.id}
                  to={`/locations/${location.id}`}
                  className="bg-white border border-border rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-400" />
                      <span className="font-medium text-sm">
                        {location.name}
                      </span>
                    </div>
                    {location.zone && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                        {location.zone}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    {location.aisle && <div>Aisle: {location.aisle}</div>}
                    {location.rack && <div>Rack: {location.rack}</div>}
                    {location.shelf && <div>Shelf: {location.shelf}</div>}
                  </div>
                  <div className="mt-3 pt-2 border-t border-border flex items-center justify-between">
                    <span
                      className={`text-xs ${
                        location.active ? "text-green-600" : "text-gray-400"
                      }`}
                    >
                      {location.active ? "Active" : "Inactive"}
                    </span>
                    <span className="text-xs text-gray-400">
                      #{location.pickSequence || "-"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}
