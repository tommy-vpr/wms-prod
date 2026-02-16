/**
 * Fulfillment Detail Page
 * Step-by-step pick → pack → ship workflow for a single order.
 * Supports both direct packing and bin-based packing workflows.
 *
 * Save to: apps/web/src/pages/fulfillment/FulfillmentDetail.tsx
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import {
  ArrowLeft,
  Package,
  ScanBarcode,
  CheckCircle2,
  Truck,
  BoxIcon,
  MapPin,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  XCircle,
  Clock,
  Wifi,
  WifiOff,
  FileText,
  Inbox,
  Camera,
  Scale,
  Plus,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useFulfillmentStream } from "@/hooks/useFulfillmentStream";
import ShippingLabelForm from "@/components/shipping/ShippingLabelForm";
import {
  PackingImageUpload,
  type PackingImage,
} from "@/components/packing/PackingImageUpload";
import JsBarcode from "jsbarcode";

// ============================================================================
// Types
// ============================================================================

interface PickScanDetail {
  taskItemId: string;
  sequence: number;
  status: string;
  quantityRequired: number;
  quantityCompleted: number;
  expectedItemBarcodes: string[];
  expectedLocationBarcode: string | null;
  sku: string | null;
  variantName: string | null;
  imageUrl: string | null;
  locationName: string | null;
  locationDetail: {
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    bin: string | null;
  } | null;
}

interface PackScanDetail {
  taskItemId: string;
  sequence: number;
  status: string;
  quantityRequired: number;
  quantityCompleted: number;
  expectedItemBarcodes: string[];
  sku: string | null;
  variantName: string | null;
  imageUrl: string | null;
}

interface ScanLookup {
  pick: Record<string, PickScanDetail>;
  pack: Record<string, PackScanDetail>;
  barcodeLookup: Record<string, { taskItemId: string; type: "pick" | "pack" }>;
}

interface TaskItem {
  id: string;
  sequence: number;
  status: string;
  quantityRequired: number;
  quantityCompleted: number;
  productVariant: {
    id: string;
    sku: string;
    upc: string | null;
    barcode: string | null;
    name: string;
    imageUrl: string | null;
  } | null;
  location?: {
    id: string;
    name: string;
    barcode: string | null;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    bin: string | null;
  } | null;
}

interface WorkTask {
  id: string;
  taskNumber: string;
  type: string;
  status: string;
  totalItems: number;
  completedItems: number;
  taskItems: TaskItem[];
  packedWeight?: number;
  packedWeightUnit?: string;
  packedDimensions?: {
    length: number;
    width: number;
    height: number;
    unit: string;
  };
}

interface PackingPackageItem {
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface PackingPackage {
  id: string;
  label: string;
  items: PackingPackageItem[];
}

interface PickBinItem {
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

interface PickBin {
  id: string;
  binNumber: string;
  barcode: string;
  status: string;
  items: PickBinItem[];
}

interface FulfillmentStatus {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    trackingNumber: string | null;
    shippedAt: string | null;
    createdAt: string;
    customerName: string;
    shippingAddress: any;
    priority: string;
    items: Array<{
      id: string;
      sku: string;
      quantity: number;
      quantityPicked: number;
      productVariant: {
        id: string;
        sku: string;
        upc: string | null;
        barcode: string | null;
        name: string;
        imageUrl: string | null;
      } | null;
    }>;
  };
  packingImages: PackingImage[];
  currentStep: string;
  picking: WorkTask | null;
  packing: WorkTask | null;
  pickBin: PickBin | null;
  shipping: Array<{
    id: string;
    carrier: string;
    service: string;
    trackingNumber: string;
    trackingUrl: string | null;
    rate: number;
    labelUrl: string | null;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    type: string;
    payload: any;
    createdAt: string;
  }>;
  scanLookup: ScanLookup;
}

// ============================================================================
// Constants
// ============================================================================

const STEPS = [
  { key: "awaiting_pick", label: "Allocated", icon: Package },
  { key: "picking", label: "Picking", icon: ScanBarcode },
  { key: "awaiting_pack", label: "Picked", icon: CheckCircle2 },
  { key: "bin_label", label: "Bin Label", icon: FileText }, // ← NEW
  { key: "packing", label: "Packing", icon: BoxIcon },
  { key: "awaiting_ship", label: "Packed", icon: Package },
  { key: "shipped", label: "Shipped", icon: Truck },
] as const;

type ScanPhase = "scan_location" | "scan_item";
type PackingMode = "direct" | "bin";

// ============================================================================
// Main Component
// ============================================================================

export default function FulfillmentDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Check if coming from pack station with bin
  const fromBin = searchParams.get("fromBin") === "true";

  // ── State ───────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<FulfillmentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);

  // Pick scan state
  const [scanPhase, setScanPhase] = useState<ScanPhase>("scan_location");
  const [scanFeedback, setScanFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracking label printed
  const [binLabelPrinted, setBinLabelPrinted] = useState(false);

  // Packing mode: "direct" (old flow) or "bin" (new bin verification flow)
  const [packingMode, setPackingMode] = useState<PackingMode | null>(null);

  // Scan denomination: 0 = Full (confirm entire qty), 1/5/10/50 = per-scan count
  const [scanMultiplier, setScanMultiplier] = useState<number>(0);
  // Tracks accumulated scans per taskItemId when using denomination mode in picking
  const [pickAccumulator, setPickAccumulator] = useState<
    Record<string, number>
  >({});

  // Per-package item tracking during packing (bridges to shipping form)
  const [packingPackages, setPackingPackages] = useState<PackingPackage[]>([
    { id: "pkg-1", label: "Package 1", items: [] },
  ]);
  const [activePackingPackageId, setActivePackingPackageId] = useState("pkg-1");
  const packingPkgCounter = useRef(1);

  // Pack form state
  const [packWeight, setPackWeight] = useState("");
  const [packWeightUnit, setPackWeightUnit] = useState("ounce");
  const [packLength, setPackLength] = useState("");
  const [packWidth, setPackWidth] = useState("");
  const [packHeight, setPackHeight] = useState("");

  // Packing images state
  const packingImages = status?.packingImages ?? [];

  // ── SSE for live events ─────────────────────────────────────────────────
  const { events: sseEvents, connected } = useFulfillmentStream({
    orderId,
    enabled: !!orderId,
  });

  // Refetch when meaningful SSE events arrive
  const lastSseEventId = useRef<string | null>(null);
  useEffect(() => {
    if (sseEvents.length === 0) return;
    const latest = sseEvents[sseEvents.length - 1];
    if (latest?.id && latest.id !== lastSseEventId.current) {
      lastSseEventId.current = latest.id;
      const stateEvents = [
        "order:",
        "picklist:completed",
        "packing:completed",
        "pickbin:",
        "shipping:",
      ];
      if (stateEvents.some((p) => latest.type?.startsWith(p))) {
        fetchStatus();
      }
    }
  }, [sseEvents]);

  // ── Data Fetching ───────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const data = await apiClient.get<FulfillmentStatus>(
        `/fulfillment/${orderId}/status`,
      );
      setStatus(data);
      setError(null);

      // Auto-select bin mode if bin exists and we're at packing step
      if (data.pickBin && data.currentStep === "awaiting_pack") {
        setPackingMode("bin");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // If coming from pack station, auto-start bin verification
  useEffect(() => {
    if (fromBin && status?.pickBin && !packingMode) {
      setPackingMode("bin");
    }
  }, [fromBin, status?.pickBin, packingMode]);

  // ── Scan Feedback Helper ────────────────────────────────────────────────
  const showFeedback = (type: "success" | "error", message: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setScanFeedback({ type, message });
    feedbackTimer.current = setTimeout(() => setScanFeedback(null), 2500);
  };

  // ── Get Current Pick Item ───────────────────────────────────────────────
  const getCurrentPickItem = (): PickScanDetail | null => {
    if (!status?.scanLookup?.pick) return null;
    const items = Object.values(status.scanLookup.pick).sort(
      (a, b) => a.sequence - b.sequence,
    );
    return (
      items.find(
        (i) =>
          i.status !== "COMPLETED" &&
          i.status !== "SKIPPED" &&
          i.status !== "SHORT",
      ) || null
    );
  };

  // ── Get Current Pack Item (direct mode) ─────────────────────────────────
  const getCurrentPackItem = (): PackScanDetail | null => {
    if (!status?.scanLookup?.pack) return null;
    const items = Object.values(status.scanLookup.pack).sort(
      (a, b) => a.sequence - b.sequence,
    );
    return items.find((i) => i.status !== "COMPLETED") || null;
  };

  // ── Bin verification helpers ────────────────────────────────────────────
  const getBinProgress = () => {
    if (!status?.pickBin)
      return { total: 0, verified: 0, progress: 0, allVerified: false };
    const total = status.pickBin.items.reduce((sum, i) => sum + i.quantity, 0);
    const verified = status.pickBin.items.reduce(
      (sum, i) => sum + i.verifiedQty,
      0,
    );
    return {
      total,
      verified,
      progress: total > 0 ? (verified / total) * 100 : 0,
      allVerified: verified >= total && total > 0,
    };
  };

  // ── Barcode Scanner Handler ─────────────────────────────────────────────
  const handleScan = useCallback(
    async (barcode: string) => {
      if (!status || actionLoading) return;

      const step = status.currentStep;

      // ── PICKING: two-phase scan ──────────────────────────────────────
      if (step === "picking") {
        const current = getCurrentPickItem();
        if (!current) return;

        if (scanPhase === "scan_location") {
          if (!current.expectedLocationBarcode) {
            setScanPhase("scan_item");
            showFeedback("success", "No location barcode — scan item");
            return;
          }

          if (barcode === current.expectedLocationBarcode) {
            setScanPhase("scan_item");
            showFeedback("success", `✓ Location: ${current.locationName}`);
          } else {
            showFeedback(
              "error",
              `✗ Wrong location — expected ${current.locationName}`,
            );
          }
          return;
        }

        if (scanPhase === "scan_item") {
          if (current.expectedItemBarcodes.includes(barcode)) {
            if (scanMultiplier === 0) {
              // Full mode — confirm entire quantity immediately (default)
              await confirmPick(current.taskItemId, current.quantityRequired);
              setScanPhase("scan_location");
              showFeedback(
                "success",
                `✓ Picked: ${current.sku} ×${current.quantityRequired}`,
              );
            } else {
              // Denomination mode — accumulate scans
              const prev = pickAccumulator[current.taskItemId] || 0;
              const next = Math.min(
                prev + scanMultiplier,
                current.quantityRequired,
              );
              setPickAccumulator((a) => ({
                ...a,
                [current.taskItemId]: next,
              }));

              if (next >= current.quantityRequired) {
                // Reached full quantity — auto-confirm
                await confirmPick(current.taskItemId, current.quantityRequired);
                setPickAccumulator((a) => {
                  const copy = { ...a };
                  delete copy[current.taskItemId];
                  return copy;
                });
                setScanPhase("scan_location");
                showFeedback(
                  "success",
                  `✓ Picked: ${current.sku} ×${current.quantityRequired}`,
                );
              } else {
                showFeedback(
                  "success",
                  `${current.sku}: ${next}/${current.quantityRequired} scanned`,
                );
              }
            }
          } else {
            showFeedback("error", `✗ Wrong item — expected ${current.sku}`);
          }
          return;
        }
      }

      // ── BIN LABEL: scan bin barcode to start packing ─────────────────
      if (
        step === "awaiting_pack" &&
        packingMode === "bin" &&
        !binLabelPrinted &&
        status.pickBin
      ) {
        if (barcode === status.pickBin.barcode) {
          setBinLabelPrinted(true);
          showFeedback(
            "success",
            `✓ Bin ${status.pickBin.binNumber} scanned — ready to verify items`,
          );
        } else {
          showFeedback("error", `Scan bin barcode to start packing`);
        }
        return;
      }

      // ── PACKING (BIN MODE): verify items from bin ────────────────────
      if (
        (step === "awaiting_pack" || step === "packing") &&
        packingMode === "bin" &&
        binLabelPrinted &&
        status.pickBin
      ) {
        // Check if user scanned bin barcode again
        if (barcode === status.pickBin.barcode) {
          showFeedback(
            "success",
            `Bin already scanned — scan item UPCs to verify`,
          );
          return;
        }

        // Find matching bin item to send denomination-aware quantity
        const matchingBinItem = status.pickBin.items.find(
          (i) =>
            i.sku === barcode ||
            i.productVariant?.upc === barcode ||
            i.productVariant?.barcode === barcode,
        );
        const remaining = matchingBinItem
          ? matchingBinItem.quantity - matchingBinItem.verifiedQty
          : undefined;

        // Denomination: 0 = full remaining, otherwise use multiplier
        const sendQty =
          scanMultiplier === 0 || !remaining
            ? remaining
            : Math.min(scanMultiplier, remaining);

        setActionLoading(true);
        try {
          const result = await apiClient.post<{
            verified: boolean;
            item: { sku: string; verifiedQty: number; quantity: number };
            allVerified: boolean;
          }>(`/fulfillment/bin/${status.pickBin.id}/verify`, {
            barcode,
            quantity: sendQty,
          });

          if (result.verified) {
            // Assign scanned item to active packing package
            assignItemToPackingPackage(
              result.item.sku,
              result.item.sku,
              sendQty || 1,
            );
            showFeedback(
              "success",
              `✓ ${result.item.sku} (${result.item.verifiedQty}/${result.item.quantity})`,
            );
            await fetchStatus();
          } else {
            showFeedback("error", `${result.item.sku} already fully verified`);
          }
        } catch (err: any) {
          showFeedback("error", err.message || "Item not in bin");
        } finally {
          setActionLoading(false);
        }
        return;
      }

      // ── PACKING (DIRECT MODE): single scan to verify ─────────────────
      if (step === "packing" && packingMode === "direct") {
        const lookup = status.scanLookup.barcodeLookup[barcode];
        if (lookup && lookup.type === "pack") {
          await verifyPackItem(lookup.taskItemId);
          const packDetail = status.scanLookup.pack[lookup.taskItemId];
          showFeedback("success", `✓ Verified: ${packDetail?.sku || barcode}`);
        } else {
          showFeedback("error", `✗ Unknown barcode: ${barcode}`);
        }
        return;
      }
    },
    [
      status,
      actionLoading,
      scanPhase,
      packingMode,
      binLabelPrinted,
      scanMultiplier,
      pickAccumulator,
    ],
  );

  useBarcodeScanner({
    onScan: handleScan,
    enabled:
      !loading &&
      (status?.currentStep === "picking" ||
        status?.currentStep === "packing" ||
        (status?.currentStep === "awaiting_pack" && packingMode === "bin")),
  });

  // ── Actions ─────────────────────────────────────────────────────────────
  async function generatePickList() {
    if (!orderId || actionLoading) return;
    setActionLoading(true);
    try {
      await apiClient.post(`/fulfillment/${orderId}/pick`);
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmPick(taskItemId: string, quantity: number) {
    if (!orderId || actionLoading) return;
    setActionLoading(true);
    try {
      await apiClient.post(
        `/fulfillment/${orderId}/pick/${taskItemId}/confirm`,
        { quantity, locationScanned: true, itemScanned: true },
      );
      await fetchStatus();
      setScanPhase("scan_location");
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmAllPick() {
    if (!orderId || actionLoading) return;
    setActionLoading(true);
    try {
      const result = await apiClient.post<{
        confirmed: number;
        taskComplete: boolean;
      }>(`/fulfillment/${orderId}/pick/confirm-all`);
      showFeedback("success", `✓ Confirmed ${result.confirmed} items`);
      await fetchStatus();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function startDirectPacking() {
    if (!orderId || actionLoading) return;
    setActionLoading(true);
    try {
      await apiClient.post(`/fulfillment/${orderId}/pack`);
      setPackingMode("direct");
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function startBinPacking() {
    setPackingMode("bin");
  }

  async function verifyPackItem(taskItemId: string) {
    if (!orderId || actionLoading) return;
    setActionLoading(true);
    try {
      await apiClient.post(`/fulfillment/${orderId}/pack/${taskItemId}/verify`);
      await fetchStatus();
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setActionLoading(false);
    }
  }

  // ── Packing Package Management ────────────────────────────────────────────

  function addPackingPackage() {
    packingPkgCounter.current += 1;
    const id = `pkg-${packingPkgCounter.current}`;
    setPackingPackages((prev) => [
      ...prev,
      { id, label: `Package ${packingPkgCounter.current}`, items: [] },
    ]);
    setActivePackingPackageId(id);
  }

  function removePackingPackage(pkgId: string) {
    setPackingPackages((prev) => {
      const updated = prev.filter((p) => p.id !== pkgId);
      if (updated.length === 0) {
        const fallback = { id: "pkg-1", label: "Package 1", items: [] };
        setActivePackingPackageId("pkg-1");
        return [fallback];
      }
      return updated;
    });
    if (activePackingPackageId === pkgId) {
      setActivePackingPackageId((prev) => {
        const remaining = packingPackages.filter((p) => p.id !== pkgId);
        return remaining.length > 0 ? remaining[0].id : "pkg-1";
      });
    }
  }

  function assignItemToPackingPackage(
    sku: string,
    productName: string,
    quantity: number,
    unitPrice: number = 0,
  ) {
    setPackingPackages((prev) =>
      prev.map((pkg) => {
        if (pkg.id !== activePackingPackageId) return pkg;
        const existing = pkg.items.find((i) => i.sku === sku);
        if (existing) {
          return {
            ...pkg,
            items: pkg.items.map((i) =>
              i.sku === sku ? { ...i, quantity: i.quantity + quantity } : i,
            ),
          };
        }
        return {
          ...pkg,
          items: [...pkg.items, { sku, productName, quantity, unitPrice }],
        };
      }),
    );
  }

  function autoDistributePackingItems() {
    if (!status?.pickBin) return;
    const items = status.pickBin.items;
    const pkgCount = packingPackages.length;
    if (pkgCount === 0) return;

    setPackingPackages((prev) => {
      const cleared = prev.map((p) => ({
        ...p,
        items: [] as PackingPackageItem[],
      }));
      for (const item of items) {
        if (pkgCount === 1) {
          cleared[0].items.push({
            sku: item.sku,
            productName: item.productVariant?.name || item.sku,
            quantity: item.quantity,
            unitPrice: 0,
          });
        } else {
          let remaining = item.quantity;
          const perPkg = Math.ceil(item.quantity / pkgCount);
          for (let i = 0; i < pkgCount && remaining > 0; i++) {
            const qty = Math.min(perPkg, remaining);
            const existing = cleared[i].items.find((e) => e.sku === item.sku);
            if (existing) {
              existing.quantity += qty;
            } else {
              cleared[i].items.push({
                sku: item.sku,
                productName: item.productVariant?.name || item.sku,
                quantity: qty,
                unitPrice: 0,
              });
            }
            remaining -= qty;
          }
        }
      }
      return cleared;
    });
  }

  // ── Verify Functions ───────────────────────────────────────────────────

  async function verifyBinItemWithQty(barcode: string, quantity: number) {
    if (!status?.pickBin || actionLoading) return;
    setActionLoading(true);
    try {
      const result = await apiClient.post<{
        verified: boolean;
        item: { sku: string; verifiedQty: number; quantity: number };
        allVerified: boolean;
      }>(`/fulfillment/bin/${status.pickBin.id}/verify`, { barcode, quantity });

      if (result.verified) {
        // Assign to active packing package
        assignItemToPackingPackage(
          result.item.sku,
          result.item.sku, // productName fallback
          quantity,
        );
        showFeedback(
          "success",
          `✓ ${result.item.sku} (${result.item.verifiedQty}/${result.item.quantity})`,
        );
      } else {
        showFeedback("error", `${result.item.sku} already fully verified`);
      }
      await fetchStatus();
    } catch (err: any) {
      showFeedback("error", err.message || "Verify failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function verifyAllBinItems() {
    if (!status?.pickBin || actionLoading) return;
    setActionLoading(true);
    try {
      let verified = 0;
      for (const item of status.pickBin.items) {
        const remaining = item.quantity - item.verifiedQty;
        if (remaining > 0) {
          await apiClient.post(`/fulfillment/bin/${status.pickBin.id}/verify`, {
            barcode: item.sku,
            quantity: remaining,
          });
          // Assign to active packing package
          assignItemToPackingPackage(
            item.sku,
            item.productVariant?.name || item.sku,
            remaining,
          );
          verified++;
        }
      }
      showFeedback("success", `✓ Verified all ${verified} remaining items`);
      await fetchStatus();
    } catch (err: any) {
      showFeedback("error", err.message || "Verify all failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function completePacking() {
    if (!orderId || actionLoading) return;

    const weight = parseFloat(packWeight);
    if (!weight || weight <= 0) {
      setError("Enter a valid weight");
      return;
    }

    if (packingImages.length === 0) {
      setError("Add at least one packing photo");
      return;
    }

    setActionLoading(true);
    try {
      if (packingMode === "bin" && status?.pickBin) {
        // Complete bin + packing in one call
        await apiClient.post(`/fulfillment/${orderId}/pack/complete-from-bin`, {
          binId: status.pickBin.id,
          weight,
          weightUnit: packWeightUnit,
          dimensions:
            packLength && packWidth && packHeight
              ? {
                  length: parseFloat(packLength),
                  width: parseFloat(packWidth),
                  height: parseFloat(packHeight),
                  unit: "inch",
                }
              : undefined,
        });
      } else if (status?.packing) {
        // Direct packing completion
        await apiClient.post(`/fulfillment/${orderId}/pack/complete`, {
          taskId: status.packing.id,
          weight,
          weightUnit: packWeightUnit,
          dimensions:
            packLength && packWidth && packHeight
              ? {
                  length: parseFloat(packLength),
                  width: parseFloat(packWidth),
                  height: parseFloat(packHeight),
                  unit: "inch",
                }
              : undefined,
        });
      }
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  // ── Loading / Error States ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error || "Order not found"}
        </div>
        <Link
          to="/fulfillment"
          className="mt-4 inline-flex items-center gap-1 text-blue-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to fulfillment
        </Link>
      </div>
    );
  }

  const {
    order,
    currentStep,
    picking,
    packing,
    pickBin,
    shipping,
    scanLookup,
  } = status;
  const binProgress = getBinProgress();

  // Determine effective step for progress display
  const effectiveStep = (() => {
    if (packingMode === "bin" && currentStep === "awaiting_pack") {
      if (!binLabelPrinted && !binProgress.verified) {
        return "bin_label"; // Show print label step
      }
      return "packing"; // Show verification step
    }
    return currentStep;
  })();

  // Determine what to show
  const showBinLabelStep =
    packingMode === "bin" &&
    pickBin &&
    currentStep === "awaiting_pack" &&
    !binLabelPrinted;

  const showBinVerification =
    packingMode === "bin" &&
    pickBin &&
    currentStep === "awaiting_pack" &&
    binLabelPrinted &&
    !binProgress.allVerified;

  const showBinPackingComplete =
    packingMode === "bin" && pickBin && binProgress.allVerified;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/fulfillment")}
            className="cursor-pointer p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl lg:text-2xl font-bold">
                {order.orderNumber}
              </h1>
              <OrderStatusBadge status={order.status} />
              {order.priority !== "NORMAL" && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                  {order.priority}
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm">
              {order.customerName} · {order.items.length} item
              {order.items.length !== 1 ? "s" : ""}
              {pickBin && (
                <span className="ml-2 text-blue-600">
                  · Bin: {pickBin.binNumber}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-gray-400">
            {connected ? (
              <Wifi className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
            )}
            <span>{connected ? "Live" : "Offline"}</span>
          </div>
          <button
            onClick={fetchStatus}
            className="cursor-pointer p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Scan Feedback Toast ──────────────────────────────────────────── */}
      {scanFeedback && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
            scanFeedback.type === "success"
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {scanFeedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          {scanFeedback.message}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button
            onClick={() => setError(null)}
            className="cursor-pointer ml-auto text-red-400 hover:text-red-600"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Step Progress ────────────────────────────────────────────────── */}
      <StepProgress currentStep={effectiveStep} />

      {/* ── Main Layout ──────────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* ── STEP: Awaiting Pick ──────────────────────────────────────── */}
          {currentStep === "awaiting_pick" && (
            <StepCard
              title="Ready to Pick"
              description={`${order.items.length} item${order.items.length !== 1 ? "s" : ""} allocated and ready for picking.`}
              icon={<Package className="w-5 h-5 text-blue-500" />}
            >
              <div className="space-y-2 mb-4">
                {order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg p-3"
                  >
                    <span className="font-mono text-blue-600 font-medium">
                      {item.sku}
                    </span>
                    <span className="text-gray-600 flex-1">
                      {item.productVariant?.name || "—"}
                    </span>
                    <span className="font-medium">×{item.quantity}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={generatePickList}
                disabled={actionLoading}
                className="cursor-pointer w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition"
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ScanBarcode className="w-4 h-4" />
                )}
                Generate Pick List
              </button>
            </StepCard>
          )}

          {/* ── STEP: Picking ────────────────────────────────────────────── */}
          {currentStep === "picking" && picking && (
            <PickingStep
              picking={picking}
              scanLookup={scanLookup}
              scanPhase={scanPhase}
              setScanPhase={setScanPhase}
              getCurrentPickItem={getCurrentPickItem}
              confirmPick={confirmPick}
              confirmAllPick={confirmAllPick}
              actionLoading={actionLoading}
              orderId={orderId!}
              scanMultiplier={scanMultiplier}
              setScanMultiplier={setScanMultiplier}
              pickAccumulator={pickAccumulator}
              setPickAccumulator={setPickAccumulator}
            />
          )}

          {/* ── STEP: Awaiting Pack (Handoff to Pack Station) ──────────── */}
          {currentStep === "awaiting_pack" && !packingMode && (
            <StepCard
              title="✅ Picking Complete"
              description="Hand off the bin to the pack station, or continue packing yourself."
              icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
            >
              {pickBin ? (
                <div className="space-y-4">
                  {/* Handoff card — prominent */}
                  <div className="bg-green-50 border-2 border-green-300 rounded-xl p-5 text-center">
                    <div className="text-5xl font-black text-green-700 mb-1">
                      {pickBin.binNumber}
                    </div>
                    <div className="text-sm text-green-600 mb-3">
                      {pickBin.items.length} SKUs · {binProgress.total} units
                    </div>
                    <div className="bg-white rounded-lg p-3 inline-block mx-auto mb-4">
                      <svg
                        ref={(el) => {
                          if (el) {
                            try {
                              JsBarcode(el, pickBin.barcode, {
                                format: "CODE128",
                                width: 2,
                                height: 60,
                                displayValue: true,
                                fontSize: 12,
                                margin: 5,
                              });
                            } catch {}
                          }
                        }}
                      />
                    </div>
                    <div className="text-green-800 font-medium text-sm">
                      Place bin at pack station for packer to scan
                    </div>
                  </div>

                  {/* Primary: Hand off → back to pick queue */}
                  <a
                    href="/pick"
                    className="block w-full py-4 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition text-center text-lg"
                  >
                    ✓ Done — Back to Pick Queue
                  </a>

                  {/* Divider */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400 uppercase tracking-wider">
                      or pack it yourself
                    </span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>

                  {/* Secondary: Continue to packing */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={startBinPacking}
                      className="cursor-pointer py-3 px-4 border-2 border-purple-200 text-purple-700 rounded-lg font-medium hover:bg-purple-50 transition flex flex-col items-center gap-1"
                    >
                      <ScanBarcode className="w-5 h-5" />
                      <span className="text-sm">Verify from Bin</span>
                    </button>
                    <button
                      onClick={startDirectPacking}
                      disabled={actionLoading}
                      className="cursor-pointer py-3 px-4 border-2 border-gray-200 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition flex flex-col items-center gap-1"
                    >
                      {actionLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <BoxIcon className="w-5 h-5" />
                      )}
                      <span className="text-sm">Direct Pack</span>
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={startDirectPacking}
                  disabled={actionLoading}
                  className="cursor-pointer w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2 transition"
                >
                  {actionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <BoxIcon className="w-4 h-4" />
                  )}
                  Generate Pack List
                </button>
              )}
            </StepCard>
          )}

          {/* ── STEP: Bin Label (Print) ──────────────────────────────────── */}
          {showBinLabelStep && pickBin && (
            <BinLabelStep
              pickBin={pickBin}
              orderNumber={order.orderNumber}
              onStartPacking={() => setBinLabelPrinted(true)}
              actionLoading={actionLoading}
            />
          )}

          {/* ── STEP: Bin Verification Mode ──────────────────────────────── */}
          {showBinVerification && pickBin && (
            <BinVerificationStep
              pickBin={pickBin}
              binProgress={binProgress}
              actionLoading={actionLoading}
              onVerifyItem={verifyBinItemWithQty}
              onVerifyAll={verifyAllBinItems}
              scanMultiplier={scanMultiplier}
              setScanMultiplier={setScanMultiplier}
              packingPackages={packingPackages}
              activePackingPackageId={activePackingPackageId}
              setActivePackingPackageId={setActivePackingPackageId}
              onAddPackingPackage={addPackingPackage}
              onRemovePackingPackage={removePackingPackage}
              onAutoDistribute={autoDistributePackingItems}
            />
          )}

          {/* ── STEP: Bin Packing Complete (Photos/Weight) ───────────────── */}
          {showBinPackingComplete && pickBin && (
            <StepCard
              title="Items Verified"
              description="Add packing photos and enter package details."
              icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
            >
              <PackingCompleteForm
                orderId={order.id}
                taskId={packing?.id}
                orderNumber={order.orderNumber}
                packingImages={packingImages}
                packWeight={packWeight}
                setPackWeight={setPackWeight}
                packWeightUnit={packWeightUnit}
                setPackWeightUnit={setPackWeightUnit}
                packLength={packLength}
                setPackLength={setPackLength}
                packWidth={packWidth}
                setPackWidth={setPackWidth}
                packHeight={packHeight}
                setPackHeight={setPackHeight}
                onComplete={completePacking}
                actionLoading={actionLoading}
                fetchStatus={fetchStatus}
              />
            </StepCard>
          )}

          {/* ── STEP: Packing (Direct Mode) ──────────────────────────────── */}
          {currentStep === "packing" && packing && packingMode === "direct" && (
            <DirectPackingStep
              packing={packing}
              scanLookup={scanLookup}
              getCurrentPackItem={getCurrentPackItem}
              verifyPackItem={verifyPackItem}
              actionLoading={actionLoading}
              packingImages={packingImages}
              orderId={order.id}
              orderNumber={order.orderNumber}
              packWeight={packWeight}
              setPackWeight={setPackWeight}
              packWeightUnit={packWeightUnit}
              setPackWeightUnit={setPackWeightUnit}
              packLength={packLength}
              setPackLength={setPackLength}
              packWidth={packWidth}
              setPackWidth={setPackWidth}
              packHeight={packHeight}
              setPackHeight={setPackHeight}
              onComplete={completePacking}
              fetchStatus={fetchStatus}
            />
          )}

          {/* ── STEP: Awaiting Ship ──────────────────────────────────────── */}
          {currentStep === "awaiting_ship" && (
            <StepCard
              title="Ready to Ship"
              description="Select carrier, service, and create shipping label."
              icon={<Truck className="w-5 h-5" />}
            >
              <ShippingLabelForm
                order={{
                  id: order.id,
                  orderNumber: order.orderNumber,
                  customerName: order.customerName,
                  status: order.status,
                  lineItems: order.items.map((item) => ({
                    id: item.id,
                    sku: item.sku,
                    name: item.productVariant?.name || item.sku,
                    quantity: item.quantity,
                    quantityPicked: item.quantityPicked,
                    unitPrice: 0,
                  })),
                  shippingAddress: order.shippingAddress,
                }}
                onSuccess={(labels) => {
                  labels.forEach((label) => {
                    if (label.labelUrl) {
                      window.open(label.labelUrl, "_blank");
                    }
                  });
                  fetchStatus();
                }}
                embedded
                initialWeight={
                  packing?.packedWeight
                    ? Number(packing.packedWeight)
                    : undefined
                }
                initialDimensions={
                  packing?.packedDimensions
                    ? {
                        length: packing.packedDimensions.length,
                        width: packing.packedDimensions.width,
                        height: packing.packedDimensions.height,
                      }
                    : undefined
                }
                initialPackages={
                  packingPackages.some((p) => p.items.length > 0)
                    ? packingPackages
                        .filter((p) => p.items.length > 0)
                        .map((p) => ({
                          label: p.label,
                          items: p.items.map((i) => ({
                            sku: i.sku,
                            productName: i.productName,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                          })),
                        }))
                    : undefined
                }
              />
            </StepCard>
          )}

          {/* ── STEP: Shipped ────────────────────────────────────────────── */}
          {(currentStep === "shipped" || currentStep === "delivered") &&
            shipping.length > 0 && (
              <ShippedStep
                shipping={shipping}
                packingImages={packingImages}
                orderId={order.id}
                orderNumber={order.orderNumber}
                packingTaskId={packing?.id}
              />
            )}
        </div>

        {/* ── Right: Event Timeline ──────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <EventTimeline
            events={status.events}
            showTimeline={showTimeline}
            setShowTimeline={setShowTimeline}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function StepProgress({ currentStep }: { currentStep: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="bg-white border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          const Icon = step.icon;

          return (
            <div
              key={step.key}
              className="flex items-center flex-1 last:flex-none"
            >
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                    isDone
                      ? "bg-green-100 text-green-600"
                      : isCurrent
                        ? "bg-blue-100 text-blue-600 ring-2 ring-blue-300"
                        : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <span
                  className={`text-[10px] mt-1 font-medium ${
                    isDone
                      ? "text-green-600"
                      : isCurrent
                        ? "text-blue-600"
                        : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-2">
                  <div
                    className={`h-0.5 rounded-full ${isDone ? "bg-green-400" : "bg-gray-200"}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">{description}</p>
      {children}
    </div>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: "bg-gray-100 text-gray-700",
    CONFIRMED: "bg-gray-100 text-gray-700",
    ALLOCATED: "bg-blue-100 text-blue-700",
    PICKING: "bg-blue-100 text-blue-700",
    PICKED: "bg-green-100 text-green-700",
    PACKING: "bg-purple-100 text-purple-700",
    PACKED: "bg-indigo-100 text-indigo-700",
    SHIPPED: "bg-cyan-100 text-cyan-700",
    DELIVERED: "bg-green-100 text-green-700",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
        colors[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status}
    </span>
  );
}

// ── Bin Verification Step ─────────────────────────────────────────────────

// ── Scan Denomination Selector ────────────────────────────────────────────

const DENOMINATIONS = [1, 5, 10, 50];

function ScanDenominationSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg">
      <span className="text-xs font-medium text-amber-800 mr-1 whitespace-nowrap">
        Per scan:
      </span>
      <button
        onClick={() => onChange(0)}
        className={`cursor-pointer px-3 py-1.5 rounded-md text-sm font-bold transition-all ${
          value === 0
            ? "bg-amber-500 text-white shadow-sm"
            : "bg-white text-amber-700 border border-amber-300 hover:border-amber-400"
        }`}
      >
        Full
      </button>
      {DENOMINATIONS.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`cursor-pointer px-3 py-1.5 rounded-md text-sm font-bold transition-all ${
            value === d
              ? "bg-amber-500 text-white shadow-sm"
              : "bg-white text-amber-700 border border-amber-300 hover:border-amber-400"
          }`}
        >
          ×{d}
        </button>
      ))}
    </div>
  );
}

// ── Bin Verification Step ─────────────────────────────────────────────────

function BinVerificationStep({
  pickBin,
  binProgress,
  actionLoading,
  onVerifyItem,
  onVerifyAll,
  scanMultiplier,
  setScanMultiplier,
  packingPackages,
  activePackingPackageId,
  setActivePackingPackageId,
  onAddPackingPackage,
  onRemovePackingPackage,
  onAutoDistribute,
}: {
  pickBin: PickBin;
  binProgress: {
    total: number;
    verified: number;
    progress: number;
    allVerified: boolean;
  };
  actionLoading: boolean;
  onVerifyItem: (barcode: string, quantity: number) => void;
  onVerifyAll: () => void;
  scanMultiplier: number;
  setScanMultiplier: (v: number) => void;
  packingPackages: PackingPackage[];
  activePackingPackageId: string;
  setActivePackingPackageId: (id: string) => void;
  onAddPackingPackage: () => void;
  onRemovePackingPackage: (id: string) => void;
  onAutoDistribute: () => void;
}) {
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [qtyValue, setQtyValue] = useState("");

  const totalUnitsRemaining = pickBin.items.reduce(
    (sum, i) => sum + Math.max(0, i.quantity - i.verifiedQty),
    0,
  );
  const remainingLines = pickBin.items.filter(
    (i) => i.verifiedQty < i.quantity,
  ).length;

  return (
    <StepCard
      title={`Verify Items (${binProgress.verified}/${binProgress.total})`}
      description="Scan item UPC or use Verify buttons to confirm quantities."
      icon={<ScanBarcode className="w-5 h-5 text-purple-500" />}
    >
      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              binProgress.allVerified ? "bg-green-500" : "bg-purple-500"
            }`}
            style={{ width: `${binProgress.progress}%` }}
          />
        </div>
      </div>

      {/* Scan prompt + Verify All */}
      {!binProgress.allVerified && (
        <div className="space-y-3 mb-4">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
            <ScanBarcode className="w-8 h-8 text-purple-600 mx-auto mb-2" />
            <p className="text-purple-800 font-medium">
              Scan UPC or verify manually below
            </p>
            <p className="text-purple-600 text-sm mt-1">
              {scanMultiplier === 0
                ? "Scanner auto-fills full quantity per scan"
                : `Each scan verifies ×${scanMultiplier} unit${scanMultiplier > 1 ? "s" : ""}`}
            </p>
          </div>

          {/* Denomination Selector */}
          <ScanDenominationSelector
            value={scanMultiplier}
            onChange={setScanMultiplier}
          />

          {/* Package Selector — scan into active package */}
          <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                Scanning into:
              </span>
              <button
                onClick={onAddPackingPackage}
                className="cursor-pointer text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 font-medium flex items-center gap-1 transition"
              >
                <Plus className="w-3 h-3" /> Add Box
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {packingPackages.map((pkg) => {
                const itemCount = pkg.items.reduce((s, i) => s + i.quantity, 0);
                return (
                  <button
                    key={pkg.id}
                    onClick={() => setActivePackingPackageId(pkg.id)}
                    className={`cursor-pointer relative px-3 py-1.5 rounded-md text-sm font-bold transition-all ${
                      pkg.id === activePackingPackageId
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "bg-white text-emerald-700 border border-emerald-300 hover:border-emerald-400"
                    }`}
                  >
                    {pkg.label}
                    {itemCount > 0 && (
                      <span
                        className={`ml-1 text-xs ${
                          pkg.id === activePackingPackageId
                            ? "text-emerald-100"
                            : "text-emerald-500"
                        }`}
                      >
                        ({itemCount})
                      </span>
                    )}
                    {packingPackages.length > 1 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemovePackingPackage(pkg.id);
                        }}
                        className={`ml-1 cursor-pointer text-xs hover:text-red-400 ${
                          pkg.id === activePackingPackageId
                            ? "text-emerald-200"
                            : "text-emerald-400"
                        }`}
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {packingPackages.length > 1 && (
              <button
                onClick={onAutoDistribute}
                className="cursor-pointer mt-2 w-full text-xs py-1.5 bg-white text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50 font-medium transition"
              >
                Auto-distribute items evenly
              </button>
            )}
          </div>

          <button
            onClick={onVerifyAll}
            disabled={actionLoading}
            className="cursor-pointer w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 transition"
          >
            {actionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Verify All Remaining ({remainingLines} lines · {totalUnitsRemaining}{" "}
            units)
          </button>
        </div>
      )}

      {/* Items list */}
      <div className="space-y-1">
        {pickBin.items.map((item) => {
          const isComplete = item.verifiedQty >= item.quantity;
          const remaining = item.quantity - item.verifiedQty;
          const isEditing = editingItem === item.id;

          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                isComplete ? "bg-green-50" : "bg-gray-50"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isComplete
                    ? "bg-green-500 text-white"
                    : "border-2 border-gray-300"
                }`}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <span className="text-xs font-bold text-gray-400">
                    {item.verifiedQty}
                  </span>
                )}
              </div>
              {item.productVariant.imageUrl ? (
                <img
                  src={item.productVariant.imageUrl}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-gray-300" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {item.productVariant.name}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  {item.sku}
                </div>
              </div>

              {isComplete ? (
                <div className="text-lg font-bold text-green-600">
                  {item.verifiedQty}/{item.quantity}
                </div>
              ) : isEditing ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={qtyValue}
                    onChange={(e) => setQtyValue(e.target.value)}
                    className="w-16 px-2 py-1 border border-purple-300 rounded text-sm text-center"
                    min={1}
                    max={remaining}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const qty = parseInt(qtyValue) || remaining;
                        onVerifyItem(item.sku, Math.min(qty, remaining));
                        setEditingItem(null);
                      }
                      if (e.key === "Escape") setEditingItem(null);
                    }}
                  />
                  <button
                    onClick={() => {
                      const qty = parseInt(qtyValue) || remaining;
                      onVerifyItem(item.sku, Math.min(qty, remaining));
                      setEditingItem(null);
                    }}
                    disabled={actionLoading}
                    className="cursor-pointer p-1 bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-gray-700">
                    {item.verifiedQty}/{item.quantity}
                  </span>
                  {/* Denomination quick-taps */}
                  {remaining > 1 && (
                    <div className="flex gap-0.5">
                      {DENOMINATIONS.filter((d) => d < remaining && d > 1)
                        .slice(0, 2)
                        .map((d) => (
                          <button
                            key={d}
                            onClick={() =>
                              onVerifyItem(item.sku, Math.min(d, remaining))
                            }
                            disabled={actionLoading}
                            className="cursor-pointer px-1.5 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold hover:bg-amber-200 disabled:opacity-50"
                          >
                            +{d}
                          </button>
                        ))}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (remaining <= 1) {
                        onVerifyItem(item.sku, remaining);
                      } else {
                        setEditingItem(item.id);
                        setQtyValue(String(remaining));
                      }
                    }}
                    disabled={actionLoading}
                    className="cursor-pointer px-2 py-1 bg-purple-500 text-white rounded text-xs font-medium hover:bg-purple-600 disabled:opacity-50"
                  >
                    {remaining <= 1 ? "Verify" : `All ${remaining}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-Package Summary */}
      {packingPackages.some((p) => p.items.length > 0) && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Package Contents
          </div>
          <div className="space-y-2">
            {packingPackages.map((pkg) => (
              <div
                key={pkg.id}
                className={`p-2 rounded-lg border text-sm ${
                  pkg.id === activePackingPackageId
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="font-medium text-emerald-700 text-xs mb-1">
                  {pkg.label}{" "}
                  <span className="text-gray-400 font-normal">
                    ({pkg.items.reduce((s, i) => s + i.quantity, 0)} units)
                  </span>
                </div>
                {pkg.items.length === 0 ? (
                  <span className="text-xs text-gray-400 italic">Empty</span>
                ) : (
                  <div className="space-y-0.5">
                    {pkg.items.map((item) => (
                      <div
                        key={item.sku}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="font-mono text-gray-600">
                          {item.sku}
                        </span>
                        <span className="font-bold text-gray-700">
                          ×{item.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </StepCard>
  );
}

// ── Packing Complete Form ─────────────────────────────────────────────────

function PackingCompleteForm({
  orderId,
  taskId,
  orderNumber,
  packingImages,
  packWeight,
  setPackWeight,
  packWeightUnit,
  setPackWeightUnit,
  packLength,
  setPackLength,
  packWidth,
  setPackWidth,
  packHeight,
  setPackHeight,
  onComplete,
  actionLoading,
  fetchStatus,
}: {
  orderId: string;
  taskId?: string;
  orderNumber: string;
  packingImages: PackingImage[];
  packWeight: string;
  setPackWeight: (v: string) => void;
  packWeightUnit: string;
  setPackWeightUnit: (v: string) => void;
  packLength: string;
  setPackLength: (v: string) => void;
  packWidth: string;
  setPackWidth: (v: string) => void;
  packHeight: string;
  setPackHeight: (v: string) => void;
  onComplete: () => void;
  actionLoading: boolean;
  fetchStatus: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Packing Images */}
      <PackingImageUpload
        orderId={orderId}
        taskId={taskId}
        orderNumber={orderNumber}
        images={packingImages}
        onUploadSuccess={fetchStatus}
        onDeleteSuccess={fetchStatus}
        required
        maxImages={5}
      />

      {/* Package Details */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Scale className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">
            Package Details
          </span>
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
                value={packWeight}
                onChange={(e) => setPackWeight(e.target.value)}
                placeholder="0.0"
                className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
              <select
                value={packWeightUnit}
                onChange={(e) => setPackWeightUnit(e.target.value)}
                className="px-2 py-2 border border-border rounded-lg text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
              >
                <option value="ounce">oz</option>
                <option value="pound">lb</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "Length", val: packLength, set: setPackLength },
            { label: "Width", val: packWidth, set: setPackWidth },
            { label: "Height", val: packHeight, set: setPackHeight },
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
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        <button
          onClick={onComplete}
          disabled={actionLoading || packingImages.length === 0 || !packWeight}
          className="cursor-pointer w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2 transition"
        >
          {actionLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          Complete Packing
        </button>

        {packingImages.length === 0 && (
          <p className="text-xs text-amber-600 text-center mt-2">
            Add at least one packing photo to continue
          </p>
        )}
      </div>
    </div>
  );
}

// ── Picking Step (extracted for clarity) ──────────────────────────────────

function PickingStep({
  picking,
  scanLookup,
  scanPhase,
  setScanPhase,
  getCurrentPickItem,
  confirmPick,
  confirmAllPick,
  actionLoading,
  orderId,
  scanMultiplier,
  setScanMultiplier,
  pickAccumulator,
  setPickAccumulator,
}: {
  picking: WorkTask;
  scanLookup: ScanLookup;
  scanPhase: ScanPhase;
  setScanPhase: (p: ScanPhase) => void;
  getCurrentPickItem: () => PickScanDetail | null;
  confirmPick: (taskItemId: string, quantity: number) => void;
  confirmAllPick: () => void;
  actionLoading: boolean;
  orderId: string;
  scanMultiplier: number;
  setScanMultiplier: (v: number) => void;
  pickAccumulator: Record<string, number>;
  setPickAccumulator: React.Dispatch<
    React.SetStateAction<Record<string, number>>
  >;
}) {
  const current = getCurrentPickItem();
  const [batchMode, setBatchMode] = useState(false);
  const [editingQty, setEditingQty] = useState<string | null>(null);
  const [qtyValue, setQtyValue] = useState("");

  const remainingItems = Object.values(scanLookup.pick)
    .filter(
      (i) =>
        i.status !== "COMPLETED" &&
        i.status !== "SHORT" &&
        i.status !== "SKIPPED",
    )
    .sort((a, b) => a.sequence - b.sequence);

  const totalUnitsRemaining = remainingItems.reduce(
    (sum, i) => sum + i.quantityRequired,
    0,
  );

  return (
    <StepCard
      title={`Picking (${picking.completedItems}/${picking.totalItems})`}
      description={
        batchMode
          ? "Confirm items individually or all at once."
          : "Scan location barcode, then item barcode to confirm each pick."
      }
      icon={<ScanBarcode className="w-5 h-5 text-blue-500" />}
    >
      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{
              width: `${picking.totalItems > 0 ? (picking.completedItems / picking.totalItems) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center justify-between mb-4 p-2 bg-gray-50 rounded-lg">
        <span className="text-sm text-gray-600 font-medium">
          {batchMode ? "Batch Mode" : "Scan Mode"}
        </span>
        <button
          onClick={() => setBatchMode(!batchMode)}
          className={`cursor-pointer relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            batchMode ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              batchMode ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* ── BATCH MODE ──────────────────────────────────────────────── */}
      {batchMode ? (
        <>
          {/* Denomination selector for large orders */}
          {totalUnitsRemaining > 5 && (
            <div className="mb-4">
              <ScanDenominationSelector
                value={scanMultiplier}
                onChange={setScanMultiplier}
              />
            </div>
          )}

          {/* Confirm All button */}
          {remainingItems.length > 0 && (
            <button
              onClick={confirmAllPick}
              disabled={actionLoading}
              className="cursor-pointer w-full mb-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 transition"
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Confirm All Remaining ({remainingItems.length} lines ·{" "}
              {totalUnitsRemaining} units)
            </button>
          )}

          {/* Item list with individual confirm */}
          <div className="space-y-1">
            {Object.values(scanLookup.pick)
              .sort((a, b) => a.sequence - b.sequence)
              .map((item) => {
                const isDone =
                  item.status === "COMPLETED" ||
                  item.status === "SHORT" ||
                  item.status === "SKIPPED";
                const isEditing = editingQty === item.taskItemId;

                return (
                  <div
                    key={item.taskItemId}
                    className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                      isDone ? "bg-green-50 opacity-70" : "bg-gray-50"
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                        isDone
                          ? "bg-green-500 text-white"
                          : "border-2 border-gray-300"
                      }`}
                    >
                      {isDone && <CheckCircle2 className="w-4 h-4" />}
                    </div>
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="w-8 h-8 rounded object-cover bg-gray-100 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <Package className="w-4 h-4 text-gray-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-xs">
                        {item.variantName || "—"}
                      </div>
                      <div className="text-xs text-gray-500">
                        <span className="font-mono text-blue-600">
                          {item.sku}
                        </span>
                        {item.locationName && (
                          <span className="ml-2 text-gray-400">
                            · {item.locationName}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-bold w-8 text-center">
                      ×{item.quantityRequired}
                    </div>
                    {!isDone && (
                      <>
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={qtyValue}
                              onChange={(e) => setQtyValue(e.target.value)}
                              className="w-14 px-2 py-1 border border-blue-300 rounded text-sm text-center"
                              min={1}
                              max={item.quantityRequired}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const qty =
                                    parseInt(qtyValue) || item.quantityRequired;
                                  confirmPick(item.taskItemId, qty);
                                  setEditingQty(null);
                                }
                                if (e.key === "Escape") setEditingQty(null);
                              }}
                            />
                            <button
                              onClick={() => {
                                const qty =
                                  parseInt(qtyValue) || item.quantityRequired;
                                confirmPick(item.taskItemId, qty);
                                setEditingQty(null);
                              }}
                              disabled={actionLoading}
                              className="cursor-pointer p-1 bg-green-500 text-white rounded hover:bg-green-600"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {/* Denomination quick-taps for large qty items */}
                            {item.quantityRequired > 1 && (
                              <div className="flex gap-0.5">
                                {DENOMINATIONS.filter(
                                  (d) => d < item.quantityRequired && d > 1,
                                )
                                  .slice(0, 2)
                                  .map((d) => (
                                    <button
                                      key={d}
                                      onClick={() =>
                                        confirmPick(
                                          item.taskItemId,
                                          Math.min(d, item.quantityRequired),
                                        )
                                      }
                                      disabled={actionLoading}
                                      className="cursor-pointer px-1.5 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold hover:bg-amber-200 disabled:opacity-50"
                                    >
                                      ×{d}
                                    </button>
                                  ))}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                if (item.quantityRequired <= 1) {
                                  confirmPick(
                                    item.taskItemId,
                                    item.quantityRequired,
                                  );
                                } else {
                                  setEditingQty(item.taskItemId);
                                  setQtyValue(String(item.quantityRequired));
                                }
                              }}
                              disabled={actionLoading}
                              className="cursor-pointer px-3 py-1 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 disabled:opacity-50"
                            >
                              {item.quantityRequired <= 1
                                ? "Confirm"
                                : `All ${item.quantityRequired}`}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      ) : (
        /* ── SCAN MODE (original) ──────────────────────────────────── */
        <>
          {/* Denomination selector for scan mode */}
          {current && current.quantityRequired > 1 && (
            <div className="mb-4">
              <ScanDenominationSelector
                value={scanMultiplier}
                onChange={setScanMultiplier}
              />
            </div>
          )}

          {/* Current pick item */}
          {!current ? (
            <div className="text-center py-6 text-green-600 font-medium">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
              All items picked!
            </div>
          ) : (
            <div className="mb-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Current Item
              </div>
              <div className="bg-white border-2 border-blue-200 rounded-xl p-4">
                {/* Location */}
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold text-blue-700">
                    {current.locationName || "No location"}
                  </span>
                </div>

                {/* Scan phase indicator */}
                <div className="flex gap-2 mb-3">
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded ${
                      scanPhase === "scan_location"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {scanPhase === "scan_location"
                      ? "① Scan Location"
                      : "✓ Location OK"}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded ${
                      scanPhase === "scan_item"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    ② Scan Item
                  </span>
                </div>

                {/* Product info */}
                <div className="flex items-center gap-3">
                  {current.imageUrl ? (
                    <img
                      src={current.imageUrl}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-gray-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Package className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="font-medium">
                      {current.variantName || "Unknown"}
                    </div>
                    <div className="text-sm text-gray-500 font-mono">
                      {current.sku}
                    </div>
                  </div>
                  <div className="text-2xl font-bold">
                    ×{current.quantityRequired}
                  </div>
                </div>

                {/* Accumulator progress bar (denomination mode only) */}
                {scanMultiplier > 0 &&
                  (pickAccumulator[current.taskItemId] || 0) > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-amber-700 font-medium">
                          Scanned: {pickAccumulator[current.taskItemId]}/
                          {current.quantityRequired}
                        </span>
                        <span className="text-amber-600">
                          {Math.ceil(
                            (current.quantityRequired -
                              (pickAccumulator[current.taskItemId] || 0)) /
                              scanMultiplier,
                          )}{" "}
                          scans left
                        </span>
                      </div>
                      <div className="h-3 bg-amber-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-200"
                          style={{
                            width: `${((pickAccumulator[current.taskItemId] || 0) / current.quantityRequired) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                {/* Manual confirm */}
                <div className="mt-4 flex gap-2">
                  {/* If denomination mode with accumulated progress, show confirm partial */}
                  {scanMultiplier > 0 &&
                  (pickAccumulator[current.taskItemId] || 0) > 0 ? (
                    <>
                      <button
                        onClick={() => {
                          const accum =
                            pickAccumulator[current.taskItemId] || 0;
                          confirmPick(current.taskItemId, accum);
                          setPickAccumulator((a) => {
                            const copy = { ...a };
                            delete copy[current.taskItemId];
                            return copy;
                          });
                        }}
                        disabled={actionLoading}
                        className="cursor-pointer flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-1 transition"
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        Confirm {pickAccumulator[current.taskItemId]} (Short)
                      </button>
                      <button
                        onClick={() =>
                          confirmPick(
                            current.taskItemId,
                            current.quantityRequired,
                          )
                        }
                        disabled={actionLoading}
                        className="cursor-pointer px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition"
                      >
                        All {current.quantityRequired}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() =>
                        confirmPick(
                          current.taskItemId,
                          current.quantityRequired,
                        )
                      }
                      disabled={actionLoading}
                      className="cursor-pointer flex-1 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-1 transition"
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Manual Confirm
                    </button>
                  )}
                  {current.expectedLocationBarcode &&
                    scanPhase === "scan_location" && (
                      <button
                        onClick={() => setScanPhase("scan_item")}
                        className="cursor-pointer px-3 py-2 border border-border rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition"
                      >
                        Skip Location
                      </button>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* All items list */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              All Items
            </div>
            <div className="space-y-1">
              {Object.values(scanLookup.pick)
                .sort((a, b) => a.sequence - b.sequence)
                .map((item) => {
                  const isDone =
                    item.status === "COMPLETED" ||
                    item.status === "SHORT" ||
                    item.status === "SKIPPED";
                  const isCurrent = current?.taskItemId === item.taskItemId;

                  return (
                    <div
                      key={item.taskItemId}
                      className={`flex items-center gap-3 p-2 rounded-lg text-sm ${
                        isCurrent
                          ? "bg-blue-50 border border-blue-200"
                          : isDone
                            ? "bg-gray-50 opacity-60"
                            : "bg-gray-50"
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                          isDone
                            ? "bg-green-500 text-white"
                            : isCurrent
                              ? "border-2 border-blue-400"
                              : "border border-gray-300"
                        }`}
                      >
                        {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                      <span className="font-mono text-xs text-blue-600 w-20 truncate">
                        {item.sku}
                      </span>
                      <span className="text-gray-600 flex-1 truncate">
                        {item.variantName}
                      </span>
                      <span className="text-gray-500 w-8 text-center">
                        ×{item.quantityRequired}
                      </span>
                      <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        {item.locationName || "—"}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </StepCard>
  );
}

// ── Bin Label Step ────────────────────────────────────────────────────────

function BinLabelStep({
  pickBin,
  orderNumber,
  onStartPacking,
  actionLoading,
}: {
  pickBin: PickBin;
  orderNumber: string;
  onStartPacking: () => void;
  actionLoading: boolean;
}) {
  const [printed, setPrinted] = useState(false);
  const barcodeRef = useRef<SVGSVGElement>(null);

  // Generate barcode on mount
  useEffect(() => {
    if (barcodeRef.current) {
      JsBarcode(barcodeRef.current, pickBin.barcode, {
        format: "CODE128",
        width: 2,
        height: 80,
        displayValue: true,
        fontSize: 14,
        margin: 10,
      });
    }
  }, [pickBin.barcode]);

  const handlePrint = () => {
    // Generate barcode as SVG string for print window
    const svgElement = barcodeRef.current;
    const svgString = svgElement
      ? new XMLSerializer().serializeToString(svgElement)
      : "";

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Bin Label - ${pickBin.binNumber}</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                padding: 20px;
                display: flex;
                justify-content: center;
              }
              .label { 
                border: 2px solid #000; 
                padding: 20px; 
                width: 4in;
              }
              .bin-number { 
                font-size: 28px; 
                font-weight: bold; 
                margin-bottom: 5px; 
              }
              .order { 
                font-size: 16px; 
                margin-bottom: 15px;
                color: #555;
              }
              .barcode-container {
                text-align: center;
                margin: 15px 0;
              }
              .barcode-container svg {
                max-width: 100%;
              }
              .items { 
                margin-top: 15px; 
                border-top: 1px solid #ccc; 
                padding-top: 10px; 
              }
              .items-header {
                font-weight: bold;
                margin-bottom: 8px;
              }
              .item { 
                font-size: 12px; 
                margin: 3px 0;
                font-family: monospace;
              }
              @media print {
                body { padding: 0; }
                .label { border: 1px solid #000; }
              }
            </style>
          </head>
          <body>
            <div class="label">
              <div class="bin-number">${pickBin.binNumber}</div>
              <div class="order">Order: ${orderNumber}</div>
              <div class="barcode-container">
                ${svgString}
              </div>
              <div class="items">
                <div class="items-header">${pickBin.items.length} SKUs · ${pickBin.items.reduce((sum, i) => sum + i.quantity, 0)} units</div>
                ${pickBin.items
                  .map(
                    (item) => `
                  <div class="item">• ${item.sku} × ${item.quantity}</div>
                `,
                  )
                  .join("")}
              </div>
            </div>
            <script>
              window.onload = function() {
                window.print();
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
    setPrinted(true);
  };

  return (
    <StepCard
      title="Print Bin Label"
      description="Print and attach label to bin, then scan to start packing."
      icon={<FileText className="w-5 h-5 text-blue-500" />}
    >
      {/* Bin Label Preview */}
      <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-6 mb-4">
        <div className="text-center">
          <div className="text-3xl font-bold mb-1">{pickBin.binNumber}</div>
          <div className="text-gray-500 mb-4">Order: {orderNumber}</div>

          {/* Scannable Barcode */}
          <div className="flex justify-center mb-4">
            <svg ref={barcodeRef}></svg>
          </div>

          {/* Items summary */}
          <div className="text-sm text-gray-600 border-t pt-3">
            <span className="font-semibold">{pickBin.items.length} SKUs</span>
            {" · "}
            <span className="font-semibold">
              {pickBin.items.reduce((sum, i) => sum + i.quantity, 0)} units
            </span>
          </div>
        </div>
      </div>

      {/* Items list */}
      <div className="space-y-1 mb-4">
        {pickBin.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 text-sm"
          >
            {item.productVariant.imageUrl ? (
              <img
                src={item.productVariant.imageUrl}
                alt=""
                className="w-8 h-8 rounded object-cover bg-gray-100"
              />
            ) : (
              <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                <Package className="w-4 h-4 text-gray-300" />
              </div>
            )}
            <span className="font-mono text-xs text-blue-600">{item.sku}</span>
            <span className="text-gray-600 flex-1 truncate">
              {item.productVariant.name}
            </span>
            <span className="font-semibold">×{item.quantity}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={handlePrint}
          className="cursor-pointer w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center justify-center gap-2 transition"
        >
          <FileText className="w-4 h-4" />
          {printed ? "Reprint Label" : "Print Bin Label"}
        </button>

        {printed && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <ScanBarcode className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-green-800 font-medium">
              Scan bin barcode to start packing
            </p>
            <p className="text-green-600 text-sm mt-1">
              Or click below to continue
            </p>
          </div>
        )}

        <button
          onClick={onStartPacking}
          disabled={actionLoading}
          className={`cursor-pointer w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition ${
            printed
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "border-2 border-gray-200 text-gray-500 hover:bg-gray-50"
          }`}
        >
          {actionLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ScanBarcode className="w-4 h-4" />
          )}
          {printed ? "Start Packing" : "Skip Print & Start Packing"}
        </button>
      </div>
    </StepCard>
  );
}
// ── Direct Packing Step ───────────────────────────────────────────────────

function DirectPackingStep({
  packing,
  scanLookup,
  getCurrentPackItem,
  verifyPackItem,
  actionLoading,
  packingImages,
  orderId,
  orderNumber,
  packWeight,
  setPackWeight,
  packWeightUnit,
  setPackWeightUnit,
  packLength,
  setPackLength,
  packWidth,
  setPackWidth,
  packHeight,
  setPackHeight,
  onComplete,
  fetchStatus,
}: {
  packing: WorkTask;
  scanLookup: ScanLookup;
  getCurrentPackItem: () => PackScanDetail | null;
  verifyPackItem: (taskItemId: string) => void;
  actionLoading: boolean;
  packingImages: PackingImage[];
  orderId: string;
  orderNumber: string;
  packWeight: string;
  setPackWeight: (v: string) => void;
  packWeightUnit: string;
  setPackWeightUnit: (v: string) => void;
  packLength: string;
  setPackLength: (v: string) => void;
  packWidth: string;
  setPackWidth: (v: string) => void;
  packHeight: string;
  setPackHeight: (v: string) => void;
  onComplete: () => void;
  fetchStatus: () => void;
}) {
  const allVerified =
    packing.completedItems === packing.totalItems && packing.totalItems > 0;

  return (
    <StepCard
      title={`Packing (${packing.completedItems}/${packing.totalItems})`}
      description="Scan each item to verify, then add photos and enter weight."
      icon={<BoxIcon className="w-5 h-5 text-purple-500" />}
    >
      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 rounded-full transition-all duration-300"
            style={{
              width: `${packing.totalItems > 0 ? (packing.completedItems / packing.totalItems) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      {/* Pack items */}
      <div className="space-y-1 mb-4">
        {Object.values(scanLookup.pack)
          .sort((a, b) => a.sequence - b.sequence)
          .map((item) => {
            const isDone = item.status === "COMPLETED";
            const isCurrent =
              getCurrentPackItem()?.taskItemId === item.taskItemId;

            return (
              <div
                key={item.taskItemId}
                className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                  isCurrent
                    ? "bg-purple-50 border border-purple-200"
                    : isDone
                      ? "bg-gray-50 opacity-60"
                      : "bg-gray-50"
                }`}
              >
                <button
                  onClick={() => !isDone && verifyPackItem(item.taskItemId)}
                  disabled={isDone || actionLoading}
                  className={`cursor-pointer w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition ${
                    isDone
                      ? "bg-purple-500 text-white"
                      : "border-2 border-gray-300 hover:border-purple-400"
                  }`}
                >
                  {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                </button>
                <span className="font-mono text-xs text-blue-600 w-20 truncate">
                  {item.sku}
                </span>
                <span className="text-gray-600 flex-1 truncate">
                  {item.variantName}
                </span>
                <span className="text-gray-500 w-8 text-center">
                  ×{item.quantityRequired}
                </span>
              </div>
            );
          })}
      </div>

      {/* Photos & Weight form — show when all verified */}
      {allVerified && (
        <div className="border-t pt-4 mt-4">
          <PackingCompleteForm
            orderId={orderId}
            taskId={packing.id}
            orderNumber={orderNumber}
            packingImages={packingImages}
            packWeight={packWeight}
            setPackWeight={setPackWeight}
            packWeightUnit={packWeightUnit}
            setPackWeightUnit={setPackWeightUnit}
            packLength={packLength}
            setPackLength={setPackLength}
            packWidth={packWidth}
            setPackWidth={setPackWidth}
            packHeight={packHeight}
            setPackHeight={setPackHeight}
            onComplete={onComplete}
            actionLoading={actionLoading}
            fetchStatus={fetchStatus}
          />
        </div>
      )}
    </StepCard>
  );
}

// ── Shipped Step ──────────────────────────────────────────────────────────

function ShippedStep({
  shipping,
  packingImages,
  orderId,
  orderNumber,
  packingTaskId,
}: {
  shipping: FulfillmentStatus["shipping"];
  packingImages: PackingImage[];
  orderId: string;
  orderNumber: string;
  packingTaskId?: string;
}) {
  if (!shipping || shipping.length === 0) return null;

  const totalCost = shipping.reduce((sum, label) => {
    const cost =
      typeof label.rate === "number"
        ? label.rate
        : parseFloat(String(label.rate)) || 0;
    return sum + cost;
  }, 0);

  return (
    <StepCard
      title={
        shipping.length === 1
          ? "Label Created"
          : `${shipping.length} Labels Created`
      }
      description={`Created on ${new Date(shipping[0].createdAt).toLocaleDateString()}${
        shipping.length > 1 ? ` · Total: $${totalCost.toFixed(2)}` : ""
      }`}
      icon={<FileText className="w-5 h-5" />}
    >
      {packingImages.length > 0 && (
        <div className="mb-4">
          <PackingImageUpload
            orderId={orderId}
            taskId={packingTaskId}
            orderNumber={orderNumber}
            images={packingImages}
            readOnly
            onUploadSuccess={() => {}}
            onDeleteSuccess={() => {}}
          />
        </div>
      )}

      <div className="space-y-3">
        {shipping.map((label, idx) => (
          <div
            key={label.id}
            className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-5"
          >
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold uppercase">
                  {label.carrier}
                </span>
                {shipping.length > 1 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                    Pkg {idx + 1}
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-100 text-amber-700">
                {label.service}
              </span>
            </div>
            <div className="text-lg font-mono font-semibold mb-3">
              {label.trackingNumber}
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>
                Rate:{" "}
                <span className="font-semibold">
                  $
                  {typeof label.rate === "number"
                    ? label.rate.toFixed(2)
                    : label.rate}
                </span>
              </span>
              {label.labelUrl && (
                <a
                  href={label.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  View Label →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </StepCard>
  );
}

// ── Event Timeline ────────────────────────────────────────────────────────

function EventTimeline({
  events,
  showTimeline,
  setShowTimeline,
}: {
  events: FulfillmentStatus["events"];
  showTimeline: boolean;
  setShowTimeline: (v: boolean) => void;
}) {
  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setShowTimeline(!showTimeline)}
        className="cursor-pointer w-full flex items-center justify-between px-4 py-3 border-b border-border text-sm font-medium text-gray-700 hover:bg-gray-50 transition lg:cursor-default"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          Events
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
            {events.length}
          </span>
        </span>
        <span className="lg:hidden">
          {showTimeline ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </span>
      </button>

      <div
        className={`${showTimeline ? "block" : "hidden"} lg:block max-h-[600px] overflow-y-auto`}
      >
        {events.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">
            No events yet
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {[...events].reverse().map((event) => (
              <div key={event.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <EventBadge type={event.type} />
                  <span className="text-[10px] text-gray-400 font-mono">
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {eventDescription(event)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; color: string }> = {
    "order:processing": { label: "PROC", color: "bg-green-100 text-green-700" },
    "order:picked": { label: "PICKD", color: "bg-amber-100 text-amber-700" },
    "order:packed": { label: "PACKD", color: "bg-purple-100 text-purple-700" },
    "order:shipped": { label: "SHIP", color: "bg-cyan-100 text-cyan-700" },
    "picklist:generated": {
      label: "PLIST",
      color: "bg-amber-100 text-amber-700",
    },
    "picklist:item_picked": {
      label: "SCAN",
      color: "bg-yellow-100 text-yellow-700",
    },
    "picklist:completed": {
      label: "PICK✓",
      color: "bg-green-100 text-green-700",
    },
    "pickbin:created": { label: "BIN", color: "bg-blue-100 text-blue-700" },
    "pickbin:item_verified": {
      label: "VRFY",
      color: "bg-purple-100 text-purple-700",
    },
    "packing:started": {
      label: "PACK",
      color: "bg-purple-100 text-purple-700",
    },
    "packing:item_verified": {
      label: "VRFY",
      color: "bg-purple-100 text-purple-700",
    },
    "packing:completed": {
      label: "PACK✓",
      color: "bg-green-100 text-green-700",
    },
    "shipping:label_created": {
      label: "LABEL",
      color: "bg-cyan-100 text-cyan-700",
    },
    "inventory:updated": {
      label: "INV",
      color: "bg-orange-100 text-orange-700",
    },
  };

  const c = config[type] || {
    label: "EVT",
    color: "bg-gray-100 text-gray-600",
  };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${c.color}`}
    >
      {c.label}
    </span>
  );
}

function eventDescription(event: { type: string; payload: any }): string {
  const p = event.payload;
  if (!p) return event.type;

  switch (event.type) {
    case "picklist:generated":
      return `Pick list generated — ${p.totalItems ?? p.itemCount ?? "?"} items`;
    case "picklist:item_picked":
      return `${p.sku}: ${p.quantity}x from ${p.location || "—"}`;
    case "picklist:completed":
      return p.bin ? `Completed → Bin ${p.bin.binNumber}` : "All items picked";
    case "pickbin:created":
      return `Bin ${p.binNumber} created (${p.itemCount} SKUs)`;
    case "pickbin:item_verified":
      return `${p.sku}: verified (${p.progress})`;
    case "packing:started":
      return `Packing started — ${p.totalItems ?? p.itemCount ?? "?"} items`;
    case "packing:item_verified":
      return `${p.sku}: verified`;
    case "packing:completed":
      return `${p.weight || "?"}${p.weightUnit || "oz"}`;
    case "shipping:label_created":
      return `${(p.carrier || "").toUpperCase()} ${p.service || ""} — ${p.trackingNumber || ""}`;
    case "order:picked":
      return `Order picked`;
    case "order:packed":
      return `Order packed`;
    case "order:shipped":
      return p.message || "Order shipped";
    default:
      return p.message || event.type;
  }
}

export { FulfillmentDetailPage };
