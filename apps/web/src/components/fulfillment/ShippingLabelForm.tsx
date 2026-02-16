/**
 * ShippingLabelForm (Multi-Package)
 * Reads PACKED OrderPackages and creates a shipping label per package
 * Calls POST /shipping/create-label with the correct payload shape
 *
 * Save to: apps/web/src/components/fulfillment/ShippingLabelForm.tsx
 */

import { useState, useMemo } from "react";
import {
  Truck,
  Package,
  Loader2,
  AlertCircle,
  CheckCircle,
  ExternalLink,
} from "lucide-react";
import { useOrderPackages, type OrderPackage } from "@/hooks/useOrderPackages";
import { apiClient } from "@/lib/api";

// =============================================================================
// Types
// =============================================================================

interface ShippingLabelFormProps {
  orderId: string;
  orderNumber: string;
  shippingAddress: Record<string, any>;
  onComplete: () => void;
  onCancel?: () => void;
}

interface LabelResult {
  id: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl: string;
  carrier: string;
  service: string;
  rate: number;
  packageIndex?: number;
}

// =============================================================================
// Helpers
// =============================================================================

function formatWeight(pkg: OrderPackage): string {
  const weight = pkg.actualWeight ?? pkg.estimatedWeight ?? 0;
  const unit = pkg.weightUnit ?? "oz";
  return `${weight} ${unit}`;
}

function formatDimensions(pkg: OrderPackage): string {
  if (!pkg.length || !pkg.width || !pkg.height) return "—";
  return `${pkg.length}×${pkg.width}×${pkg.height} ${pkg.dimensionUnit ?? "in"}`;
}

/** Map shippingAddress → route's expected shape. Handles both Shopify format
 *  (address1, province_code, country_code) and normalized format (street1, state, country). */
function mapAddress(addr: Record<string, any>) {
  return {
    name:
      addr.name ||
      [addr.first_name, addr.last_name].filter(Boolean).join(" ") ||
      "",
    company: addr.company || undefined,
    address1: addr.address1 || addr.street1 || "",
    address2: addr.address2 || addr.street2 || undefined,
    city: addr.city || "",
    state: addr.province_code || addr.state || "",
    zip: addr.zip || "",
    country: addr.country_code || addr.country || "US",
    phone: addr.phone || undefined,
  };
}

// =============================================================================
// Component
// =============================================================================

export function ShippingLabelForm({
  orderId,
  orderNumber,
  shippingAddress,
  onComplete,
  onCancel,
}: ShippingLabelFormProps) {
  const { packages, loading, error, markShipped } = useOrderPackages(orderId);

  const [carrierCode, setCarrierCode] = useState("usps");
  const [serviceCode, setServiceCode] = useState("usps_priority_mail");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [labels, setLabels] = useState<LabelResult[]>([]);

  // ── Filter to PACKED packages only ──────────────────────────────────────

  const packedPackages = useMemo(
    () => packages.filter((p) => p.status === "PACKED"),
    [packages],
  );

  const totalWeight = useMemo(
    () =>
      packedPackages.reduce(
        (sum, p) => sum + (p.actualWeight ?? p.estimatedWeight ?? 0),
        0,
      ),
    [packedPackages],
  );

  const hasLabels = labels.length > 0;
  const allLabeled = hasLabels && labels.length >= packedPackages.length;

  // ── Sync service code when carrier changes ──────────────────────────────

  const handleCarrierChange = (newCarrier: string) => {
    setCarrierCode(newCarrier);
    const defaults: Record<string, string> = {
      usps: "usps_priority_mail",
      ups: "ups_ground",
      fedex: "fedex_ground",
    };
    setServiceCode(defaults[newCarrier] ?? "");
  };

  // ── Create Labels ───────────────────────────────────────────────────────

  const handleCreateLabels = async () => {
    if (packedPackages.length === 0) {
      setSubmitError("No packed packages found");
      return;
    }

    // Validate all packages have weight
    const missingWeight = packedPackages.filter(
      (p) => !p.actualWeight || p.actualWeight <= 0,
    );
    if (missingWeight.length > 0) {
      setSubmitError(
        `Package(s) ${missingWeight.map((p) => p.sequence).join(", ")} missing weight`,
      );
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      // Map to the shape expected by POST /shipping/create-label
      const payload = {
        orderId,
        carrierCode,
        serviceCode,
        packages: packedPackages.map((pkg) => ({
          packageCode: "package",
          weight: pkg.actualWeight!,
          length: pkg.length ?? undefined,
          width: pkg.width ?? undefined,
          height: pkg.height ?? undefined,
          items: pkg.items.map((item) => ({
            sku: item.sku,
            quantity: item.quantity,
          })),
        })),
        shippingAddress: mapAddress(shippingAddress),
      };

      const result = await apiClient.post<{
        success: boolean;
        labels: LabelResult[];
        totalCost: number;
        isTestLabel?: boolean;
      }>("/shipping/create-label", payload);

      setLabels(result.labels ?? []);

      // Mark all OrderPackages as SHIPPED
      try {
        await markShipped();
      } catch {
        // Non-blocking — labels were created successfully
        console.warn("Failed to mark packages as SHIPPED");
      }
    } catch (err: any) {
      setSubmitError(
        err?.response?.data?.error || err?.message || "Label creation failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
        <span className="text-gray-500">Loading package data...</span>
      </div>
    );
  }

  // ── No packed packages — fallback to manual weight entry ────────────────

  if (packedPackages.length === 0 && !loading) {
    return (
      <FallbackShippingForm
        orderId={orderId}
        orderNumber={orderNumber}
        shippingAddress={shippingAddress}
        carrierCode={carrierCode}
        serviceCode={serviceCode}
        onCarrierChange={handleCarrierChange}
        onServiceChange={setServiceCode}
        onComplete={onComplete}
        onCancel={onCancel}
      />
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Truck className="w-5 h-5" />
          Shipping — {orderNumber}
        </h3>
        <span className="text-sm text-gray-500">
          {packedPackages.length} package
          {packedPackages.length !== 1 ? "s" : ""} · {totalWeight} oz total
        </span>
      </div>

      {/* Error */}
      {(error || submitError) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {submitError || error}
        </div>
      )}

      {/* Package Summary Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Box</th>
              <th className="px-4 py-2 text-left">Items</th>
              <th className="px-4 py-2 text-right">Weight</th>
              <th className="px-4 py-2 text-right">Dimensions</th>
              {hasLabels && <th className="px-4 py-2 text-left">Tracking</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {packedPackages.map((pkg, idx) => {
              const label = labels[idx];
              return (
                <tr key={pkg.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">#{pkg.sequence}</span>
                      {pkg.boxLabel && (
                        <span className="text-gray-400 text-xs">
                          {pkg.boxLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {pkg.items.map((item, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-xs font-mono"
                        >
                          {item.sku}
                          <span className="text-gray-400">
                            ×{item.quantity}
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    {formatWeight(pkg)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">
                    {formatDimensions(pkg)}
                  </td>
                  {hasLabels && (
                    <td className="px-4 py-2.5">
                      {label ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <a
                            href={label.labelUrl || label.trackingUrl || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 text-xs font-mono"
                          >
                            {label.trackingNumber}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Carrier Selection (only before labels are created) */}
      {!allLabeled && (
        <CarrierServiceSelect
          carrierCode={carrierCode}
          serviceCode={serviceCode}
          onCarrierChange={handleCarrierChange}
          onServiceChange={setServiceCode}
          disabled={submitting}
        />
      )}

      {/* Ship-to Address */}
      <ShipToAddress shippingAddress={shippingAddress} />

      {/* Label results summary */}
      {allLabeled && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-medium text-green-800">
              {labels.length} label{labels.length !== 1 ? "s" : ""} created
              successfully
            </span>
          </div>
          <div className="text-sm text-green-700">
            Total cost: $
            {labels.reduce((sum, l) => sum + (l.rate ?? 0), 0).toFixed(2)}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={submitting}
            className="cursor-pointer px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        )}
        {allLabeled ? (
          <button
            onClick={onComplete}
            className="cursor-pointer px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            Done
          </button>
        ) : (
          <button
            onClick={handleCreateLabels}
            disabled={submitting || packedPackages.length === 0}
            className="cursor-pointer px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating Labels...
              </>
            ) : (
              <>
                <Truck className="w-4 h-4" />
                Create {packedPackages.length} Label
                {packedPackages.length !== 1 ? "s" : ""}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Fallback: Manual Weight Entry (no OrderPackages)
// =============================================================================

function FallbackShippingForm({
  orderId,
  orderNumber,
  shippingAddress,
  carrierCode,
  serviceCode,
  onCarrierChange,
  onServiceChange,
  onComplete,
  onCancel,
}: {
  orderId: string;
  orderNumber: string;
  shippingAddress: Record<string, any>;
  carrierCode: string;
  serviceCode: string;
  onCarrierChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const [weight, setWeight] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [labels, setLabels] = useState<LabelResult[]>([]);

  const hasLabels = labels.length > 0;

  const handleCreate = async () => {
    const w = parseFloat(weight);
    if (!w || w <= 0) {
      setSubmitError("Enter a valid weight");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const payload = {
        orderId,
        carrierCode,
        serviceCode,
        packages: [
          {
            packageCode: "package",
            weight: w,
            length: parseFloat(length) || undefined,
            width: parseFloat(width) || undefined,
            height: parseFloat(height) || undefined,
          },
        ],
        shippingAddress: mapAddress(shippingAddress),
      };

      const result = await apiClient.post<{
        success: boolean;
        labels: LabelResult[];
        totalCost: number;
      }>("/shipping/create-label", payload);

      setLabels(result.labels ?? []);
    } catch (err: any) {
      setSubmitError(err?.message || "Label creation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        No package data found — enter weight manually.
      </div>

      {submitError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {submitError}
        </div>
      )}

      {!hasLabels && (
        <>
          {/* Weight & Dimensions */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
                Weight (oz) *
              </label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="16"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                min="0.1"
                step="0.1"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
                L (in)
              </label>
              <input
                type="number"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="12"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
                W (in)
              </label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="10"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
                H (in)
              </label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="6"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                disabled={submitting}
              />
            </div>
          </div>

          <CarrierServiceSelect
            carrierCode={carrierCode}
            serviceCode={serviceCode}
            onCarrierChange={onCarrierChange}
            onServiceChange={onServiceChange}
            disabled={submitting}
          />
        </>
      )}

      <ShipToAddress shippingAddress={shippingAddress} />

      {hasLabels && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-medium text-green-800">Label created</span>
          </div>
          {labels.map((label) => (
            <div key={label.id} className="text-sm text-green-700">
              {label.carrier?.toUpperCase()} — {label.trackingNumber}
              {label.labelUrl && (
                <a
                  href={label.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-blue-600 hover:underline"
                >
                  View Label →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={submitting}
            className="cursor-pointer px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        )}
        {hasLabels ? (
          <button
            onClick={onComplete}
            className="cursor-pointer px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            Done
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={submitting}
            className="cursor-pointer px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating Label...
              </>
            ) : (
              <>
                <Truck className="w-4 h-4" />
                Create Label
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Shared Sub-Components
// =============================================================================

function CarrierServiceSelect({
  carrierCode,
  serviceCode,
  onCarrierChange,
  onServiceChange,
  disabled,
}: {
  carrierCode: string;
  serviceCode: string;
  onCarrierChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
          Carrier
        </label>
        <select
          value={carrierCode}
          onChange={(e) => onCarrierChange(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
          disabled={disabled}
        >
          <option value="usps">USPS</option>
          <option value="ups">UPS</option>
          <option value="fedex">FedEx</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
          Service
        </label>
        <select
          value={serviceCode}
          onChange={(e) => onServiceChange(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
          disabled={disabled}
        >
          {carrierCode === "usps" && (
            <>
              <option value="usps_priority_mail">Priority Mail</option>
              <option value="usps_ground_advantage">Ground Advantage</option>
              <option value="usps_priority_mail_express">
                Priority Mail Express
              </option>
              <option value="usps_first_class_mail">First-Class Mail</option>
            </>
          )}
          {carrierCode === "ups" && (
            <>
              <option value="ups_ground">UPS Ground</option>
              <option value="ups_3_day_select">UPS 3 Day Select</option>
              <option value="ups_2nd_day_air">UPS 2nd Day Air</option>
              <option value="ups_next_day_air">UPS Next Day Air</option>
            </>
          )}
          {carrierCode === "fedex" && (
            <>
              <option value="fedex_ground">FedEx Ground</option>
              <option value="fedex_home_delivery">FedEx Home Delivery</option>
              <option value="fedex_2day">FedEx 2Day</option>
              <option value="fedex_standard_overnight">
                FedEx Standard Overnight
              </option>
            </>
          )}
        </select>
      </div>
    </div>
  );
}

function ShipToAddress({
  shippingAddress,
}: {
  shippingAddress: Record<string, any>;
}) {
  const name =
    shippingAddress.name ||
    [shippingAddress.first_name, shippingAddress.last_name]
      .filter(Boolean)
      .join(" ") ||
    "—";
  const line1 = shippingAddress.address1 || shippingAddress.street1 || "";
  const line2 = shippingAddress.address2 || shippingAddress.street2 || "";
  const city = shippingAddress.city || "";
  const state = shippingAddress.province_code || shippingAddress.state || "";
  const zip = shippingAddress.zip || "";

  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm">
      <div className="text-xs font-medium text-gray-500 uppercase mb-1">
        Ship To
      </div>
      <div>
        <div className="font-medium">{name}</div>
        {shippingAddress.company && (
          <div className="text-gray-600">{shippingAddress.company}</div>
        )}
        <div className="text-gray-600">{line1}</div>
        {line2 && <div className="text-gray-600">{line2}</div>}
        <div className="text-gray-600">
          {city}, {state} {zip}
        </div>
      </div>
    </div>
  );
}
