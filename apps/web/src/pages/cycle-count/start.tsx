/**
 * Start Cycle Count - Server-side Pagination
 *
 * Save to: apps/web/src/pages/cycle-count/start.tsx
 */

import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  MapPin,
  Search,
  Loader2,
  Scan,
  Package,
  Eye,
  EyeOff,
  RefreshCw,
  ScanBarcode,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";
import { Pagination } from "../../components/layout/Pagination";

const PAGE_SIZE = 50;

interface Location {
  id: string;
  name: string;
  barcode: string | null;
  type: string;
  zone: string | null;
  _count: { inventoryUnits: number };
}

export default function StartCycleCountPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const taskId = searchParams.get("taskId");

  const [locations, setLocations] = useState<Location[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(
    null,
  );
  const [blindCount, setBlindCount] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 on search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch locations (server-side pagination)
  useEffect(() => {
    const fetchLocations = async () => {
      setIsLoading(true);
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const searchParam = debouncedSearch
          ? `&search=${encodeURIComponent(debouncedSearch)}`
          : "";

        const res = await apiClient.get<{
          locations: Location[];
          total: number;
        }>(
          `/cycle-count/locations?type=STORAGE,RECEIVING&limit=${PAGE_SIZE}&offset=${offset}${searchParam}`,
        );

        setLocations(res.locations || []);
        setTotal(res.total || 0);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLocations();
  }, [page, debouncedSearch]);

  const handleStartCount = async () => {
    if (!selectedLocation) return;

    setIsStarting(true);
    setError(null);

    try {
      const res = await apiClient.post<{ session: { id: string } }>(
        "/cycle-count/sessions/start",
        {
          taskId: taskId || undefined,
          locationId: selectedLocation.id,
          blindCount,
        },
      );

      navigate(`/cycle-count/session/${res.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setIsStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate("/cycle-count")}
            className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">Start Count</h1>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search locations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Scan Prompt */}
      <div className="bg-blue-50 border-b border-blue-100 p-4 text-center">
        <ScanBarcode className="w-8 h-8 text-blue-500 mx-auto mb-2" />
        <p className="text-blue-900 font-medium text-sm">
          Scan location barcode or select below
        </p>
      </div>

      {/* Blind Count Toggle */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <button
          onClick={() => setBlindCount(!blindCount)}
          className="cursor-pointer flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-3">
            {blindCount ? (
              <EyeOff className="w-5 h-5 text-gray-500" />
            ) : (
              <Eye className="w-5 h-5 text-gray-500" />
            )}
            <div className="text-left">
              <p className="font-medium text-gray-900">Blind Count</p>
              <p className="text-sm text-gray-500">
                {blindCount
                  ? "System quantities hidden"
                  : "System quantities visible"}
              </p>
            </div>
          </div>
          <div
            className={cn(
              "w-11 h-6 rounded-full transition-colors",
              blindCount ? "bg-blue-600" : "bg-gray-300",
            )}
          >
            <div
              className={cn(
                "w-5 h-5 bg-white rounded-full shadow transition-transform mt-0.5",
                blindCount ? "translate-x-5 ml-0.5" : "translate-x-0.5",
              )}
            />
          </div>
        </button>
      </div>

      {/* Location List */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {locations.map((location) => (
                <button
                  key={location.id}
                  onClick={() => setSelectedLocation(location)}
                  className={cn(
                    "cursor-pointer w-full bg-white rounded-lg p-3 text-left border transition-all",
                    selectedLocation?.id === location.id
                      ? "border-blue-500 ring-2 ring-blue-100"
                      : "border-gray-200 hover:border-blue-300",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">
                        {location.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {location.zone || "No zone"} •{" "}
                        {location._count.inventoryUnits} items
                      </p>
                    </div>

                    {/* Only show button on THE selected location */}
                    {selectedLocation?.id === location.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent parent button click
                          handleStartCount();
                        }}
                        disabled={isStarting}
                        className="cursor-pointer transition px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50 text-sm"
                      >
                        {isStarting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <ScanBarcode className="w-4 h-4" />
                            Start
                          </>
                        )}
                      </button>
                    ) : (
                      location._count.inventoryUnits > 0 && (
                        <Package className="w-5 h-5 text-gray-400" />
                      )
                    )}
                  </div>
                </button>
              ))}

              {locations.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No locations found
                </div>
              )}
            </div>

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

      {/* Bottom Action */}
      {/* {selectedLocation && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
          <button
            onClick={handleStartCount}
            disabled={isStarting}
            className="w-full py-4 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isStarting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <ScanBarcode className="w-5 h-5" />
                Start Counting {selectedLocation.name}
              </>
            )}
          </button>
        </div>
      )} */}
    </div>
  );
}
