/**
 * Shipping Label Form Component
 * Adapted for WMS with service/queue pattern
 *
 * Save to: apps/web/src/components/shipping/ShippingLabelForm.tsx
 *
 * Uses:
 * - GET /api/shipping/carriers - Load carriers and presets
 * - POST /api/shipping/create-label - Create label synchronously
 * - POST /api/shipping/create-label-async - Queue label creation (background)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Minus,
  Package,
  Truck,
  AlertCircle,
  Loader2,
  X,
  Zap,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Shuffle,
} from "lucide-react";
import { apiClient } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

interface ShippingPreset {
  id: string;
  label: string;
  carrier: "ups" | "usps";
  serviceCode: string;
  serviceName: string;
  packageType: string;
  confirmation: string;
  boxId?: string;
  dimensions?: { length: number; width: number; height: number };
  isFlatRate?: boolean;
  usedBy: string[];
  purpose?: string;
}

interface BoxDefinition {
  id: string;
  label: string;
  dimensions: { length: number; width: number; height: number };
  usedBy: string[];
  purpose?: string;
  isFlatRate?: boolean;
}

interface PackageConfig {
  id: string;
  packageCode: string;
  weight: string;
  dimensions: { length: string; width: string; height: string };
  items: ShipmentItem[];
  presetId?: string;
}

interface Shipment {
  id: string;
  name: string;
  items: ShipmentItem[];
  carrierId: string;
  serviceCode: string;
  packages: PackageConfig[];
  notes: string;
  presetId?: string;
}

interface OrderItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  quantityPicked?: number;
  unitPrice?: number;
}

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string;
  status: string;
  totalAmount?: number;
  lineItems: OrderItem[];
  shippingAddress: {
    address1: string;
    city: string;
    province?: string;
    province_code?: string;
    zip: string;
    name?: string;
    country?: string;
    country_code?: string;
  };
}

interface Carrier {
  carrier_id: string;
  carrier_code: string;
  friendly_name: string;
  services: Array<{ service_code: string; name: string }>;
  packages: Array<{ package_code: string; name: string }>;
}

interface ShipmentItem {
  itemId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

interface LabelResult {
  trackingNumber: string;
  labelUrl: string;
  cost: number;
  trackingUrl?: string;
}

interface InitialPackageFromPacking {
  label: string;
  items: Array<{
    sku: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

interface ShippingLabelFormProps {
  order: Order;
  onSuccess?: (results: LabelResult[]) => void;
  onCancel?: () => void;
  embedded?: boolean;
  initialWeight?: number;
  initialDimensions?: { length: number; width: number; height: number };
  initialPackages?: InitialPackageFromPacking[];
}

// ============================================================================
// Component
// ============================================================================

export default function ShippingLabelForm({
  order,
  onSuccess,
  onCancel,
  embedded = false,
  initialWeight,
  initialDimensions,
  initialPackages,
}: ShippingLabelFormProps) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [presets, setPresets] = useState<ShippingPreset[]>([]);
  const [boxes, setBoxes] = useState<BoxDefinition[]>([]);
  const [quickAccessPresets, setQuickAccessPresets] = useState<
    ShippingPreset[]
  >([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [carriersLoading, setCarriersLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showPresetSelector, setShowPresetSelector] = useState(false);
  const [numberOfPackages, setNumberOfPackages] = useState("");

  const dimensionsAppliedRef = useRef(false);

  const generateId = useCallback(
    () => Date.now().toString(36) + Math.random().toString(36).substr(2),
    [],
  );

  // ============================================================================
  // Initialization
  // ============================================================================

  useEffect(() => {
    loadCarriersAndPresets();
    initializeShipment();
  }, []);

  useEffect(() => {
    if (
      (initialDimensions || initialWeight) &&
      shipments.length > 0 &&
      !dimensionsAppliedRef.current
    ) {
      setShipments((prev) => {
        const updated = [...prev];
        const first = updated[0];
        if (first && first.packages.length > 0) {
          updated[0] = {
            ...first,
            packages: [
              {
                ...first.packages[0],
                weight: initialWeight?.toString() || first.packages[0].weight,
                dimensions: {
                  length:
                    initialDimensions?.length?.toString() ||
                    first.packages[0].dimensions.length,
                  width:
                    initialDimensions?.width?.toString() ||
                    first.packages[0].dimensions.width,
                  height:
                    initialDimensions?.height?.toString() ||
                    first.packages[0].dimensions.height,
                },
              },
              ...first.packages.slice(1),
            ],
          };
        }
        return updated;
      });
      dimensionsAppliedRef.current = true;
    }
  }, [initialWeight, initialDimensions, shipments.length]);

  const initializeShipment = () => {
    const allItems: ShipmentItem[] = order.lineItems.map((item) => ({
      itemId: item.id,
      productName: item.name,
      sku: item.sku,
      unitPrice: item.unitPrice || 0,
      quantity: item.quantityPicked ?? item.quantity,
    }));

    // Build packages from packing data if available
    let packages: PackageConfig[];
    if (initialPackages && initialPackages.length > 0) {
      packages = initialPackages.map((pkgData) => ({
        id: generateId(),
        packageCode: "",
        weight: initialWeight?.toString() || "",
        dimensions: {
          length: initialDimensions?.length?.toString() || "12",
          width: initialDimensions?.width?.toString() || "10",
          height: initialDimensions?.height?.toString() || "6",
        },
        items: pkgData.items.map((item) => {
          // Match with order line items for full data
          const orderItem = allItems.find((oi) => oi.sku === item.sku);
          return {
            itemId: orderItem?.itemId || "",
            productName: item.productName || orderItem?.productName || item.sku,
            sku: item.sku,
            unitPrice: item.unitPrice || orderItem?.unitPrice || 0,
            quantity: item.quantity,
          };
        }),
      }));
    } else {
      packages = [
        {
          id: generateId(),
          packageCode: "",
          weight: initialWeight?.toString() || "",
          dimensions: {
            length: initialDimensions?.length?.toString() || "12",
            width: initialDimensions?.width?.toString() || "10",
            height: initialDimensions?.height?.toString() || "6",
          },
          items: [],
        },
      ];
    }

    const initialShipment: Shipment = {
      id: generateId(),
      name: "Shipment 1",
      items: allItems,
      carrierId: "",
      serviceCode: "",
      packages,
      notes: "",
    };
    setShipments([initialShipment]);
    dimensionsAppliedRef.current = false;
  };

  const loadCarriersAndPresets = async () => {
    try {
      setCarriersLoading(true);
      const data = await apiClient.get<{
        carriers: Carrier[];
        presets: ShippingPreset[];
        boxes: BoxDefinition[];
        quickAccess: ShippingPreset[];
      }>("/shipping/carriers");

      setCarriers(data.carriers || []);
      setPresets(data.presets || []);
      setBoxes(data.boxes || []);
      setQuickAccessPresets(data.quickAccess || []);
    } catch (err) {
      console.error("Failed to load shipping data:", err);
      setError("Failed to load shipping options");
    } finally {
      setCarriersLoading(false);
    }
  };

  // ============================================================================
  // Preset Helpers
  // ============================================================================

  const applyPreset = useCallback(
    (shipmentId: string, preset: ShippingPreset) => {
      const carrierCodeMap: Record<string, string> = {
        usps: "stamps_com",
        ups: "ups",
      };
      const targetCarrierCode = carrierCodeMap[preset.carrier];
      const carrier = carriers.find(
        (c) => c.carrier_code === targetCarrierCode,
      );

      if (!carrier) return;

      setShipments((prev) =>
        prev.map((shipment) => {
          if (shipment.id !== shipmentId) return shipment;
          return {
            ...shipment,
            carrierId: carrier.carrier_id,
            serviceCode: preset.serviceCode,
            presetId: preset.id,
            packages: [
              {
                ...shipment.packages[0],
                packageCode: preset.packageType,
                presetId: preset.id,
                dimensions: preset.dimensions
                  ? {
                      length: preset.dimensions.length.toString(),
                      width: preset.dimensions.width.toString(),
                      height: preset.dimensions.height.toString(),
                    }
                  : shipment.packages[0].dimensions,
              },
              ...shipment.packages.slice(1),
            ],
          };
        }),
      );
      setShowPresetSelector(false);
    },
    [carriers],
  );

  const getPresetsForCarrier = (carrierId: string): ShippingPreset[] => {
    const carrier = carriers.find((c) => c.carrier_id === carrierId);
    if (!carrier) return [];

    const carrierCode = carrier.carrier_code.toLowerCase();
    let presetCarrierType: "ups" | "usps" | null = null;

    if (carrierCode === "ups") presetCarrierType = "ups";
    else if (carrierCode === "stamps_com") presetCarrierType = "usps";

    if (!presetCarrierType) return [];
    return presets.filter((p) => p.carrier === presetCarrierType);
  };

  const getCarrierOptions = (carrierId: string) => {
    const carrier = carriers.find((c) => c.carrier_id === carrierId);

    // Dedupe services by service_code
    const uniqueServices = (carrier?.services || []).filter(
      (service, index, self) =>
        index ===
        self.findIndex((s) => s.service_code === service.service_code),
    );

    // Dedupe packages by package_code
    const uniquePackages = (carrier?.packages || []).filter(
      (pkg, index, self) =>
        index === self.findIndex((p) => p.package_code === pkg.package_code),
    );

    return {
      services: uniqueServices,
      packages: uniquePackages,
    };
  };

  // ============================================================================
  // Package Management
  // ============================================================================

  const updateShippingConfig = useCallback(
    (shipmentId: string, field: string, value: string) => {
      setShipments((prev) =>
        prev.map((s) => (s.id === shipmentId ? { ...s, [field]: value } : s)),
      );
    },
    [],
  );

  const updatePackageConfig = useCallback(
    (shipmentId: string, packageId: string, field: string, value: string) => {
      setShipments((prev) =>
        prev.map((shipment) => {
          if (shipment.id !== shipmentId) return shipment;
          return {
            ...shipment,
            packages: shipment.packages.map((pkg) =>
              pkg.id === packageId
                ? field.includes(".")
                  ? {
                      ...pkg,
                      dimensions: {
                        ...pkg.dimensions,
                        [field.split(".")[1]]: value,
                      },
                    }
                  : { ...pkg, [field]: value }
                : pkg,
            ),
          };
        }),
      );
    },
    [],
  );

  const addPackageToShipment = (shipmentId: string) => {
    setShipments((prev) =>
      prev.map((s) => {
        if (s.id !== shipmentId) return s;
        const first = s.packages[0];
        return {
          ...s,
          packages: [
            ...s.packages,
            {
              id: generateId(),
              packageCode: first?.packageCode || "",
              weight: "",
              dimensions: { length: "12", width: "10", height: "6" },
              items: [],
            },
          ],
        };
      }),
    );
  };

  const removePackageFromShipment = (shipmentId: string, packageId: string) => {
    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipmentId
          ? { ...s, packages: s.packages.filter((p) => p.id !== packageId) }
          : s,
      ),
    );
  };

  // ============================================================================
  // Per-Package Item Assignment
  // ============================================================================

  const addItemToPackage = (
    shipmentId: string,
    packageId: string,
    item: ShipmentItem,
    quantity: number,
  ) => {
    setShipments((prev) =>
      prev.map((shipment) => {
        if (shipment.id !== shipmentId) return shipment;
        return {
          ...shipment,
          packages: shipment.packages.map((pkg) => {
            if (pkg.id !== packageId) return pkg;
            const existing = pkg.items.find((i) => i.sku === item.sku);
            if (existing) {
              return {
                ...pkg,
                items: pkg.items.map((i) =>
                  i.sku === item.sku
                    ? { ...i, quantity: i.quantity + quantity }
                    : i,
                ),
              };
            }
            return {
              ...pkg,
              items: [...pkg.items, { ...item, quantity }],
            };
          }),
        };
      }),
    );
  };

  const removeItemFromPackage = (
    shipmentId: string,
    packageId: string,
    sku: string,
  ) => {
    setShipments((prev) =>
      prev.map((shipment) => {
        if (shipment.id !== shipmentId) return shipment;
        return {
          ...shipment,
          packages: shipment.packages.map((pkg) =>
            pkg.id === packageId
              ? { ...pkg, items: pkg.items.filter((i) => i.sku !== sku) }
              : pkg,
          ),
        };
      }),
    );
  };

  const updateItemQtyInPackage = (
    shipmentId: string,
    packageId: string,
    sku: string,
    quantity: number,
  ) => {
    setShipments((prev) =>
      prev.map((shipment) => {
        if (shipment.id !== shipmentId) return shipment;
        return {
          ...shipment,
          packages: shipment.packages.map((pkg) =>
            pkg.id === packageId
              ? {
                  ...pkg,
                  items: pkg.items.map((i) =>
                    i.sku === sku ? { ...i, quantity } : i,
                  ),
                }
              : pkg,
          ),
        };
      }),
    );
  };

  const getUnassignedItems = (shipment: Shipment) => {
    const assigned: Record<string, number> = {};
    for (const pkg of shipment.packages) {
      for (const item of pkg.items) {
        assigned[item.sku] = (assigned[item.sku] || 0) + item.quantity;
      }
    }
    return shipment.items
      .map((item) => ({
        ...item,
        remaining: item.quantity - (assigned[item.sku] || 0),
      }))
      .filter((item) => item.remaining > 0);
  };

  const autoDistributeItems = (shipmentId: string) => {
    setShipments((prev) =>
      prev.map((shipment) => {
        if (shipment.id !== shipmentId) return shipment;
        const pkgCount = shipment.packages.length;
        if (pkgCount === 0) return shipment;

        // For single package, assign all items
        if (pkgCount === 1) {
          return {
            ...shipment,
            packages: [
              {
                ...shipment.packages[0],
                items: shipment.items.map((item) => ({ ...item })),
              },
            ],
          };
        }

        // For multiple packages, spread items evenly
        const newPackages = shipment.packages.map((pkg) => ({
          ...pkg,
          items: [] as ShipmentItem[],
        }));

        for (const item of shipment.items) {
          let remaining = item.quantity;
          const perPkg = Math.ceil(item.quantity / pkgCount);
          for (let i = 0; i < pkgCount && remaining > 0; i++) {
            const qty = Math.min(perPkg, remaining);
            newPackages[i].items.push({ ...item, quantity: qty });
            remaining -= qty;
          }
        }

        return { ...shipment, packages: newPackages };
      }),
    );
  };

  const addMultiplePackagesWithWeightDistribution = (
    shipmentId: string,
    count: number,
  ) => {
    const shipment = shipments.find((s) => s.id === shipmentId);
    if (!shipment) return;

    const first = shipment.packages[0];
    const newPackages: PackageConfig[] = Array.from({ length: count }, () => ({
      id: generateId(),
      packageCode: first?.packageCode || "",
      weight: "",
      dimensions: first?.dimensions
        ? { ...first.dimensions }
        : { length: "12", width: "10", height: "6" },
      items: [],
    }));

    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipmentId ? { ...s, packages: newPackages } : s,
      ),
    );
    setNumberOfPackages("");
  };

  // ============================================================================
  // Validation & Submission
  // ============================================================================

  const validateShipments = (): string[] => {
    const errors: string[] = [];
    shipments.forEach((shipment) => {
      if (shipment.items.length === 0) {
        errors.push(`${shipment.name} must have at least one item`);
      }
      if (!shipment.carrierId || !shipment.serviceCode) {
        errors.push(`${shipment.name} needs carrier and service selected`);
      }
      if (shipment.packages.length === 0) {
        errors.push(`${shipment.name} must have at least one package`);
      } else {
        shipment.packages.forEach((pkg, i) => {
          if (!pkg.packageCode) {
            errors.push(
              `${shipment.name} package ${i + 1} needs a package type`,
            );
          }
          if (!pkg.weight || parseFloat(pkg.weight) <= 0) {
            errors.push(
              `${shipment.name} package ${i + 1} needs a valid weight`,
            );
          }
        });
      }
    });
    return errors;
  };

  const processShipments = async () => {
    const validationErrors = validateShipments();
    if (validationErrors.length > 0) {
      setError(validationErrors.join("; "));
      return;
    }

    setProcessing(true);
    setError("");

    try {
      const results: LabelResult[] = [];
      const shipment = shipments[0];
      const carrier = carriers.find((c) => c.carrier_id === shipment.carrierId);

      if (!carrier) throw new Error("Carrier not found");

      const shipmentData = {
        orderId: order.id,
        carrierCode: carrier.carrier_code,
        serviceCode: shipment.serviceCode,
        packages: shipment.packages.map((pkg) => {
          // Use per-package items if assigned, otherwise fall back to even distribution
          const pkgItems =
            pkg.items.length > 0
              ? pkg.items.map((item) => ({
                  productName: item.productName,
                  sku: item.sku,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                }))
              : shipment.items.map((item) => ({
                  productName: item.productName,
                  sku: item.sku,
                  quantity: Math.ceil(item.quantity / shipment.packages.length),
                  unitPrice: item.unitPrice,
                }));
          return {
            packageCode: pkg.packageCode,
            weight: parseFloat(pkg.weight),
            length: parseFloat(pkg.dimensions.length),
            width: parseFloat(pkg.dimensions.width),
            height: parseFloat(pkg.dimensions.height),
            items: pkgItems,
          };
        }),
        shippingAddress: {
          name: order.shippingAddress.name || order.customerName,
          address1: order.shippingAddress.address1,
          city: order.shippingAddress.city,
          zip: order.shippingAddress.zip,
          province: order.shippingAddress.province,
          province_code: order.shippingAddress.province_code,
          country_code: order.shippingAddress.country_code || "US",
        },
        items: shipment.items.map((item) => ({
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        notes: shipment.notes,
      };

      const response = await apiClient.post<{
        success: boolean;
        labels: LabelResult[];
        label: LabelResult;
      }>("/shipping/create-label", shipmentData);

      if (response.labels && response.labels.length > 0) {
        results.push(...response.labels);
      } else if (response.label) {
        results.push(response.label);
      }

      if (onSuccess) {
        onSuccess(results);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setProcessing(false);
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={embedded ? "" : "p-4"}>
      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-800">{error}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* Quick Access Presets */}
        {shipments.length === 1 &&
          !shipments[0].carrierId &&
          quickAccessPresets.length > 0 && (
            <div className="border border-blue-100 rounded-lg p-4 bg-gray-100 border-border">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                Quick Start Presets
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {quickAccessPresets.slice(0, 4).map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(shipments[0].id, preset)}
                    className="text-left p-3 border border-border rounded-lg bg-white hover:border-blue-500 hover:shadow-md transition-all"
                  >
                    <div className="font-medium text-sm">{preset.label}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      {preset.serviceName}
                      {preset.isFlatRate && (
                        <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                          Flat Rate
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowPresetSelector(true)}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                View all presets →
              </button>
            </div>
          )}

        {/* Shipment Configuration */}
        {shipments.map((shipment) => (
          <div key={shipment.id} className="space-y-4">
            {/* Carrier & Service */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium block mb-2">
                  Carrier
                </label>
                <select
                  value={shipment.carrierId}
                  onChange={(e) => {
                    updateShippingConfig(
                      shipment.id,
                      "carrierId",
                      e.target.value,
                    );
                    updateShippingConfig(shipment.id, "serviceCode", "");
                  }}
                  disabled={carriersLoading}
                  className="w-full px-3 py-2 border border-border rounded text-sm"
                >
                  <option value="">
                    {carriersLoading ? "Loading..." : "Select Carrier"}
                  </option>
                  {carriers.map((c) => (
                    <option key={c.carrier_id} value={c.carrier_id}>
                      {c.friendly_name}
                    </option>
                  ))}
                </select>
              </div>

              {shipment.carrierId && (
                <div>
                  <label className="text-sm font-medium block mb-2">
                    Service
                  </label>
                  <select
                    value={shipment.serviceCode}
                    onChange={(e) =>
                      updateShippingConfig(
                        shipment.id,
                        "serviceCode",
                        e.target.value,
                      )
                    }
                    className="w-full px-3 py-2 border border-border rounded text-sm"
                  >
                    <option value="">Select Service</option>
                    {getCarrierOptions(shipment.carrierId).services.map((s) => (
                      <option key={s.service_code} value={s.service_code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Presets for Carrier */}
            {shipment.carrierId &&
              getPresetsForCarrier(shipment.carrierId).length > 0 && (
                <div className="border border-border rounded-lg p-3 bg-blue-50">
                  <h4 className="text-sm font-medium mb-2">
                    Available Presets
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {getPresetsForCarrier(shipment.carrierId).map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => applyPreset(shipment.id, preset)}
                        className="text-left p-2 border rounded bg-white hover:border-blue-500 transition-colors text-xs"
                      >
                        <div className="font-medium">{preset.label}</div>
                        {preset.purpose && (
                          <div className="text-gray-600 mt-1">
                            {preset.purpose}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {/* Package Details */}
            {shipment.carrierId && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium">Package Details</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={numberOfPackages}
                      onChange={(e) => setNumberOfPackages(e.target.value)}
                      placeholder="# pkgs"
                      className="w-20 px-2 py-1 text-sm border border-border rounded"
                    />
                    <button
                      onClick={() => {
                        const count = parseInt(numberOfPackages);
                        if (count > 0 && count <= 20) {
                          addMultiplePackagesWithWeightDistribution(
                            shipment.id,
                            count,
                          );
                        }
                      }}
                      disabled={
                        !numberOfPackages || parseInt(numberOfPackages) <= 0
                      }
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      Set
                    </button>
                    {shipment.packages.length < 20 && (
                      <button
                        onClick={() => addPackageToShipment(shipment.id)}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                      </button>
                    )}
                  </div>
                </div>

                {/* Package List */}
                <div className="space-y-3">
                  {/* Auto-distribute button for multi-package */}
                  {shipment.packages.length > 1 && (
                    <button
                      onClick={() => autoDistributeItems(shipment.id)}
                      className="w-full px-3 py-2 text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 flex items-center justify-center gap-2 transition"
                    >
                      <Shuffle className="w-4 h-4" />
                      Auto-distribute items across packages
                    </button>
                  )}

                  {shipment.packages.map((pkg, idx) => {
                    const unassigned = getUnassignedItems(shipment);
                    const pkgItemCount = pkg.items.reduce(
                      (sum, i) => sum + i.quantity,
                      0,
                    );

                    return (
                      <PackageCard
                        key={pkg.id}
                        pkg={pkg}
                        idx={idx}
                        shipment={shipment}
                        unassigned={unassigned}
                        pkgItemCount={pkgItemCount}
                        multiPackage={shipment.packages.length > 1}
                        carrierPackages={
                          getCarrierOptions(shipment.carrierId).packages
                        }
                        onRemove={() =>
                          removePackageFromShipment(shipment.id, pkg.id)
                        }
                        onUpdateConfig={(field, value) =>
                          updatePackageConfig(shipment.id, pkg.id, field, value)
                        }
                        onAddItem={(item, qty) =>
                          addItemToPackage(shipment.id, pkg.id, item, qty)
                        }
                        onRemoveItem={(sku) =>
                          removeItemFromPackage(shipment.id, pkg.id, sku)
                        }
                        onUpdateItemQty={(sku, qty) =>
                          updateItemQtyInPackage(shipment.id, pkg.id, sku, qty)
                        }
                      />
                    );
                  })}
                </div>

                {/* Unassigned items warning */}
                {shipment.packages.length > 1 &&
                  (() => {
                    const unassigned = getUnassignedItems(shipment);
                    if (unassigned.length === 0) return null;
                    return (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-800">
                              Unassigned items
                            </p>
                            <div className="mt-1 space-y-0.5">
                              {unassigned.map((item) => (
                                <div
                                  key={item.sku}
                                  className="text-xs text-amber-700"
                                >
                                  {item.sku} — {item.remaining} remaining
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-amber-600 mt-1">
                              Unassigned items will be split evenly across
                              packages
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            )}

            {/* Items Summary (single package only) */}
            {shipment.packages.length <= 1 && shipment.items.length > 0 && (
              <div className="border border-border rounded-lg p-3 bg-gray-50">
                <h4 className="text-sm font-medium mb-2">Items to Ship</h4>
                <div className="space-y-1">
                  {shipment.items.map((item) => (
                    <div
                      key={item.itemId}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-gray-700">{item.sku}</span>
                      <span className="font-medium">× {item.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-border">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-6 py-2 border rounded hover:bg-gray-50"
              disabled={processing}
            >
              Cancel
            </button>
          )}
          <button
            onClick={processShipments}
            disabled={
              processing || shipments.every((s) => s.items.length === 0)
            }
            className="cursor-pointer transition px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center"
          >
            {processing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Creating Labels...
              </>
            ) : (
              <>
                <Truck className="w-5 h-5 mr-2" />
                Create Label
                {shipments[0]?.packages.length > 1
                  ? `s (${shipments[0].packages.length})`
                  : ""}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preset Selector Modal */}
      {showPresetSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Select Shipping Preset</h3>
              <button
                onClick={() => setShowPresetSelector(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(shipments[0].id, preset)}
                  className="text-left p-4 border rounded-lg hover:border-blue-500 hover:shadow-md transition-all"
                >
                  <div className="font-medium text-sm mb-1">{preset.label}</div>
                  <div className="text-xs text-gray-600 mb-2">
                    {preset.serviceName}
                  </div>
                  {preset.dimensions && (
                    <div className="text-xs text-gray-500">
                      {preset.dimensions.length}" × {preset.dimensions.width}" ×{" "}
                      {preset.dimensions.height}"
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    {preset.isFlatRate && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                        Flat Rate
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs uppercase">
                      {preset.carrier}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Package Card with Item Assignment
// ============================================================================

function PackageCard({
  pkg,
  idx,
  shipment,
  unassigned,
  pkgItemCount,
  multiPackage,
  carrierPackages,
  onRemove,
  onUpdateConfig,
  onAddItem,
  onRemoveItem,
  onUpdateItemQty,
}: {
  pkg: PackageConfig;
  idx: number;
  shipment: Shipment;
  unassigned: (ShipmentItem & { remaining: number })[];
  pkgItemCount: number;
  multiPackage: boolean;
  carrierPackages: Array<{ package_code: string; name: string }>;
  onRemove: () => void;
  onUpdateConfig: (field: string, value: string) => void;
  onAddItem: (item: ShipmentItem, qty: number) => void;
  onRemoveItem: (sku: string) => void;
  onUpdateItemQty: (sku: string, qty: number) => void;
}) {
  const [showItems, setShowItems] = useState(multiPackage);

  return (
    <div className="border border-border p-4 rounded bg-gray-50 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-emerald-600">
            Package {idx + 1}
          </span>
          {multiPackage && (
            <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
              {pkgItemCount} unit{pkgItemCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {multiPackage && (
            <button
              onClick={() => setShowItems(!showItems)}
              className="text-gray-500 hover:text-gray-700 p-1"
              title={showItems ? "Hide items" : "Show items"}
            >
              {showItems ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          )}
          {multiPackage && (
            <button
              onClick={onRemove}
              className="text-red-600 hover:text-red-800 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Package config */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Package Type</label>
          <select
            value={pkg.packageCode}
            onChange={(e) => onUpdateConfig("packageCode", e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-sm"
          >
            <option value="">Select Type</option>
            {carrierPackages.map((opt) => (
              <option key={opt.package_code} value={opt.package_code}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Weight (lbs)</label>
          <input
            type="number"
            step="0.1"
            placeholder="0.0"
            value={pkg.weight}
            onChange={(e) => onUpdateConfig("weight", e.target.value)}
            className="w-full px-3 py-2 border border-border rounded text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium block mb-1">
          Dimensions (in)
        </label>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            placeholder="L"
            value={pkg.dimensions.length}
            onChange={(e) =>
              onUpdateConfig("dimensions.length", e.target.value)
            }
            className="px-3 py-2 border border-border rounded text-sm"
          />
          <input
            type="number"
            placeholder="W"
            value={pkg.dimensions.width}
            onChange={(e) => onUpdateConfig("dimensions.width", e.target.value)}
            className="px-3 py-2 border border-border rounded text-sm"
          />
          <input
            type="number"
            placeholder="H"
            value={pkg.dimensions.height}
            onChange={(e) =>
              onUpdateConfig("dimensions.height", e.target.value)
            }
            className="px-3 py-2 border border-border rounded text-sm"
          />
        </div>
      </div>

      {/* Per-package item assignment (multi-package only) */}
      {multiPackage && showItems && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Items in this package
            </span>
          </div>

          {/* Assigned items */}
          {pkg.items.length > 0 ? (
            <div className="space-y-1">
              {pkg.items.map((item) => (
                <div
                  key={item.sku}
                  className="flex items-center gap-2 p-2 bg-white rounded border border-gray-200"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-blue-600">
                      {item.sku}
                    </span>
                    <span className="text-xs text-gray-400 ml-1 truncate">
                      {item.productName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (item.quantity <= 1) {
                          onRemoveItem(item.sku);
                        } else {
                          onUpdateItemQty(item.sku, item.quantity - 1);
                        }
                      }}
                      className="w-6 h-6 flex items-center justify-center bg-gray-100 rounded text-gray-600 hover:bg-gray-200 text-xs font-bold"
                    >
                      −
                    </button>
                    <span className="text-sm font-bold w-8 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() =>
                        onUpdateItemQty(item.sku, item.quantity + 1)
                      }
                      className="w-6 h-6 flex items-center justify-center bg-gray-100 rounded text-gray-600 hover:bg-gray-200 text-xs font-bold"
                    >
                      +
                    </button>
                    <button
                      onClick={() => onRemoveItem(item.sku)}
                      className="ml-1 text-red-400 hover:text-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-400 italic py-2 text-center">
              No items assigned yet
            </div>
          )}

          {/* Add from unassigned */}
          {unassigned.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Add items:</span>
              {unassigned.map((item) => (
                <button
                  key={item.sku}
                  onClick={() =>
                    onAddItem(
                      {
                        itemId: item.itemId,
                        productName: item.productName,
                        sku: item.sku,
                        unitPrice: item.unitPrice,
                        quantity: 0,
                      },
                      item.remaining,
                    )
                  }
                  className="w-full flex items-center justify-between p-2 bg-emerald-50 border border-emerald-200 rounded text-xs hover:bg-emerald-100 transition"
                >
                  <span>
                    <span className="font-mono text-emerald-700">
                      {item.sku}
                    </span>
                    <span className="text-gray-500 ml-1">
                      ({item.remaining} available)
                    </span>
                  </span>
                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
