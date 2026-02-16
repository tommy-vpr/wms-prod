/**
 * Start Receiving Page - Production Version
 *
 * Save to: apps/web/src/pages/receiving/start.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  Truck,
  Calendar,
  AlertTriangle,
  Loader2,
  CheckCircle,
  MapPin,
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
}

interface Location {
  id: string;
  name: string;
  barcode: string | null;
  type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function StartReceivingPage() {
  const navigate = useNavigate();
  const { poId } = useParams<{ poId: string }>();

  const [po, setPO] = useState<PurchaseOrder | null>(null);
  const [existingSession, setExistingSession] = useState<{
    id: string;
    status: string;
  } | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch PO and locations
  const fetchData = useCallback(async () => {
    console.log("fetchData called, poId:", poId);
    if (!poId) return;

    try {
      // Fetch PO first
      console.log("Calling API...");

      const poRes = await apiClient.get<{
        purchaseOrder: PurchaseOrder;
        receivingSession: { id: string; status: string } | null;
      }>(`/receiving/inventory-planner/purchase-orders/${poId}`);

      setPO(poRes.purchaseOrder);
      setExistingSession(poRes.receivingSession);

      // Try locations separately (don't fail if this errors)
      try {
        const locationsRes = await apiClient.get<{ locations: Location[] }>(
          "/locations",
        );
        const allLocs = locationsRes.locations || [];
        const receivingLocs = allLocs.filter((l) => l.type === "RECEIVING");
        const storageLocs = allLocs.filter((l) => l.type === "STORAGE");
        const availableLocs =
          receivingLocs.length > 0 ? receivingLocs : storageLocs;

        setLocations(availableLocs);
        if (availableLocs.length > 0) {
          setSelectedLocationId(availableLocs[0].id);
        }

        console.log("PO Response:", poRes);
      } catch (locErr) {
        console.warn("Could not fetch locations:", locErr);
        // Continue without locations
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setError((err as Error).message || "Failed to load purchase order");
    } finally {
      setIsLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStart = async () => {
    if (!po || isStarting) return;

    setIsStarting(true);
    setError(null);

    try {
      const result = await apiClient.post<{ session: { id: string } }>(
        "/receiving/start",
        {
          poId: po.id,
          poReference: po.reference || po.id,
          vendor: po.vendor,
          receivingLocationId: selectedLocationId || undefined,
          expectedItems: po.items.map((item) => ({
            sku: item.sku,
            productName: item.productName || item.sku,
            quantity: item.quantity,
          })),
        },
      );

      navigate(`/receiving/session/${result.session.id}`, { replace: true });
    } catch (err) {
      console.error("Failed to start session:", err);
      setError((err as Error).message || "Failed to start session");
      setIsStarting(false);
    }
  };

  const handleContinue = () => {
    if (existingSession?.id) {
      if (existingSession.status === "SUBMITTED") {
        navigate(`/receiving/approve/${existingSession.id}`, { replace: true });
      } else {
        navigate(`/receiving/session/${existingSession.id}`, { replace: true });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error && !po) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="bg-white rounded-lg p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Purchase Order Not Found
          </h2>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => navigate("/receiving/purchase-orders")}
            className="text-blue-600 font-medium"
          >
            ← Back to Purchase Orders
          </button>
        </div>
      </div>
    );
  }

  if (!po) return null;

  const totalItems = po.items?.length || 0;
  const totalUnits =
    po.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/receiving/purchase-orders")}
              className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {po.reference || po.id}
              </h1>
              {po.vendor && (
                <p className="text-sm text-gray-500">{po.vendor}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Existing Session Alert */}
        {existingSession && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-yellow-800">
                  Existing Session Found
                </h3>
                <p className="text-sm text-yellow-700 mt-1">
                  A receiving session for this PO is already{" "}
                  {existingSession.status === "IN_PROGRESS"
                    ? "in progress"
                    : existingSession.status === "SUBMITTED"
                      ? "pending approval"
                      : existingSession.status.toLowerCase()}
                  .
                </p>
                <button
                  onClick={handleContinue}
                  className="mt-3 text-sm font-medium text-yellow-800 underline"
                >
                  {existingSession.status === "SUBMITTED"
                    ? "Review Approval →"
                    : "Continue Existing Session →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PO Summary */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
          <h2 className="font-semibold text-gray-900 mb-4">Order Summary</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Total Items
              </span>
              <span className="font-medium text-gray-900">{totalItems}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Total Units
              </span>
              <span className="font-medium text-gray-900">{totalUnits}</span>
            </div>
            {po.expectedDate && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Expected Date
                </span>
                <span className="font-medium text-gray-900">
                  {new Date(po.expectedDate).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Receiving Location */}
        {locations.length > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Receiving Location
            </h2>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} {loc.barcode ? `(${loc.barcode})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Items Preview */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Items to Receive</h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
            {po.items?.map((item, idx) => (
              <div key={idx} className="p-4 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">
                    {item.sku}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    {item.productName}
                  </p>
                </div>
                <div className="ml-4 text-right">
                  <span className="text-lg font-semibold text-gray-900">
                    {item.quantity}
                  </span>
                  <span className="text-sm text-gray-500 ml-1">units</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">Instructions</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Scan or manually count each item as you receive it</li>
            <li>• Use the +1, +5, +20, +100 buttons for quick counting</li>
            <li>• Report any damaged items using the exception button</li>
            <li>• Submit for approval when complete</li>
            <li>• Variances will be flagged for review</li>
          </ul>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4">
        <button
          onClick={existingSession ? handleContinue : handleStart}
          disabled={isStarting}
          className={cn(
            "cursor-pointer ml-auto w-full md:w-fit py-4 px-6 rounded-lg font-semibold text-lg flex items-center justify-center gap-2 transition-colors",
            existingSession
              ? "bg-yellow-500 text-white hover:bg-yellow-600 active:bg-yellow-700"
              : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
            isStarting && "opacity-50 cursor-not-allowed",
          )}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Starting...
            </>
          ) : existingSession ? (
            <>
              {existingSession.status === "SUBMITTED"
                ? "Review Approval"
                : "Continue Session"}
            </>
          ) : (
            <>Start Receiving</>
          )}
        </button>
      </div>
    </div>
  );
}
