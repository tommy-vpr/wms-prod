/**
 * Location Detail Page
 * View location details and inventory
 *
 * Save to: apps/web/src/pages/locations/[id].tsx
 */

import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  MapPin,
  ArrowLeft,
  Package,
  Loader2,
  Hash,
  Layers,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api";

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
  createdAt: string;
  updatedAt: string;
}

interface InventoryUnit {
  id: string;
  quantity: number;
  status: string;
  lotNumber: string | null;
  expiryDate: string | null;
  productVariant: {
    id: string;
    sku: string;
    name: string;
    product: {
      name: string;
      brand: string | null;
    };
  };
}

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [location, setLocation] = useState<Location | null>(null);
  const [inventory, setInventory] = useState<InventoryUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id) loadLocation();
  }, [id]);

  const loadLocation = async () => {
    try {
      setLoading(true);
      const [locData, invData] = await Promise.all([
        apiClient.get<Location>(`/locations/${id}`),
        apiClient.get<{ inventory: InventoryUnit[] }>(
          `/locations/${id}/inventory`,
        ),
      ]);

      setLocation(locData);
      setInventory(invData.inventory || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !location) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || "Location not found"}
        </div>
        <Link
          to="/locations"
          className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Locations
        </Link>
      </div>
    );
  }

  const totalQuantity = inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  const uniqueSkus = new Set(inventory.map((inv) => inv.productVariant.sku))
    .size;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/locations"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Locations
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <MapPin className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{location.name}</h1>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{location.type}</span>
              {location.zone && (
                <>
                  <span>•</span>
                  <span>Zone {location.zone}</span>
                </>
              )}
              <span>•</span>
              <span
                className={location.active ? "text-green-600" : "text-gray-400"}
              >
                {location.active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Location Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Properties */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="font-semibold mb-4">Location Details</h2>
            <dl className="space-y-3 text-sm">
              {location.barcode && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Barcode</dt>
                  <dd className="font-mono">{location.barcode}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Type</dt>
                <dd>{location.type}</dd>
              </div>
              {location.zone && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Zone</dt>
                  <dd>{location.zone}</dd>
                </div>
              )}
              {location.aisle && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Aisle</dt>
                  <dd>{location.aisle}</dd>
                </div>
              )}
              {location.rack && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Rack</dt>
                  <dd>{location.rack}</dd>
                </div>
              )}
              {location.shelf && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Shelf</dt>
                  <dd>{location.shelf}</dd>
                </div>
              )}
              {location.bin && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Bin</dt>
                  <dd>{location.bin}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Pick Sequence</dt>
                <dd>{location.pickSequence ?? "Not set"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Pickable</dt>
                <dd>
                  {location.isPickable ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-gray-400" />
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Stats */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h2 className="font-semibold mb-4">Inventory Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {uniqueSkus}
                </div>
                <div className="text-xs text-gray-500">SKUs</div>
              </div>
              <div
                className={`text-center p-3 rounded-lg ${totalQuantity < 0 ? "bg-red-50" : "bg-gray-50"}`}
              >
                <div
                  className={`text-2xl font-bold ${totalQuantity < 0 ? "text-red-600" : "text-green-600"}`}
                >
                  {totalQuantity}
                </div>
                <div
                  className={`text-xs ${totalQuantity < 0 ? "text-red-400" : "text-gray-500"}`}
                >
                  Total Qty
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Inventory at Location */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-border rounded-lg">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Package className="w-4 h-4" />
                Inventory at this Location
              </h2>
              <span className="text-sm text-gray-500">
                {inventory.length} items
              </span>
            </div>
            {inventory.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Package className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p>No inventory at this location</p>
              </div>
            ) : (
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {inventory.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-4 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/inventory/${inv.id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {inv.productVariant.sku}
                        </Link>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            inv.status === "AVAILABLE"
                              ? "bg-green-100 text-green-700"
                              : inv.status === "RESERVED"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 truncate">
                        {inv.productVariant.name}
                      </div>
                      {inv.productVariant.product.brand && (
                        <div className="text-xs text-gray-400">
                          {inv.productVariant.product.brand}
                        </div>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-lg font-semibold">
                        {inv.quantity}
                      </div>
                      <div className="text-xs text-gray-500">qty</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
