/**
 * Receiving Session Page - TC22 Optimized
 * Compact UI for Zebra TC22 (5.5" 720x1280)
 *
 * Save to: apps/web/src/pages/receiving/session.tsx
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Send,
  Scan,
  Minus,
  X,
  Keyboard,
  WifiOff,
  Lock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ScanBarcode,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LineItem {
  id: string;
  sku: string;
  productName: string;
  productVariantId: string | null;
  quantityExpected: number;
  quantityCounted: number;
  quantityDamaged: number;
  remaining: number;
  variance: number | null;
  isComplete: boolean;
  isOverage: boolean;
  lotNumber: string | null;
  generatedBarcode: string | null;
  imageUrl: string | null;
  barcodes: string[];
}

interface Session {
  id: string;
  poId: string;
  poReference: string;
  vendor: string | null;
  status: string;
  version: number;
  lockedBy: { id: string; name: string | null } | null;
  lockedAt: string | null;
  countedBy: { id: string; name: string | null } | null;
  receivingLocation: { id: string; name: string } | null;
  putawayTask: { id: string; taskNumber: string } | null;
}

interface Summary {
  totalItems: number;
  totalExpected: number;
  totalCounted: number;
  totalDamaged: number;
  progress: number;
  hasVariances: boolean;
}

interface SessionData {
  session: Session;
  lineItems: LineItem[];
  summary: Summary;
  barcodeLookup: Record<string, { lineId: string; sku: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debounced Queue Hook
// ─────────────────────────────────────────────────────────────────────────────

function useDebouncedUpdates(
  sessionId: string,
  onSuccess: (version: number) => void,
  onError: (error: Error) => void,
) {
  const pendingRef = useRef<Map<string, number>>(new Map());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const versionRef = useRef<number>(1);
  const [isSyncing, setIsSyncing] = useState(false);

  const flush = useCallback(async () => {
    if (pendingRef.current.size === 0) return;

    const updates = Array.from(pendingRef.current.entries()).map(
      ([lineId, delta]) => ({ lineId, quantity: delta }),
    );

    pendingRef.current.clear();
    setIsSyncing(true);

    try {
      const result = await apiClient.post<{ version: number }>(
        `/receiving/${sessionId}/batch`,
        { updates, expectedVersion: versionRef.current },
      );
      versionRef.current = result.version;
      onSuccess(result.version);
    } catch (err) {
      if ((err as Error).message?.includes("Version conflict")) {
        onError(new Error("Session modified elsewhere. Refreshing..."));
      } else {
        for (const update of updates) {
          const existing = pendingRef.current.get(update.lineId) || 0;
          pendingRef.current.set(update.lineId, existing + update.quantity);
        }
        onError(err as Error);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [sessionId, onSuccess, onError]);

  const queueUpdate = useCallback(
    (lineId: string, delta: number) => {
      const existing = pendingRef.current.get(lineId) || 0;
      pendingRef.current.set(lineId, existing + delta);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(flush, 300);
    },
    [flush],
  );

  const setVersion = useCallback((v: number) => {
    versionRef.current = v;
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      flush();
    };
  }, [flush]);

  return { queueUpdate, flush, isSyncing, setVersion };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ReceivingSessionPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();

  const [data, setData] = useState<SessionData | null>(null);
  const [localCounts, setLocalCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showManualInput, setShowManualInput] = useState(false);
  const [showItemList, setShowItemList] = useState(true);

  const scanBufferRef = useRef("");
  const [scanBufferDisplay, setScanBufferDisplay] = useState("");
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [verifiedLineIds, setVerifiedLineIds] = useState<Set<string>>(
    new Set(),
  );

  const userId = localStorage.getItem("wms_user")
    ? JSON.parse(localStorage.getItem("wms_user")!).id
    : null;

  const { queueUpdate, flush, isSyncing, setVersion } = useDebouncedUpdates(
    sessionId!,
    (version) => {
      setData((prev) =>
        prev ? { ...prev, session: { ...prev.session, version } } : prev,
      );
    },
    (err) => {
      setError(err.message);
      if (err.message.includes("Refreshing")) fetchSession();
    },
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await apiClient.get<SessionData>(
        `/receiving/${sessionId}`,
      );
      setData(result);
      setVersion(result.session.version);
      setLocalCounts(new Map());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, setVersion]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!sessionId || !data || data.session.status !== "IN_PROGRESS") return;
    const interval = setInterval(async () => {
      try {
        await apiClient.post(`/receiving/${sessionId}/heartbeat`);
      } catch (err) {
        console.error("Heartbeat failed:", err);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [sessionId, data]);

  useEffect(() => {
    if (scanFeedback) {
      const timeout = setTimeout(() => setScanFeedback(null), 2500);
      return () => clearTimeout(timeout);
    }
  }, [scanFeedback]);

  const isReadOnly = data?.session.status !== "IN_PROGRESS";
  const isLockedByOther =
    data?.session.lockedBy && data.session.lockedBy.id !== userId;

  const lineItems = useMemo(() => {
    if (!data) return [];
    return data.lineItems.map((line) => {
      const localDelta = localCounts.get(line.id) || 0;
      const counted = line.quantityCounted + localDelta;
      return {
        ...line,
        quantityCounted: counted,
        remaining: Math.max(0, line.quantityExpected - counted),
        isComplete: counted >= line.quantityExpected,
        isOverage: counted > line.quantityExpected,
      };
    });
  }, [data, localCounts]);

  const selectedLine = useMemo(() => {
    if (!selectedLineId) return null;
    return lineItems.find((l) => l.id === selectedLineId) || null;
  }, [selectedLineId, lineItems]);

  const summary = useMemo(() => {
    const totalExpected = lineItems.reduce(
      (sum, l) => sum + l.quantityExpected,
      0,
    );
    const totalCounted = lineItems.reduce(
      (sum, l) => sum + l.quantityCounted,
      0,
    );
    const totalDamaged = lineItems.reduce(
      (sum, l) => sum + l.quantityDamaged,
      0,
    );
    return {
      totalItems: lineItems.length,
      totalExpected,
      totalCounted,
      totalDamaged,
      progress:
        totalExpected > 0
          ? Math.round((totalCounted / totalExpected) * 100)
          : 0,
      hasVariances: lineItems.some(
        (l) => l.quantityCounted !== l.quantityExpected,
      ),
    };
  }, [lineItems]);

  //   const handleBarcodeScan = useCallback(
  //     async (barcode: string) => {
  //       if (!barcode.trim() || !data) return;

  //       const match = data.barcodeLookup[barcode];
  //       if (match) {
  //         const line = lineItems.find((l) => l.id === match.lineId);
  //         if (line) {
  //           setSelectedLineId(line.id);
  //           setShowItemList(false);
  //           setScanFeedback({ type: "success", message: `✓ ${line.sku}` });
  //           if (navigator.vibrate) navigator.vibrate(100);
  //           return;
  //         }
  //       }

  //       try {
  //         const result = await apiClient.post<any>(
  //           `/receiving/${sessionId}/scan`,
  //           { barcode },
  //         );
  //         if (result.success && result.lineId) {
  //           const line = lineItems.find((l) => l.id === result.lineId);
  //           setSelectedLineId(line?.id || null);
  //           setShowItemList(false);
  //           setScanFeedback({ type: "success", message: `✓ ${result.sku}` });
  //           if (navigator.vibrate) navigator.vibrate(100);
  //         } else {
  //           setScanFeedback({
  //             type: result.error === "NOT_ON_PO" ? "warning" : "error",
  //             message:
  //               result.error === "NOT_ON_PO"
  //                 ? `⚠ ${result.sku} not on PO`
  //                 : result.message || "Unknown barcode",
  //           });
  //           if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  //         }
  //       } catch (err) {
  //         setScanFeedback({ type: "error", message: "Scan failed" });
  //         if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  //       }
  //     },
  //     [data, lineItems, sessionId],
  //   );
  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      if (!barcode.trim() || !data) return;

      const match = data.barcodeLookup[barcode];
      if (match) {
        const line = lineItems.find((l) => l.id === match.lineId);
        if (line) {
          setSelectedLineId(line.id);
          setVerifiedLineIds((prev) => new Set(prev).add(line.id)); // ✅ Mark verified
          setShowItemList(false);
          setScanFeedback({ type: "success", message: `✓ ${line.sku}` });
          if (navigator.vibrate) navigator.vibrate(100);
          return;
        }
      }

      try {
        const result = await apiClient.post<any>(
          `/receiving/${sessionId}/scan`,
          {
            barcode,
          },
        );
        if (result.success && result.lineId) {
          const line = lineItems.find((l) => l.id === result.lineId);
          setSelectedLineId(line?.id || null);
          if (line) {
            setVerifiedLineIds((prev) => new Set(prev).add(line.id)); // ✅ Mark verified
          }
          setShowItemList(false);
          setScanFeedback({ type: "success", message: `✓ ${result.sku}` });
          if (navigator.vibrate) navigator.vibrate(100);
        } else {
          setScanFeedback({
            type: result.error === "NOT_ON_PO" ? "warning" : "error",
            message:
              result.error === "NOT_ON_PO"
                ? `⚠ ${result.sku} not on PO`
                : result.message || "Unknown barcode",
          });
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        }
      } catch (err) {
        setScanFeedback({ type: "error", message: "Scan failed" });
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      }
    },
    [data, lineItems, sessionId],
  );

  useEffect(() => {
    if (isReadOnly || showManualInput) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (e.key === "Enter") {
        const barcode = scanBufferRef.current;
        if (barcode) {
          handleBarcodeScan(barcode);
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
  }, [isReadOnly, showManualInput, handleBarcodeScan]);

  const handleAddQuantity = useCallback(
    (delta: number) => {
      if (!selectedLine || isReadOnly || isLockedByOther) return;

      setLocalCounts((prev) => {
        const next = new Map(prev);
        const existing = next.get(selectedLine.id) || 0;
        const newDelta = existing + delta;
        const currentCount = selectedLine.quantityCounted - existing;
        if (currentCount + newDelta < 0) {
          next.set(selectedLine.id, -currentCount);
        } else {
          next.set(selectedLine.id, newDelta);
        }
        return next;
      });

      queueUpdate(selectedLine.id, delta);
      if (navigator.vibrate) navigator.vibrate(30);
    },
    [selectedLine, isReadOnly, isLockedByOther, queueUpdate],
  );

  const handleSetQuantity = useCallback(
    async (quantity: number) => {
      if (!selectedLine || isReadOnly || isLockedByOther) return;
      await flush();
      try {
        await apiClient.post(`/receiving/${sessionId}/set`, {
          lineId: selectedLine.id,
          quantity,
        });
        await fetchSession();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [selectedLine, isReadOnly, isLockedByOther, sessionId, flush, fetchSession],
  );

  const handleSubmit = useCallback(async () => {
    await flush();
    try {
      await apiClient.post(`/receiving/${sessionId}/submit`);
      navigate("/receiving", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [flush, sessionId, navigate]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-3">
        <div className="bg-white rounded-lg p-4 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-900 mb-2">{error}</p>
          <button
            onClick={() => navigate("/receiving")}
            className="text-blue-600 text-sm"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col text-sm">
      {/* Compact Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-2 py-2 flex items-center gap-2">
          <button
            onClick={() => navigate("/receiving")}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-bold text-gray-900 truncate text-sm">
                {data.session.poReference}
              </span>
              {!isOnline && <WifiOff className="w-3 h-3 text-red-500" />}
              {isSyncing && (
                <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
              )}
            </div>
          </div>
          <div className="text-right">
            <span className="font-bold text-blue-600">{summary.progress}%</span>
          </div>
          {!isReadOnly && (
            <button
              onClick={() => setShowManualInput(true)}
              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Thin Progress Bar */}
        <div className="h-1 bg-gray-200">
          <div
            className={cn(
              "h-full transition-all",
              summary.progress >= 100 ? "bg-green-500" : "bg-blue-500",
            )}
            style={{ width: `${Math.min(100, summary.progress)}%` }}
          />
        </div>

        {/* Lock Warning */}
        {isLockedByOther && (
          <div className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs flex items-center gap-1">
            <Lock className="w-3 h-3" />
            <span>Locked by {data.session.lockedBy?.name || "other"}</span>
          </div>
        )}

        {/* Scan Buffer */}
        {scanBufferDisplay && (
          <div className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-mono">
            {scanBufferDisplay}
          </div>
        )}

        {/* Scan Feedback */}
        {scanFeedback && (
          <div
            className={cn(
              "px-2 py-1.5 text-xs font-medium",
              scanFeedback.type === "success" && "bg-green-100 text-green-800",
              scanFeedback.type === "warning" &&
                "bg-yellow-100 text-yellow-800",
              scanFeedback.type === "error" && "bg-red-100 text-red-800",
            )}
          >
            {scanFeedback.message}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-2 py-1 bg-red-100 text-red-800 text-xs flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            <span className="flex-1 truncate">{error}</span>
            <button onClick={() => setError(null)}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Selected Item - Compact Panel */}
      {selectedLine && !isReadOnly ? (
        <CompactItemPanel
          line={selectedLine}
          isVerified={verifiedLineIds.has(selectedLine.id)} // ✅ Pass verified
          onAdd={handleAddQuantity}
          onSetQuantity={handleSetQuantity}
          onClose={() => {
            setSelectedLineId(null);
            setShowItemList(true);
          }}
          disabled={!!isLockedByOther}
        />
      ) : !isReadOnly ? (
        <div className="bg-blue-50 p-3 text-center border-b border-blue-100">
          <ScanBarcode className="w-8 h-8 text-blue-500 mx-auto mb-1" />
          <p className="text-blue-900 text-sm font-medium">Scan barcode</p>
        </div>
      ) : null}

      {/* Collapsible Item List */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <button
          onClick={() => setShowItemList(!showItemList)}
          className="flex items-center justify-between px-2 py-1.5 bg-gray-200 text-xs font-medium text-gray-700"
        >
          <span>
            Items: {summary.totalCounted}/{summary.totalExpected}
          </span>
          {showItemList ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showItemList && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-1.5 space-y-1">
              {lineItems.map((item) => (
                <CompactItemCard
                  key={item.id}
                  item={item}
                  isSelected={selectedLine?.id === item.id}
                  onClick={() => {
                    if (!isReadOnly) {
                      setSelectedLineId(item.id);
                      setShowItemList(false);
                    }
                  }}
                  disabled={isReadOnly}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Submit Button */}
      {!isReadOnly && !isLockedByOther && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-2">
          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={summary.totalCounted === 0}
            className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Submit
          </button>
        </div>
      )}

      {isReadOnly && (
        <div className="sticky bottom-0 bg-gray-200 p-2 text-center">
          <p className="text-gray-600 text-xs font-medium">
            {data.session.status.replace("_", " ")}
          </p>
        </div>
      )}

      {showManualInput && (
        <ManualBarcodeModal
          onScan={handleBarcodeScan}
          onClose={() => setShowManualInput(false)}
        />
      )}

      {showSubmitModal && (
        <SubmitModal
          summary={summary}
          lineItems={lineItems}
          onConfirm={handleSubmit}
          onCancel={() => setShowSubmitModal(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact Item Panel (TC22 optimized)
// ─────────────────────────────────────────────────────────────────────────────

interface CompactItemPanelProps {
  line: LineItem;
  isVerified: boolean; // ✅ Add this
  onAdd: (delta: number) => void;
  onSetQuantity: (qty: number) => void;
  onClose: () => void;
  disabled: boolean;
}

function CompactItemPanel({
  line,
  isVerified,
  onAdd,
  onSetQuantity,
  onClose,
  disabled,
}: CompactItemPanelProps) {
  const remaining = Math.max(0, line.quantityExpected - line.quantityCounted);
  const isComplete = line.quantityCounted >= line.quantityExpected;
  const isOverage = line.quantityCounted > line.quantityExpected;

  // Disable buttons if not verified
  const isDisabled = disabled || !isVerified;

  return (
    <div className="bg-white border-b border-gray-300 p-2">
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{line.sku}</p>
          <p className="text-xs text-gray-500 truncate">{line.productName}</p>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scan Required Warning */}
      {!isVerified && (
        <div className="mb-2 flex items-center gap-2 text-orange-700 bg-orange-50 rounded p-2 text-xs">
          <Scan className="w-4 h-4" />
          <span className="font-medium">Scan barcode to verify item</span>
        </div>
      )}

      {/* Count Display - Inline */}
      <div className="flex items-center justify-between bg-gray-50 rounded p-2 mb-2">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">
            {line.quantityCounted}
          </p>
          <p className="text-[10px] text-gray-500 uppercase">Counted</p>
        </div>
        <div className="text-gray-300">/</div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-400">
            {line.quantityExpected}
          </p>
          <p className="text-[10px] text-gray-500 uppercase">Expected</p>
        </div>
        <div className="text-center">
          <p
            className={cn(
              "text-2xl font-bold",
              remaining === 0
                ? "text-green-600"
                : isOverage
                  ? "text-yellow-600"
                  : "text-blue-600",
            )}
          >
            {remaining}
          </p>
          <p className="text-[10px] text-gray-500 uppercase">Left</p>
        </div>
      </div>

      {/* Quick Add Buttons - Disabled until verified */}
      <div className="grid grid-cols-4 gap-1.5 mb-1.5">
        {[1, 5, 20, 100].map((qty) => (
          <button
            key={qty}
            onClick={() => onAdd(qty)}
            disabled={isDisabled}
            className={cn(
              "py-3 rounded font-bold text-base transition-colors",
              isVerified
                ? "bg-blue-600 text-white active:bg-blue-700"
                : "bg-gray-300 text-gray-500 cursor-not-allowed",
              isDisabled && "opacity-50",
            )}
          >
            +{qty}
          </button>
        ))}
      </div>

      {/* Adjustment Row */}
      <div className="flex gap-1.5">
        <button
          onClick={() => onAdd(-1)}
          disabled={isDisabled || line.quantityCounted <= 0}
          className="flex-1 py-2 bg-gray-200 text-gray-700 rounded text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"
        >
          <Minus className="w-3 h-3" />
          -1
        </button>
        <button
          onClick={() => {
            const qty = prompt("Exact qty:", String(line.quantityCounted));
            if (qty !== null && !isNaN(Number(qty))) onSetQuantity(Number(qty));
          }}
          disabled={isDisabled}
          className="flex-1 py-2 bg-gray-200 text-gray-700 rounded text-xs font-medium disabled:opacity-50"
        >
          Set Exact
        </button>
      </div>

      {/* Status */}
      {isComplete && !isOverage && (
        <div className="mt-1.5 flex items-center gap-1 text-green-700 bg-green-50 rounded p-1.5 text-xs">
          <CheckCircle className="w-3 h-3" />
          <span className="font-medium">Complete</span>
        </div>
      )}
      {isOverage && (
        <div className="mt-1.5 flex items-center gap-1 text-yellow-700 bg-yellow-50 rounded p-1.5 text-xs">
          <AlertTriangle className="w-3 h-3" />
          <span className="font-medium">
            +{line.quantityCounted - line.quantityExpected} over
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact Item Card
// ─────────────────────────────────────────────────────────────────────────────

interface CompactItemCardProps {
  item: LineItem;
  isSelected: boolean;
  onClick: () => void;
  disabled: boolean;
}

function CompactItemCard({
  item,
  isSelected,
  onClick,
  disabled,
}: CompactItemCardProps) {
  const progress =
    item.quantityExpected > 0
      ? (item.quantityCounted / item.quantityExpected) * 100
      : 0;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full bg-white rounded p-2 text-left",
        isSelected ? "ring-2 ring-blue-500" : "border border-gray-200",
        disabled && "cursor-default",
      )}
    >
      <div className="flex items-center gap-2">
        {/* Small Image or Icon */}
        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="w-full h-full object-cover rounded"
            />
          ) : (
            <Package className="w-4 h-4 text-gray-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-gray-900 text-xs truncate">
              {item.sku}
            </span>
            {item.isComplete && !item.isOverage && (
              <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
            )}
            {item.isOverage && (
              <AlertTriangle className="w-3 h-3 text-yellow-500 flex-shrink-0" />
            )}
          </div>
          {/* Mini progress bar */}
          <div className="mt-0.5 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                progress >= 100
                  ? item.isOverage
                    ? "bg-yellow-400"
                    : "bg-green-500"
                  : "bg-blue-500",
              )}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        </div>

        {/* Count */}
        <div className="text-right flex-shrink-0">
          <p className="font-bold text-xs text-gray-900">
            {item.quantityCounted}
            <span className="text-gray-400 font-normal">
              /{item.quantityExpected}
            </span>
          </p>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual Barcode Modal (Compact)
// ─────────────────────────────────────────────────────────────────────────────

interface ManualBarcodeModalProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

function ManualBarcodeModal({ onScan, onClose }: ManualBarcodeModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onScan(value.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Enter Barcode</h3>
          <button onClick={onClose} className="p-1 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Barcode..."
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full mt-2 py-2 bg-blue-600 text-white rounded font-medium text-sm disabled:opacity-50"
          >
            Look Up
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit Modal (Compact)
// ─────────────────────────────────────────────────────────────────────────────

interface SubmitModalProps {
  summary: Summary;
  lineItems: LineItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

function SubmitModal({
  summary,
  lineItems,
  onConfirm,
  onCancel,
}: SubmitModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const incompleteItems = lineItems.filter((l) => !l.isComplete);
  const overageItems = lineItems.filter((l) => l.isOverage);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3">
      <div className="bg-white w-full max-w-sm rounded-xl p-4">
        <h3 className="font-bold text-gray-900 mb-3">Submit for Approval?</h3>

        <div className="bg-gray-50 rounded p-3 mb-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Counted</span>
            <span className="font-semibold">{summary.totalCounted}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Expected</span>
            <span className="font-semibold">{summary.totalExpected}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-1">
            <span className="text-gray-600">Variance</span>
            <span
              className={cn(
                "font-semibold",
                summary.totalCounted === summary.totalExpected
                  ? "text-green-600"
                  : summary.totalCounted > summary.totalExpected
                    ? "text-yellow-600"
                    : "text-red-600",
              )}
            >
              {summary.totalCounted - summary.totalExpected > 0 ? "+" : ""}
              {summary.totalCounted - summary.totalExpected}
            </span>
          </div>
        </div>

        {incompleteItems.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-2 text-xs flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-yellow-600" />
            <span className="text-yellow-800">
              {incompleteItems.length} incomplete
            </span>
          </div>
        )}

        {overageItems.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2 text-xs flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-blue-600" />
            <span className="text-blue-800">{overageItems.length} overage</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded font-medium text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="flex-1 py-2 bg-green-600 text-white rounded font-medium text-sm flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-3 h-3" />
                Submit
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
