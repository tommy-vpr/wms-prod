/**
 * Inventory Detail Page
 * View and manage a single inventory unit
 *
 * Save to: apps/web/src/pages/inventory/[id].tsx
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  MapPin,
  Calendar,
  AlertCircle,
  CheckCircle,
  Loader2,
  Edit,
  Trash2,
  Move,
  AlertTriangle,
  RefreshCw,
  Box,
  Barcode,
  DollarSign,
  Clock,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Loading } from "@/components/ui/loading";

// Allocation status helper
function getAllocationDisplayStatus(allocStatus: string, orderStatus?: string) {
  if (allocStatus === "RELEASED") return "RELEASED";

  if (orderStatus === "SHIPPED") return "SHIPPED";
  if (orderStatus === "PACKED") return "PACKED";

  return allocStatus; // ALLOCATED / PICKED
}

// ============================================================================
// Types
// ============================================================================

interface InventoryUnitDetail {
  id: string;
  quantity: number;
  status: string;
  lotNumber: string | null;
  expiryDate: string | null;
  receivedAt: string;
  receivedFrom: string | null;
  unitCost: number | null;
  createdAt: string;
  updatedAt: string;
  productVariant: {
    id: string;
    sku: string;
    name: string;
    barcode: string | null;
    product: {
      id: string;
      name: string;
      brand: string | null;
      category: string | null;
    };
  };
  location: {
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
  } | null;
  allocations: Array<{
    id: string;
    quantity: number;
    status: string;
    order?: {
      id: string;
      orderNumber: string;
      status: string;
    };
  }>;
}

interface Location {
  id: string;
  name: string;
  zone: string | null;
}

// ============================================================================
// Main Component
// ============================================================================

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [unit, setUnit] = useState<InventoryUnitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Modal states
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showDamageModal, setShowDamageModal] = useState(false);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchUnit = async () => {
    if (!id) return;

    setLoading(true);
    setError("");

    try {
      const data = await apiClient.get<InventoryUnitDetail>(`/inventory/${id}`);
      setUnit(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnit();
  }, [id]);

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
        <Link
          to="/inventory"
          className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Inventory
        </Link>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <Box className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">Inventory unit not found</p>
        </div>
      </div>
    );
  }

  if (!unit.productVariant) {
    return (
      <div className="p-6 text-center text-gray-500">
        Product variant missing for this inventory unit
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    AVAILABLE: "bg-green-100 text-green-800",
    RESERVED: "bg-blue-100 text-blue-800",
    PICKED: "bg-purple-100 text-purple-800",
    DAMAGED: "bg-red-100 text-red-800",
    IN_TRANSIT: "bg-yellow-100 text-yellow-800",
    QUARANTINE: "bg-orange-100 text-orange-800",
  };

  const isExpiringSoon =
    unit.expiryDate &&
    new Date(unit.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/inventory"
            className="p-2 hover:bg-gray-100 rounded-lg"
            title="Back to Inventory"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{unit.productVariant.sku}</h1>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  statusColors[unit.status] || "bg-gray-100 text-gray-800"
                }`}
              >
                {unit.status}
              </span>
            </div>
            <p className="text-gray-500">{unit.productVariant.name}</p>
          </div>
        </div>

        <button
          onClick={fetchUnit}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

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

      {/* Expiring Warning */}
      {isExpiringSoon && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-yellow-800">
          <AlertTriangle className="w-5 h-5" />
          This inventory is expiring soon:{" "}
          {new Date(unit.expiryDate!).toLocaleDateString()}
        </div>
      )}

      {/* Actions */}
      {unit.status === "AVAILABLE" && (
        <div className="bg-white border border-border rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-3">Actions</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowAdjustModal(true)}
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-gray-50"
            >
              <Edit className="w-4 h-4" />
              Adjust Quantity
            </button>
            <button
              onClick={() => setShowMoveModal(true)}
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-gray-50"
            >
              <Move className="w-4 h-4" />
              Move Location
            </button>
            <button
              onClick={() => setShowDamageModal(true)}
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              <AlertTriangle className="w-4 h-4" />
              Mark Damaged
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quantity & Status */}
        <div className="bg-white border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-4">Inventory Details</h2>
          <div
            className={`text-center mb-6 p-4 rounded-xl transition-colors ${unit.quantity < 0 ? "bg-red-50" : "bg-transparent"}`}
          >
            <div
              className={`text-3xl ${unit.quantity < 0 ? "text-red-600" : "text-green-600"}`}
            >
              {unit.quantity}
            </div>
            <div
              className={`${unit.quantity < 0 ? "text-red-500" : "text-gray-500"}`}
            >
              {unit.quantity < 0 ? "units oversold" : "units in stock"}
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <span
                className={`px-2 py-1 rounded-full text-xs ${
                  statusColors[unit.status] || "bg-gray-100"
                }`}
              >
                {unit.status}
              </span>
            </div>
            {unit.lotNumber && (
              <div className="flex justify-between">
                <span className="text-gray-500">Lot Number</span>
                <span className="font-mono">{unit.lotNumber}</span>
              </div>
            )}
            {unit.expiryDate && (
              <div className="flex justify-between">
                <span className="text-gray-500">Expiry Date</span>
                <span
                  className={isExpiringSoon ? "text-red-600 font-medium" : ""}
                >
                  {new Date(unit.expiryDate).toLocaleDateString()}
                </span>
              </div>
            )}
            {unit.unitCost && (
              <div className="flex justify-between">
                <span className="text-gray-500">Unit Cost</span>
                <span>${Number(unit.unitCost).toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Location */}
        <div className="bg-white border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Location
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              {unit.location ? (
                <Link
                  to={`/inventory/locations/${unit.location?.id}`}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {unit.location.name}
                </Link>
              ) : (
                <span className="text-gray-400">Unassigned</span>
              )}
            </div>
            {unit.location?.zone && (
              <div className="flex justify-between">
                <span className="text-gray-500">Zone</span>
                <span>{unit.location.zone}</span>
              </div>
            )}
            {unit.location?.aisle && (
              <div className="flex justify-between">
                <span className="text-gray-500">Aisle</span>
                <span>{unit.location.aisle}</span>
              </div>
            )}
            {unit.location?.rack && (
              <div className="flex justify-between">
                <span className="text-gray-500">Rack</span>
                <span>{unit.location.rack}</span>
              </div>
            )}
            {unit.location?.shelf && (
              <div className="flex justify-between">
                <span className="text-gray-500">Shelf</span>
                <span>{unit.location.shelf}</span>
              </div>
            )}
            {unit.location?.bin && (
              <div className="flex justify-between">
                <span className="text-gray-500">Bin</span>
                <span>{unit.location.bin}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span>{unit.location?.type}</span>
            </div>
            {unit.location?.pickSequence && (
              <div className="flex justify-between">
                <span className="text-gray-500">Pick Sequence</span>
                <span>{unit.location.pickSequence}</span>
              </div>
            )}
          </div>
        </div>

        {/* Product Info */}
        <div className="bg-white border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Package className="w-4 h-4" />
            Product
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">SKU</span>
              {unit.productVariant.product ? (
                <Link
                  to={`/products/${unit.productVariant.product.id}`}
                  className="text-blue-600 hover:underline font-mono"
                >
                  {unit.productVariant.sku}
                </Link>
              ) : (
                <span className="font-mono text-gray-400">
                  {unit.productVariant.sku}
                </span>
              )}
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="text-right max-w-xs truncate">
                {unit.productVariant.name}
              </span>
            </div>
            {unit.productVariant.barcode && (
              <div className="flex justify-between">
                <span className="text-gray-500">Barcode</span>
                <span className="font-mono">{unit.productVariant.barcode}</span>
              </div>
            )}
            {unit.productVariant.product?.brand && (
              <div className="flex justify-between">
                <span className="text-gray-500">Brand</span>
                <span>{unit.productVariant.product.brand}</span>
              </div>
            )}
            {unit.productVariant.product?.category && (
              <div className="flex justify-between">
                <span className="text-gray-500">Category</span>
                <span>{unit.productVariant.product.category}</span>
              </div>
            )}
          </div>
        </div>

        {/* Receipt Info */}
        <div className="bg-white border border-border rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Receipt Info
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Received At</span>
              <span>{new Date(unit.receivedAt).toLocaleString()}</span>
            </div>
            {unit.receivedFrom && (
              <div className="flex justify-between">
                <span className="text-gray-500">Received From</span>
                <span>{unit.receivedFrom}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Created</span>
              <span>{new Date(unit.createdAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Last Updated</span>
              <span>{new Date(unit.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Allocations */}
      {unit.allocations && unit.allocations.length > 0 && (
        <div className="bg-white border border-border rounded-lg p-6 mt-6">
          <h2 className="font-semibold mb-4">Active Allocations</h2>
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left py-2 text-sm font-medium text-gray-500">
                  Order
                </th>
                <th className="text-center py-2 text-sm font-medium text-gray-500">
                  Quantity
                </th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {unit.allocations.map((alloc) => {
                const displayStatus = getAllocationDisplayStatus(
                  alloc.status,
                  alloc.order?.status,
                );

                return (
                  <tr key={alloc.id} className="border-border">
                    <td className="py-2">
                      {alloc.order ? (
                        <>
                          <Link
                            to={`/orders/${alloc.order?.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {alloc.order.orderNumber}
                          </Link>
                          <div className="text-xs text-gray-400">
                            {alloc.order.status}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-2 text-center font-medium">
                      {alloc.quantity}
                    </td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700`}
                      >
                        {displayStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust Quantity Modal */}
      {showAdjustModal && (
        <AdjustModal
          unit={unit}
          onClose={() => setShowAdjustModal(false)}
          onSuccess={() => {
            setShowAdjustModal(false);
            setActionMessage({ type: "success", text: "Quantity adjusted" });
            fetchUnit();
          }}
        />
      )}

      {/* Move Location Modal */}
      {showMoveModal && (
        <MoveModal
          unit={unit}
          onClose={() => setShowMoveModal(false)}
          onSuccess={() => {
            setShowMoveModal(false);
            setActionMessage({ type: "success", text: "Inventory moved" });
            fetchUnit();
          }}
        />
      )}

      {/* Mark Damaged Modal */}
      {showDamageModal && (
        <DamageModal
          unit={unit}
          onClose={() => setShowDamageModal(false)}
          onSuccess={() => {
            setShowDamageModal(false);
            setActionMessage({ type: "success", text: "Marked as damaged" });
            fetchUnit();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Modals
// ============================================================================

function AdjustModal({
  unit,
  onClose,
  onSuccess,
}: {
  unit: InventoryUnitDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [newQuantity, setNewQuantity] = useState(unit.quantity);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError("Reason is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await apiClient.post(`/inventory/${unit.id}/adjust`, {
        newQuantity,
        reason,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Adjust Quantity" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">
            Current Quantity: {unit.quantity}
          </label>
          <input
            type="number"
            value={newQuantity}
            onChange={(e) => setNewQuantity(Number(e.target.value))}
            min={0}
            className="w-full px-3 py-2 border border-border rounded-lg"
          />
          <p className="text-sm text-gray-500 mt-1">
            Adjustment: {newQuantity - unit.quantity > 0 ? "+" : ""}
            {newQuantity - unit.quantity}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Reason *</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">Select reason...</option>
            <option value="Cycle count">Cycle count</option>
            <option value="Inventory audit">Inventory audit</option>
            <option value="Received more">Received more</option>
            <option value="Found missing">Found missing</option>
            <option value="Data correction">Data correction</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveModal({
  unit,
  onClose,
  onSuccess,
}: {
  unit: InventoryUnitDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocationId, setNewLocationId] = useState("");
  const [quantity, setQuantity] = useState(unit.quantity);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .get<{ locations: Location[] }>("/inventory/locations?active=true")
      .then((data) => setLocations(data.locations))
      .catch(console.error);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocationId) {
      setError("Select a location");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await apiClient.post(`/inventory/${unit.id}/move`, {
        newLocationId,
        quantity: quantity < unit.quantity ? quantity : undefined,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Move Inventory" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">
            Current Location: {unit.location?.name}
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            New Location *
          </label>
          <select
            value={newLocationId}
            onChange={(e) => setNewLocationId(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg"
          >
            <option value="">Select location...</option>
            {locations
              .filter((l) => l.id !== unit.location?.id)
              .map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} {loc.zone ? `(Zone ${loc.zone})` : ""}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Quantity to Move (max: {unit.quantity})
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            min={1}
            max={unit.quantity}
            className="w-full px-3 py-2 border border-border rounded-lg"
          />
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Moving..." : "Move"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DamageModal({
  unit,
  onClose,
  onSuccess,
}: {
  unit: InventoryUnitDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [quantity, setQuantity] = useState(unit.quantity);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError("Reason is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await apiClient.post(`/inventory/${unit.id}/damage`, {
        quantity: quantity < unit.quantity ? quantity : undefined,
        reason,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Mark as Damaged" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          This action will mark inventory as damaged and remove it from
          available stock.
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Quantity to Mark Damaged (max: {unit.quantity})
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            min={1}
            max={unit.quantity}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Reason *</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg"
          >
            <option value="">Select reason...</option>
            <option value="Physical damage">Physical damage</option>
            <option value="Water damage">Water damage</option>
            <option value="Expired">Expired</option>
            <option value="Quality issue">Quality issue</option>
            <option value="Customer return - damaged">
              Customer return - damaged
            </option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Marking..." : "Mark Damaged"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Modal Wrapper
// ============================================================================

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export { InventoryDetailPage };
