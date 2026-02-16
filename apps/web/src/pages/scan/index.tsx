/**
 * Scan Page - Universal Barcode Lookup
 *
 * Save to: apps/web/src/pages/scan/index.tsx
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Scan,
  Package,
  MapPin,
  AlertCircle,
  Loader2,
  Keyboard,
  X,
  ChevronRight,
  Box,
  RotateCcw,
  History,
  ScanBarcode,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProductResult {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  upc: string | null;
  barcode: string | null;
  imageUrl: string | null;
  inventory: {
    total: number;
    available: number;
    locations: Array<{
      locationId: string;
      locationName: string;
      quantity: number;
    }>;
  };
}

interface LocationResult {
  id: string;
  name: string;
  barcode: string | null;
  type: string;
  zone: string | null;
  itemCount: number;
}

interface ScanResult {
  type: "PRODUCT" | "LOCATION" | "UNKNOWN";
  barcode: string;
  product?: ProductResult;
  location?: LocationResult;
}

interface LocationInventory {
  variantId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
}

interface LocationDetails {
  found: boolean;
  barcode: string;
  location?: {
    id: string;
    name: string;
    barcode: string | null;
    type: string;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    bin: string | null;
    isPickable: boolean;
  };
  inventory?: LocationInventory[];
  totalItems?: number;
  totalQuantity?: number;
}

interface ScanHistoryItem {
  barcode: string;
  type: "PRODUCT" | "LOCATION" | "UNKNOWN";
  name: string;
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ScanPage() {
  const navigate = useNavigate();

  const [result, setResult] = useState<ScanResult | null>(null);
  const [locationDetails, setLocationDetails] =
    useState<LocationDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Barcode scanner buffer
  const scanBufferRef = useRef("");
  const [scanBufferDisplay, setScanBufferDisplay] = useState("");
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Scan Handler
  // ─────────────────────────────────────────────────────────────────────────

  const handleScan = useCallback(async (barcode: string) => {
    if (!barcode.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);
    setLocationDetails(null);

    try {
      const scanResult = await apiClient.post<ScanResult>("/scan", { barcode });
      setResult(scanResult);

      // Add to history
      const historyItem: ScanHistoryItem = {
        barcode,
        type: scanResult.type,
        name:
          scanResult.type === "PRODUCT"
            ? scanResult.product?.sku || barcode
            : scanResult.type === "LOCATION"
              ? scanResult.location?.name || barcode
              : barcode,
        timestamp: new Date(),
      };

      setScanHistory((prev) => [historyItem, ...prev.slice(0, 19)]);

      // If location, fetch detailed inventory
      if (scanResult.type === "LOCATION" && scanResult.location) {
        const details = await apiClient.get<LocationDetails>(
          `/scan/location/${encodeURIComponent(barcode)}`,
        );
        setLocationDetails(details);
      }

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(scanResult.type === "UNKNOWN" ? [100, 50, 100] : 100);
      }
    } catch (err) {
      setError((err as Error).message);
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard Scanner Listener
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (showManualInput) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "Enter") {
        const barcode = scanBufferRef.current;
        if (barcode) {
          handleScan(barcode);
          scanBufferRef.current = "";
          setScanBufferDisplay("");
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        scanBufferRef.current += e.key;
        setScanBufferDisplay(scanBufferRef.current);

        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = setTimeout(() => {
          scanBufferRef.current = "";
          setScanBufferDisplay("");
        }, 500);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, [showManualInput, handleScan]);

  // ─────────────────────────────────────────────────────────────────────────
  // Reset
  // ─────────────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setResult(null);
    setLocationDetails(null);
    setError(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">
            Product/Location Look Up
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "p-2 rounded-lg cursor-pointer transition",
                showHistory
                  ? "bg-blue-100 text-blue-600"
                  : "text-gray-500 hover:bg-gray-200",
              )}
            >
              <History className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowManualInput(true)}
              className="cursor-pointer p-2 text-gray-500 hover:bg-gray-200 rounded-lg transition"
            >
              <Keyboard className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scan Buffer Display */}
        {scanBufferDisplay && (
          <div className="px-4 py-2 bg-purple-100 text-purple-800 text-sm font-mono">
            Scanning: {scanBufferDisplay}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-100 text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}>
              <X className="cursor-pointer w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        ) : showHistory ? (
          <ScanHistoryView
            history={scanHistory}
            onSelect={(barcode) => {
              setShowHistory(false);
              handleScan(barcode);
            }}
            onClear={() => setScanHistory([])}
          />
        ) : result ? (
          <ScanResultView
            result={result}
            locationDetails={locationDetails}
            onReset={handleReset}
            onNavigate={navigate}
          />
        ) : (
          <ScanPrompt />
        )}
      </div>

      {/* Manual Input Modal */}
      {showManualInput && (
        <ManualInputModal
          onScan={(barcode) => {
            setShowManualInput(false);
            handleScan(barcode);
          }}
          onClose={() => setShowManualInput(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan Prompt (Initial State)
// ─────────────────────────────────────────────────────────────────────────────

function ScanPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mb-6">
        <ScanBarcode className="w-12 h-12 text-blue-600" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        Ready to Scan
      </h2>
      <p className="text-gray-500 text-center max-w-xs">
        Scan a product barcode, SKU, UPC, or location barcode to look up details
      </p>

      <div className="mt-8 flex gap-4">
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border-x-2 border-blue-300 px-4 py-2">
          <Package className="w-4 h-4" />
          <span>Products</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border-x-2 border-green-300 px-4 py-2">
          <MapPin className="w-4 h-4" />
          <span>Locations</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan Result View
// ─────────────────────────────────────────────────────────────────────────────

interface ScanResultViewProps {
  result: ScanResult;
  locationDetails: LocationDetails | null;
  onReset: () => void;
  onNavigate: (path: string) => void;
}

function ScanResultView({
  result,
  locationDetails,
  onReset,
  onNavigate,
}: ScanResultViewProps) {
  if (result.type === "UNKNOWN") {
    return (
      <div className="p-4">
        <div className="bg-white rounded-lg p-6 text-center">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-yellow-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Not Found
          </h2>
          <p className="text-gray-500 mb-4">
            No product or location found for:
          </p>
          <p className="font-mono bg-gray-100 px-4 py-2 rounded text-lg mb-6">
            {result.barcode}
          </p>
          <button
            onClick={onReset}
            className="cursor-pointer px-6 py-2 bg-blue-600 text-white rounded-lg font-medium"
          >
            Scan Again
          </button>
        </div>
      </div>
    );
  }

  if (result.type === "PRODUCT" && result.product) {
    return (
      <ProductResultCard
        product={result.product}
        barcode={result.barcode}
        onReset={onReset}
        onNavigate={onNavigate}
      />
    );
  }

  if (result.type === "LOCATION" && result.location) {
    return (
      <LocationResultCard
        location={result.location}
        details={locationDetails}
        barcode={result.barcode}
        onReset={onReset}
        onNavigate={onNavigate}
      />
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Product Result Card
// ─────────────────────────────────────────────────────────────────────────────

interface ProductResultCardProps {
  product: ProductResult;
  barcode: string;
  onReset: () => void;
  onNavigate: (path: string) => void;
}

function ProductResultCard({
  product,
  barcode,
  onReset,
  onNavigate,
}: ProductResultCardProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg p-4">
        <div className="flex items-center gap-2 text-green-600 text-sm font-medium mb-3">
          <Package className="w-4 h-4" />
          <span>Product Found</span>
        </div>

        <div className="flex gap-4">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-20 h-20 object-cover rounded-lg bg-gray-100"
            />
          ) : (
            <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
              <Package className="w-8 h-8 text-gray-400" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-lg">{product.sku}</p>
            <p className="text-gray-600 truncate">{product.name}</p>
            <p className="text-sm text-gray-400 font-mono mt-1">{barcode}</p>
          </div>
        </div>
      </div>

      {/* Inventory Summary */}
      <div className="bg-white rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Inventory</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">
              {product.inventory.total}
            </p>
            <p className="text-xs text-blue-600">Total</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">{product.inventory.available}</p>
            <p className="text-xs text-green-600">Available</p>
          </div>
        </div>

        {/* Locations */}
        {product.inventory.locations.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-500 font-medium">Locations</p>
            {product.inventory.locations.map((loc) => (
              <button
                key={loc.locationId}
                onClick={() => onNavigate(`/locations/${loc.locationId}`)}
                className="w-full flex items-center justify-between p-2 bg-gray-50 rounded-lg hover:bg-gray-100"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">
                    {loc.locationName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{loc.quantity}</span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-2">
            No inventory found
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="cursor-pointer flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Scan Again
        </button>
        <button
          onClick={() => onNavigate(`/products/${product.productId}`)}
          className="cursor-pointer flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
        >
          View Product
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Location Result Card
// ─────────────────────────────────────────────────────────────────────────────

interface LocationResultCardProps {
  location: LocationResult;
  details: LocationDetails | null;
  barcode: string;
  onReset: () => void;
  onNavigate: (path: string) => void;
}

function LocationResultCard({
  location,
  details,
  barcode,
  onReset,
  onNavigate,
}: LocationResultCardProps) {
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg p-4">
        <div className="flex items-center gap-2 text-blue-600 text-sm font-medium mb-3">
          <MapPin className="w-4 h-4" />
          <span>Location Found</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
            <MapPin className="w-8 h-8 text-blue-600" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-lg">{location.name}</p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="px-2 py-0.5 bg-gray-100 rounded">
                {location.type}
              </span>
              {location.zone && <span>Zone: {location.zone}</span>}
            </div>
            <p className="text-sm text-gray-400 font-mono mt-1">{barcode}</p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-lg p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-purple-600">
              {details?.totalItems || location.itemCount}
            </p>
            <p className="text-xs text-purple-600">SKUs</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-indigo-600">
              {details?.totalQuantity || 0}
            </p>
            <p className="text-xs text-indigo-600">Total Units</p>
          </div>
        </div>
      </div>

      {/* Inventory List */}
      {details?.inventory && details.inventory.length > 0 && (
        <div className="bg-white rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">
            Inventory ({details.inventory.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {details.inventory.map((item) => (
              <button
                key={item.variantId}
                onClick={() => onNavigate(`/products/${item.variantId}`)}
                className="cursor-pointer w-full flex items-center gap-3 p-2 bg-gray-50 rounded-lg hover:bg-gray-100"
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-10 h-10 object-cover rounded bg-gray-200"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                    <Box className="w-5 h-5 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.sku}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{item.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{item.quantity}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {details?.inventory?.length === 0 && (
        <div className="bg-white rounded-lg p-4 text-center text-gray-500">
          <Box className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p>No inventory at this location</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Scan Again
        </button>
        <button
          onClick={() => onNavigate(`/locations/${location.id}`)}
          className="cursor-pointer flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
        >
          View Location
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan History View
// ─────────────────────────────────────────────────────────────────────────────

interface ScanHistoryViewProps {
  history: ScanHistoryItem[];
  onSelect: (barcode: string) => void;
  onClear: () => void;
}

function ScanHistoryView({ history, onSelect, onClear }: ScanHistoryViewProps) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <History className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500">No scan history yet</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Recent Scans</h2>
        <button
          onClick={onClear}
          className="cursor-pointer text-sm text-red-600 hover:text-red-700"
        >
          Clear All
        </button>
      </div>

      <div className="space-y-2">
        {history.map((item, index) => (
          <button
            key={`${item.barcode}-${index}`}
            onClick={() => onSelect(item.barcode)}
            className="cursor-pointer w-full flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300"
          >
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                item.type === "PRODUCT"
                  ? "bg-green-100"
                  : item.type === "LOCATION"
                    ? "bg-blue-100"
                    : "bg-gray-100",
              )}
            >
              {item.type === "PRODUCT" ? (
                <Package className="w-5 h-5 text-green-600" />
              ) : item.type === "LOCATION" ? (
                <MapPin className="w-5 h-5 text-blue-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="font-medium text-gray-900 truncate">{item.name}</p>
              <p className="text-xs text-gray-500 font-mono">{item.barcode}</p>
            </div>
            <p className="text-xs text-gray-400">
              {formatTime(item.timestamp)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual Input Modal
// ─────────────────────────────────────────────────────────────────────────────

interface ManualInputModalProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

function ManualInputModal({ onScan, onClose }: ManualInputModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onScan(value.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-xl p-4 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Manual Entry</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter barcode, SKU, or location..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoComplete="off"
            autoCapitalize="off"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full mt-3 py-3 bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            Look Up
          </button>
        </form>
      </div>
    </div>
  );
}

export default ScanPage;
