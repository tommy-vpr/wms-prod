/**
 * PackingCompleteForm (Multi-Package)
 * Replaces single weight/dimensions form with per-package entries
 * Pre-fills from OrderPackage recommendations, packer can override
 * Includes packing photo capture + aggregate weight for fulfillment completion
 *
 * Save to: apps/web/src/components/fulfillment/PackingCompleteForm.tsx
 */

import { useState, useEffect } from "react";
import {
  Package,
  Scale,
  Ruler,
  Plus,
  Trash2,
  RotateCcw,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from "lucide-react";
import { useOrderPackages, type OrderPackage } from "@/hooks/useOrderPackages";
import {
  PackingImageUpload,
  type PackingImage,
} from "@/components/packing/PackingImageUpload";

// =============================================================================
// Types
// =============================================================================

interface PackageFormState {
  packageId: string;
  boxLabel: string | null;
  actualWeight: string;
  weightUnit: string;
  length: string;
  width: string;
  height: string;
  items: Array<{ sku: string; quantity: number }>;
  expanded: boolean;
}

/** Data passed back to parent for fulfillment state advancement */
export interface PackingCompleteData {
  totalWeight: number;
  weightUnit: string;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: string;
  };
  packageCount: number;
}

interface PackingCompleteFormProps {
  orderId: string;
  /** Work task ID — used for packing image association */
  taskId?: string;
  /** Order number — displayed on packing image upload */
  orderNumber: string;
  /** Current packing images (loaded by parent from fulfillment status) */
  packingImages: PackingImage[];
  /** Called after image upload/delete so parent can refresh status */
  onFetchStatus: () => void;
  /** Called after packages are marked PACKED — receives aggregate weight for fulfillment endpoint */
  onComplete: (data: PackingCompleteData) => void;
  onCancel?: () => void;
  /** External loading state (e.g. parent calling fulfillment endpoint) */
  actionLoading?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function PackingCompleteForm({
  orderId,
  taskId,
  orderNumber,
  packingImages,
  onFetchStatus,
  onComplete,
  onCancel,
  actionLoading = false,
}: PackingCompleteFormProps) {
  const {
    packages,
    loading,
    error,
    recommend,
    addPackage,
    removePackage,
    markPacked,
    hasPackages,
  } = useOrderPackages(orderId);

  const [formPackages, setFormPackages] = useState<PackageFormState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completed, setCompleted] = useState(false);

  // ── Sync form state from loaded packages ────────────────────────────────

  useEffect(() => {
    if (packages.length > 0) {
      setFormPackages(
        packages.map((pkg) => ({
          packageId: pkg.id,
          boxLabel: pkg.boxLabel,
          actualWeight: (() => {
            const w = pkg.actualWeight ?? pkg.estimatedWeight ?? 0;
            if (!w) return "";
            // Convert oz → lbs for display
            const unit = pkg.weightUnit ?? "oz";
            if (unit === "oz") return (w / 16).toFixed(2);
            return w.toString();
          })(),
          weightUnit: "lbs",
          length: pkg.length?.toString() ?? "",
          width: pkg.width?.toString() ?? "",
          height: pkg.height?.toString() ?? "",
          items: pkg.items.map((i) => ({
            sku: i.sku,
            quantity: i.quantity,
          })),
          expanded: packages.length === 1,
        })),
      );
    } else if (!loading) {
      // No packages yet — show single default
      setFormPackages([
        {
          packageId: "",
          boxLabel: null,
          actualWeight: "",
          weightUnit: "oz",
          length: "",
          width: "",
          height: "",
          items: [],
          expanded: true,
        },
      ]);
    }
  }, [packages, loading]);

  // ── Update a form field ─────────────────────────────────────────────────

  const updateField = (
    index: number,
    field: keyof PackageFormState,
    value: string | boolean,
  ) => {
    setFormPackages((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  // ── Toggle expand ───────────────────────────────────────────────────────

  const toggleExpand = (index: number) => {
    setFormPackages((prev) =>
      prev.map((p, i) => (i === index ? { ...p, expanded: !p.expanded } : p)),
    );
  };

  // ── Compute aggregate weight ────────────────────────────────────────────

  const computeAggregate = (): PackingCompleteData => {
    // Sum all package weights (normalize to first package's unit)
    const unit = formPackages[0]?.weightUnit ?? "oz";
    let totalWeight = 0;

    for (const pkg of formPackages) {
      let w = parseFloat(pkg.actualWeight) || 0;
      // Normalize to common unit
      if (pkg.weightUnit !== unit) {
        if (pkg.weightUnit === "lbs" && unit === "oz") w *= 16;
        else if (pkg.weightUnit === "oz" && unit === "lbs") w /= 16;
        else if (pkg.weightUnit === "kg" && unit === "oz") w *= 35.274;
        else if (pkg.weightUnit === "g" && unit === "oz") w *= 0.035274;
      }
      totalWeight += w;
    }

    // Use largest package dimensions as the aggregate (for single-label flow)
    let dimensions: PackingCompleteData["dimensions"];
    if (formPackages.length === 1) {
      const p = formPackages[0];
      if (p.length && p.width && p.height) {
        dimensions = {
          length: parseFloat(p.length),
          width: parseFloat(p.width),
          height: parseFloat(p.height),
          unit: "inch",
        };
      }
    }

    return {
      totalWeight: Math.round(totalWeight * 100) / 100,
      weightUnit: unit === "lbs" ? "pound" : "ounce",
      dimensions,
      packageCount: formPackages.length,
    };
  };

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    // Validate images
    if (packingImages.length === 0) {
      setSubmitError("Add at least one packing photo");
      return;
    }

    // Validate all packages have weight
    const invalid = formPackages.filter(
      (p) => !p.actualWeight || parseFloat(p.actualWeight) <= 0,
    );
    if (invalid.length > 0) {
      setSubmitError("All packages must have a weight");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      // 1. Mark OrderPackages as PACKED (if we have persisted packages)
      const packData = formPackages
        .filter((p) => p.packageId)
        .map((p) => ({
          packageId: p.packageId,
          actualWeight: parseFloat(p.actualWeight),
          weightUnit: p.weightUnit,
          ...(p.length ? { length: parseFloat(p.length) } : {}),
          ...(p.width ? { width: parseFloat(p.width) } : {}),
          ...(p.height ? { height: parseFloat(p.height) } : {}),
        }));

      if (packData.length > 0) {
        await markPacked(packData);
      }

      // 2. Call parent with aggregate data for fulfillment endpoint
      setCompleted(true);
      const aggregate = computeAggregate();
      onComplete(aggregate);
    } catch (err: any) {
      setSubmitError(
        err?.response?.data?.error ||
          err?.message ||
          "Failed to complete packing",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isSubmitting = submitting || actionLoading || completed;

  // ── Loading ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
        <span className="text-gray-500">Loading package data...</span>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Packing Images ──────────────────────────────────────────────── */}
      <PackingImageUpload
        orderId={orderId}
        taskId={taskId}
        orderNumber={orderNumber}
        images={packingImages}
        onUploadSuccess={onFetchStatus}
        onDeleteSuccess={onFetchStatus}
        required
        maxImages={5}
      />

      {/* ── Package Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">
            Package Details — {formPackages.length} Box
            {formPackages.length !== 1 ? "es" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasPackages && (
            <button
              onClick={recommend}
              className="cursor-pointer text-xs text-blue-600 hover:underline flex items-center gap-1"
              title="Re-run box recommendation"
            >
              <RotateCcw className="w-3 h-3" />
              Re-recommend
            </button>
          )}
          <button
            onClick={addPackage}
            className="cursor-pointer text-xs bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition"
          >
            <Plus className="w-3 h-3" />
            Add Box
          </button>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {(error || submitError) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {submitError || error}
        </div>
      )}

      {/* ── Package Cards ───────────────────────────────────────────────── */}
      {formPackages.map((pkg, index) => (
        <div
          key={pkg.packageId || index}
          className="border border-gray-200 rounded-lg overflow-hidden"
        >
          {/* Package Header */}
          <button
            onClick={() => toggleExpand(index)}
            className="cursor-pointer w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Package className="w-4 h-4 text-gray-500" />
              <span className="font-medium text-sm">
                Box {index + 1}
                {pkg.boxLabel && (
                  <span className="text-gray-500 font-normal ml-1">
                    — {pkg.boxLabel}
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-400">
                {pkg.items.length > 0
                  ? `${pkg.items.reduce((s, i) => s + i.quantity, 0)} item(s)`
                  : "Empty"}
              </span>
              {pkg.actualWeight && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {pkg.actualWeight} {pkg.weightUnit}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {formPackages.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pkg.packageId) {
                      removePackage(pkg.packageId);
                    } else {
                      setFormPackages((prev) =>
                        prev.filter((_, i) => i !== index),
                      );
                    }
                  }}
                  className="cursor-pointer p-1 text-red-400 hover:text-red-600"
                  title="Remove package"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              )}
              {pkg.expanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </div>
          </button>

          {/* Package Body */}
          {pkg.expanded && (
            <div className="p-4 space-y-4">
              {/* Items list */}
              {pkg.items.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">
                    Items
                  </div>
                  <div className="space-y-1">
                    {pkg.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-sm bg-gray-50 px-3 py-1.5 rounded"
                      >
                        <span className="font-mono text-xs">{item.sku}</span>
                        <span className="text-gray-500">×{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Weight */}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1 mb-1">
                  <Scale className="w-3 h-3" />
                  Actual Weight <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={pkg.actualWeight}
                    onChange={(e) =>
                      updateField(index, "actualWeight", e.target.value)
                    }
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Weight"
                  />
                  <select
                    value={pkg.weightUnit}
                    onChange={(e) =>
                      updateField(index, "weightUnit", e.target.value)
                    }
                    className="border border-border rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="oz">oz</option>
                    <option value="lbs">lbs</option>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                  </select>
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase flex items-center gap-1 mb-1">
                  <Ruler className="w-3 h-3" />
                  Dimensions (L × W × H)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={pkg.length}
                    onChange={(e) =>
                      updateField(index, "length", e.target.value)
                    }
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="L"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={pkg.width}
                    onChange={(e) =>
                      updateField(index, "width", e.target.value)
                    }
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="W"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={pkg.height}
                    onChange={(e) =>
                      updateField(index, "height", e.target.value)
                    }
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="H"
                  />
                  <span className="flex items-center text-sm text-gray-400">
                    in
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* ── Submit ───────────────────────────────────────────────────────── */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || formPackages.length === 0}
        className="cursor-pointer w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition"
      >
        {completed ? (
          <>
            <CheckCircle2 className="w-4 h-4" />
            Packing Complete
          </>
        ) : isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Completing...
          </>
        ) : (
          <>
            <CheckCircle2 className="w-4 h-4" />
            Complete Packing ({formPackages.length} box
            {formPackages.length !== 1 ? "es" : ""})
          </>
        )}
      </button>

      {packingImages.length === 0 && (
        <p className="text-xs text-amber-600 text-center">
          Add at least one packing photo to continue
        </p>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className="cursor-pointer w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
