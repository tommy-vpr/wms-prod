// apps/web/src/pages/fulfillment/PackStation.tsx

import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ScanBarcode,
  Package,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Inbox,
  Camera,
  Scale,
  Truck,
  Printer,
  RefreshCw,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useFulfillmentStream } from "@/hooks/useFulfillmentStream";
import {
  PackingImageUpload,
  type PackingImage,
} from "@/components/packing/PackingImageUpload";
import ShippingLabelForm from "@/components/shipping/ShippingLabelForm";

// ============================================================================
// Types
// ============================================================================

interface BinItem {
  id: string;
  sku: string;
  quantity: number;
  verifiedQty: number;
  productVariant: {
    id: string;
    sku: string;
    upc: string | null;
    barcode: string | null;
    name: string;
    imageUrl: string | null;
  };
}

interface BinData {
  orderId: string;
  orderNumber: string;
  order: {
    id: string;
    customerName: string;
    shippingAddress: any;
    priority: string;
  };
  bin: {
    id: string;
    binNumber: string;
    barcode: string;
    status: string;
    items: BinItem[];
  };
  packingImages: PackingImage[];
}

type PackStationStep =
  | "scan_bin"
  | "verify_items"
  | "photos_weight"
  | "shipping";

// ============================================================================
// Component
// ============================================================================

export default function PackStationPage() {
  const navigate = useNavigate();

  // State
  const [step, setStep] = useState<PackStationStep>("scan_bin");
  const [binData, setBinData] = useState<BinData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Weight form
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("ounce");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SSE for real-time updates
  const { connected } = useFulfillmentStream({
    orderId: binData?.orderId,
    enabled: !!binData?.orderId,
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  const showFeedback = (type: "success" | "error", message: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ type, message });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2500);
  };

  const resetStation = () => {
    setBinData(null);
    setStep("scan_bin");
    setError(null);
    setFeedback(null);
    setWeight("");
    setLength("");
    setWidth("");
    setHeight("");
  };

  // ── Refresh bin data ────────────────────────────────────────────────────

  const refreshBinData = useCallback(async () => {
    if (!binData?.bin.barcode) return;
    try {
      const data = await apiClient.get<BinData>(
        `/fulfillment/bin/${binData.bin.barcode}`,
      );
      setBinData(data);
    } catch (err: any) {
      console.error("Failed to refresh bin data:", err);
    }
  }, [binData?.bin.barcode]);

  // ── Barcode Scanner ─────────────────────────────────────────────────────

  const handleScan = useCallback(
    async (barcode: string) => {
      if (loading) return;

      // Step 1: Scan bin barcode to load order
      if (step === "scan_bin") {
        setLoading(true);
        setError(null);
        try {
          const data = await apiClient.get<BinData>(
            `/fulfillment/bin/${barcode}`,
          );
          setBinData(data);
          setStep("verify_items");
          showFeedback(
            "success",
            `Loaded ${data.bin.binNumber} - ${data.orderNumber}`,
          );
        } catch (err: any) {
          showFeedback("error", err.message || "Bin not found");
        } finally {
          setLoading(false);
        }
        return;
      }

      // Step 2: Verify items by scanning UPC
      if (step === "verify_items" && binData) {
        setLoading(true);
        try {
          const result = await apiClient.post<{
            verified: boolean;
            item: { sku: string; verifiedQty: number; quantity: number };
            allVerified: boolean;
          }>(`/fulfillment/bin/${binData.bin.id}/verify`, { barcode });

          if (result.verified) {
            showFeedback(
              "success",
              `✓ ${result.item.sku} (${result.item.verifiedQty}/${result.item.quantity})`,
            );

            // Update local state
            setBinData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                bin: {
                  ...prev.bin,
                  items: prev.bin.items.map((item) =>
                    item.sku === result.item.sku
                      ? { ...item, verifiedQty: result.item.verifiedQty }
                      : item,
                  ),
                },
              };
            });

            // If all verified, move to photos/weight step
            if (result.allVerified) {
              showFeedback("success", "All items verified!");
              setTimeout(() => setStep("photos_weight"), 1000);
            }
          } else {
            showFeedback("error", `${result.item.sku} already fully scanned`);
          }
        } catch (err: any) {
          showFeedback("error", err.message || "Item not in this bin");
        } finally {
          setLoading(false);
        }
      }
    },
    [step, binData, loading],
  );

  useBarcodeScanner({
    onScan: handleScan,
    enabled: !loading && (step === "scan_bin" || step === "verify_items"),
  });

  // ── Complete packing (photos + weight) ──────────────────────────────────

  const completePacking = async () => {
    if (!binData || !weight) {
      setError("Enter package weight");
      return;
    }

    if (binData.packingImages.length === 0) {
      setError("Add at least one packing photo");
      return;
    }

    setLoading(true);
    try {
      // Mark bin as completed
      await apiClient.post(`/fulfillment/bin/${binData.bin.id}/complete`);

      // Complete packing with weight/dimensions
      await apiClient.post(
        `/fulfillment/${binData.orderId}/pack/complete-from-bin`,
        {
          binId: binData.bin.id,
          weight: parseFloat(weight),
          weightUnit,
          dimensions:
            length && width && height
              ? {
                  length: parseFloat(length),
                  width: parseFloat(width),
                  height: parseFloat(height),
                  unit: "inch",
                }
              : undefined,
        },
      );

      setStep("shipping");
      showFeedback("success", "Packing complete!");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Progress calculation ────────────────────────────────────────────────

  const totalItems =
    binData?.bin.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const verifiedItems =
    binData?.bin.items.reduce((sum, i) => sum + i.verifiedQty, 0) ?? 0;
  const progress = totalItems > 0 ? (verifiedItems / totalItems) * 100 : 0;
  const allVerified = verifiedItems >= totalItems && totalItems > 0;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Pack Station</h1>
        <div className="flex items-center gap-2">
          {binData && (
            <button
              onClick={refreshBinData}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          {binData && (
            <button
              onClick={resetStation}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-gray-50"
            >
              New Bin
            </button>
          )}
        </div>
      </div>

      {/* Step Indicator */}
      {binData && (
        <div className="flex items-center gap-2 mb-6">
          {[
            { key: "verify_items", label: "Verify", icon: ScanBarcode },
            { key: "photos_weight", label: "Photos & Weight", icon: Camera },
            { key: "shipping", label: "Ship", icon: Truck },
          ].map((s, i) => {
            const isActive = step === s.key;
            const isDone =
              (s.key === "verify_items" &&
                (step === "photos_weight" || step === "shipping")) ||
              (s.key === "photos_weight" && step === "shipping");
            const Icon = s.icon;

            return (
              <div key={s.key} className="flex items-center">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition ${
                    isDone
                      ? "bg-green-100 text-green-700"
                      : isActive
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                  {s.label}
                </div>
                {i < 2 && <div className="w-8 h-0.5 bg-gray-200 mx-1" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
            feedback.type === "success"
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          {feedback.message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-600"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 1: Scan Bin */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {step === "scan_bin" && (
        <div className="bg-white border border-border rounded-xl p-8 text-center">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Inbox className="w-10 h-10 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Scan Bin Barcode</h2>
          <p className="text-gray-500 mb-6">
            Scan the barcode label on the pick bin to load the order
          </p>
          {loading && (
            <div className="flex items-center justify-center gap-2 text-blue-600">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading bin...
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 2: Verify Items */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {step === "verify_items" && binData && (
        <div className="space-y-4">
          {/* Bin Info */}
          <div className="bg-white border border-border rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Bin
                </div>
                <div className="text-lg font-bold">{binData.bin.binNumber}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Order
                </div>
                <div className="font-semibold text-blue-600">
                  {binData.orderNumber}
                </div>
                <div className="text-xs text-gray-500">
                  {binData.order.customerName}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Verification Progress</span>
                <span className="font-medium">
                  {verifiedItems}/{totalItems}
                </span>
              </div>
              <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    allVerified ? "bg-green-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Scan Prompt */}
          {!allVerified && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <ScanBarcode className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-blue-800 font-medium">
                Scan item UPC to verify
              </p>
              <p className="text-blue-600 text-sm mt-1">
                Each scan verifies 1 unit. Scan multiple times for quantity &gt;
                1.
              </p>
            </div>
          )}

          {/* Items List */}
          <div className="bg-white border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-gray-50">
              <span className="text-sm font-medium text-gray-600">
                Items to Verify
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {binData.bin.items.map((item) => {
                const isComplete = item.verifiedQty >= item.quantity;
                const isCurrent = !isComplete;

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-3 ${
                      isComplete ? "bg-green-50" : isCurrent ? "bg-white" : ""
                    }`}
                  >
                    {/* Status indicator */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isComplete
                          ? "bg-green-500 text-white"
                          : "border-2 border-gray-300"
                      }`}
                    >
                      {isComplete ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <span className="text-xs font-bold text-gray-400">
                          {item.verifiedQty}
                        </span>
                      )}
                    </div>

                    {/* Product image */}
                    {item.productVariant.imageUrl ? (
                      <img
                        src={item.productVariant.imageUrl}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-gray-300" />
                      </div>
                    )}

                    {/* Product info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {item.productVariant.name}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        {item.sku}
                        {item.productVariant.upc && (
                          <span className="ml-2 text-gray-400">
                            UPC: {item.productVariant.upc}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity */}
                    <div className="text-right flex-shrink-0">
                      <div
                        className={`text-xl font-bold ${
                          isComplete ? "text-green-600" : "text-gray-700"
                        }`}
                      >
                        {item.verifiedQty}/{item.quantity}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Continue button when all verified */}
          {allVerified && (
            <button
              onClick={() => setStep("photos_weight")}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Continue to Photos & Weight
            </button>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 3: Photos & Weight */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {step === "photos_weight" && binData && (
        <div className="space-y-4">
          {/* Order summary */}
          <div className="bg-white border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-bold">{binData.orderNumber}</div>
                <div className="text-sm text-gray-500">
                  {binData.order.customerName}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  {totalItems} items verified
                </div>
              </div>
            </div>
          </div>

          {/* Packing Images */}
          <div className="bg-white border border-border rounded-xl p-4">
            <PackingImageUpload
              orderId={binData.orderId}
              taskId={binData.bin.id}
              orderNumber={binData.orderNumber}
              images={binData.packingImages}
              onUploadSuccess={refreshBinData}
              onDeleteSuccess={refreshBinData}
              required
              maxImages={5}
            />
          </div>

          {/* Weight & Dimensions */}
          <div className="bg-white border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <Scale className="w-5 h-5 text-gray-500" />
              <h3 className="font-semibold">Package Details</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Weight <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <select
                    value={weightUnit}
                    onChange={(e) => setWeightUnit(e.target.value)}
                    className="px-2 py-2 border border-border rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="ounce">oz</option>
                    <option value="pound">lb</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Length", val: length, set: setLength },
                { label: "Width", val: width, set: setWidth },
                { label: "Height", val: height, set: setHeight },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {label} (in)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Complete Packing Button */}
          <button
            onClick={completePacking}
            disabled={loading || !weight || binData.packingImages.length === 0}
            className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Package className="w-5 h-5" />
            )}
            Complete Packing
          </button>

          {binData.packingImages.length === 0 && (
            <p className="text-xs text-amber-600 text-center">
              Add at least one packing photo to continue
            </p>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* STEP 4: Shipping */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {step === "shipping" && binData && (
        <div className="bg-white border border-border rounded-xl p-4">
          <ShippingLabelForm
            order={{
              id: binData.orderId,
              orderNumber: binData.orderNumber,
              customerName: binData.order.customerName,
              status: "PACKED",
              lineItems: binData.bin.items.map((item) => ({
                id: item.id,
                sku: item.sku,
                name: item.productVariant.name,
                quantity: item.quantity,
                quantityPicked: item.quantity,
                unitPrice: 0,
              })),
              shippingAddress: binData.order.shippingAddress,
            }}
            onSuccess={(labels) => {
              // Open label PDFs
              labels.forEach((label) => {
                if (label.labelUrl) window.open(label.labelUrl, "_blank");
              });
              // Reset for next bin
              showFeedback("success", "Label created! Ready for next bin.");
              setTimeout(resetStation, 2000);
            }}
            embedded
            initialWeight={parseFloat(weight) || undefined}
            initialDimensions={
              length && width && height
                ? {
                    length: parseFloat(length),
                    width: parseFloat(width),
                    height: parseFloat(height),
                  }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
