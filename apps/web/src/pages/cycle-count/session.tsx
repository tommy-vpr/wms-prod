/**
 * Cycle Count Session - TC22 Optimized
 *
 * Save to: apps/web/src/pages/cycle-count/session.tsx
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
  Plus,
  Eye,
  EyeOff,
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
  productVariantId: string;
  systemQty: number | null;
  countedQty: number | null;
  variance: number | null;
  lotNumber: string | null;
  status: string;
  isUnexpected: boolean;
  imageUrl: string | null;
  barcodes: string[];
}

interface Session {
  id: string;
  taskId: string | null;
  task: any;
  location: { id: string; name: string; barcode: string | null };
  blindCount: boolean;
  status: string;
  version: number;
  lockedBy: { id: string; name: string | null } | null;
  lockedAt: string | null;
  countedBy: { id: string; name: string | null } | null;
}

interface Summary {
  totalItems: number;
  totalExpected: number;
  totalCounted: number;
  countedItems: number;
  pendingItems: number;
  varianceItems: number;
  progress: number;
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
        `/cycle-count/sessions/${sessionId}/batch`,
        { updates, expectedVersion: versionRef.current },
      );
      versionRef.current = result.version || versionRef.current + 1;
      onSuccess(versionRef.current);
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

export default function CycleCountSessionPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();

  const [data, setData] = useState<SessionData | null>(null);
  const [localCounts, setLocalCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [verifiedLineIds, setVerifiedLineIds] = useState<Set<string>>(
    new Set(),
  );

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

  // Online/offline
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

  // Fetch session
  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await apiClient.get<SessionData>(
        `/cycle-count/sessions/${sessionId}`,
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

  // Heartbeat
  useEffect(() => {
    if (!sessionId || !data || data.session.status !== "IN_PROGRESS") return;
    const interval = setInterval(async () => {
      try {
        await apiClient.post(`/cycle-count/sessions/${sessionId}/heartbeat`);
      } catch (err) {
        console.error("Heartbeat failed:", err);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [sessionId, data]);

  // Clear feedback
  useEffect(() => {
    if (scanFeedback) {
      const timeout = setTimeout(() => setScanFeedback(null), 2500);
      return () => clearTimeout(timeout);
    }
  }, [scanFeedback]);

  const isReadOnly = data?.session.status !== "IN_PROGRESS";
  const isLockedByOther =
    data?.session.lockedBy && data.session.lockedBy.id !== userId;

  // Merge local counts
  const lineItems = useMemo(() => {
    if (!data) return [];
    return data.lineItems.map((line) => {
      const localDelta = localCounts.get(line.id) || 0;
      const counted = (line.countedQty ?? 0) + localDelta;
      const systemQty = line.systemQty ?? 0;
      return {
        ...line,
        countedQty: counted,
        variance: data.session.blindCount ? null : counted - systemQty,
        isComplete: counted > 0,
      };
    });
  }, [data, localCounts]);

  const selectedLine = useMemo(() => {
    if (!selectedLineId) return null;
    return lineItems.find((l) => l.id === selectedLineId) || null;
  }, [selectedLineId, lineItems]);

  const summary = useMemo(() => {
    const totalExpected = lineItems.reduce(
      (sum, l) => sum + (l.systemQty ?? 0),
      0,
    );
    const totalCounted = lineItems.reduce(
      (sum, l) => sum + (l.countedQty ?? 0),
      0,
    );
    const countedItems = lineItems.filter(
      (l) => (l.countedQty ?? 0) > 0,
    ).length;
    const pendingItems = lineItems.filter(
      (l) => (l.countedQty ?? 0) === 0,
    ).length;
    const varianceItems = lineItems.filter(
      (l) => l.variance !== null && l.variance !== 0,
    ).length;

    return {
      totalItems: lineItems.length,
      totalExpected,
      totalCounted,
      countedItems,
      pendingItems,
      varianceItems,
      progress:
        lineItems.length > 0
          ? Math.round((countedItems / lineItems.length) * 100)
          : 0,
    };
  }, [lineItems]);

  // Barcode scan handler
  const handleBarcodeScan = useCallback(
    async (barcode: string) => {
      if (!barcode.trim() || !data) return;

      const match = data.barcodeLookup[barcode];
      if (match) {
        const line = lineItems.find((l) => l.id === match.lineId);
        if (line) {
          setSelectedLineId(line.id);
          setVerifiedLineIds((prev) => new Set(prev).add(line.id));
          setShowItemList(false);
          setScanFeedback({ type: "success", message: `✓ ${line.sku}` });
          if (navigator.vibrate) navigator.vibrate(100);
          return;
        }
      }

      try {
        const result = await apiClient.post<any>(
          `/cycle-count/sessions/${sessionId}/scan`,
          { barcode },
        );
        if (result.success && result.lineId) {
          const line = lineItems.find((l) => l.id === result.lineId);
          setSelectedLineId(line?.id || null);
          if (line) {
            setVerifiedLineIds((prev) => new Set(prev).add(line.id));
          }
          setShowItemList(false);
          setScanFeedback({ type: "success", message: `✓ ${result.sku}` });
          if (navigator.vibrate) navigator.vibrate(100);
        } else {
          setScanFeedback({
            type: result.error === "UNEXPECTED_ITEM" ? "warning" : "error",
            message:
              result.error === "UNEXPECTED_ITEM"
                ? `⚠ ${result.sku} not expected`
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

  // Global keyboard listener
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
      if (!verifiedLineIds.has(selectedLine.id)) return;

      setLocalCounts((prev) => {
        const next = new Map(prev);
        const existing = next.get(selectedLine.id) || 0;
        const newDelta = existing + delta;
        const currentCount = (selectedLine.countedQty ?? 0) - existing;
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
    [selectedLine, isReadOnly, isLockedByOther, verifiedLineIds, queueUpdate],
  );

  const handleSetQuantity = useCallback(
    async (quantity: number) => {
      if (!selectedLine || isReadOnly || isLockedByOther) return;
      await flush();
      try {
        await apiClient.post(`/cycle-count/sessions/${sessionId}/count`, {
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
      await apiClient.post(`/cycle-count/sessions/${sessionId}/submit`);
      navigate("/cycle-count", { replace: true });
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
            onClick={() => navigate("/cycle-count")}
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
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-2 py-2 flex items-center gap-2">
          <button
            onClick={() => navigate("/cycle-count")}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-bold text-gray-900 truncate text-sm">
                {data.session.location.name}
              </span>
              {data.session.blindCount && (
                <EyeOff className="w-3 h-3 text-gray-400" />
              )}
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
              className="cursor-pointer transition p-1.5 text-gray-500 hover:bg-gray-100 rounded"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Progress */}
        <div className="h-1 bg-gray-200">
          <div
            className={cn(
              "h-full transition-all",
              summary.progress >= 100 ? "bg-green-500" : "bg-blue-500",
            )}
            style={{ width: `${Math.min(100, summary.progress)}%` }}
          />
        </div>

        {/* Locked Warning */}
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

      {/* Selected Item Panel */}
      {selectedLine && !isReadOnly ? (
        <CompactItemPanel
          line={selectedLine}
          isVerified={verifiedLineIds.has(selectedLine.id)}
          blindCount={data.session.blindCount}
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
          <Scan className="w-8 h-8 text-blue-500 mx-auto mb-1" />
          <p className="text-blue-900 text-sm font-medium">Scan item barcode</p>
        </div>
      ) : null}

      {/* Collapsible Item List */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <button
          onClick={() => setShowItemList(!showItemList)}
          className="cursor-pointer flex items-center justify-between px-2 py-1.5 bg-gray-200 text-xs font-medium text-gray-700"
        >
          <span>
            Items: {summary.countedItems}/{summary.totalItems} counted
            {summary.varianceItems > 0 && (
              <span className="text-yellow-600 ml-2">
                ({summary.varianceItems} variance)
              </span>
            )}
          </span>
          {showItemList ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showItemList && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-1.5 space-y-1 cursor-pointer">
              {lineItems.map((item) => (
                <CompactItemCard
                  key={item.id}
                  item={item}
                  blindCount={data.session.blindCount}
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

      {/* Submit Button */}
      {!isReadOnly && !isLockedByOther && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-2">
          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={summary.countedItems === 0}
            className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Submit for Review
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
          blindCount={data.session.blindCount}
          onConfirm={handleSubmit}
          onCancel={() => setShowSubmitModal(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact Item Panel
// ─────────────────────────────────────────────────────────────────────────────

interface CompactItemPanelProps {
  line: LineItem & { isComplete?: boolean };
  isVerified: boolean;
  blindCount: boolean;
  onAdd: (delta: number) => void;
  onSetQuantity: (qty: number) => void;
  onClose: () => void;
  disabled: boolean;
}

function CompactItemPanel({
  line,
  isVerified,
  blindCount,
  onAdd,
  onSetQuantity,
  onClose,
  disabled,
}: CompactItemPanelProps) {
  const isDisabled = disabled || !isVerified;
  const systemQty = line.systemQty ?? 0;
  const countedQty = line.countedQty ?? 0;

  return (
    <div className="bg-white border-b border-gray-300 p-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{line.sku}</p>
          <p className="text-xs text-gray-500 truncate">{line.productName}</p>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400">
          <X className="w-4 h-4 cursor-pointer" />
        </button>
      </div>

      {/* Scan to verify warning */}
      {!isVerified && (
        <div className="mb-2 flex items-center gap-2 text-orange-700 bg-orange-50 rounded p-2 text-xs">
          <ScanBarcode className="w-4 h-4" />
          <span className="font-medium">Scan barcode to verify item</span>
        </div>
      )}

      {/* Count Display */}
      <div className="flex items-center justify-between bg-gray-50 rounded p-2 mb-2">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{countedQty}</p>
          <p className="text-[10px] text-gray-500 uppercase">Counted</p>
        </div>
        {!blindCount && (
          <>
            <div className="text-gray-300">/</div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-400">{systemQty}</p>
              <p className="text-[10px] text-gray-500 uppercase">System</p>
            </div>
            <div className="text-center">
              <p
                className={cn(
                  "text-2xl font-bold",
                  line.variance === 0
                    ? "text-green-600"
                    : line.variance && line.variance > 0
                      ? "text-blue-600"
                      : "text-red-600",
                )}
              >
                {line.variance !== null
                  ? line.variance > 0
                    ? `+${line.variance}`
                    : line.variance
                  : "-"}
              </p>
              <p className="text-[10px] text-gray-500 uppercase">Variance</p>
            </div>
          </>
        )}
      </div>

      {/* Quick Add Buttons */}
      <div className="grid grid-cols-4 gap-1.5 mb-1.5">
        {[1, 5, 20, 100].map((qty) => (
          <button
            key={qty}
            onClick={() => onAdd(qty)}
            disabled={isDisabled}
            className={cn(
              "cursor-pointer py-3 rounded font-bold text-base transition-colors",
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
          disabled={isDisabled || countedQty <= 0}
          className="flex-1 py-2 bg-gray-200 text-gray-700 rounded text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-50"
        >
          <Minus className="w-3 h-3" />
          -1
        </button>
        <button
          onClick={() => {
            const qty = prompt("Exact qty:", String(countedQty));
            if (qty !== null && !isNaN(Number(qty))) onSetQuantity(Number(qty));
          }}
          disabled={isDisabled}
          className="flex-1 py-2 bg-gray-200 text-gray-700 rounded text-xs font-medium disabled:opacity-50"
        >
          Set Exact
        </button>
      </div>

      {/* Status */}
      {line.variance === 0 && !blindCount && (
        <div className="mt-1.5 flex items-center gap-1 text-green-700 bg-green-50 rounded p-1.5 text-xs">
          <CheckCircle className="w-3 h-3" />
          <span className="font-medium">Matches system</span>
        </div>
      )}
      {line.variance !== null && line.variance !== 0 && !blindCount && (
        <div className="mt-1.5 flex items-center gap-1 text-yellow-700 bg-yellow-50 rounded p-1.5 text-xs">
          <AlertTriangle className="w-3 h-3" />
          <span className="font-medium">
            Variance: {line.variance > 0 ? `+${line.variance}` : line.variance}
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
  item: LineItem & { isComplete?: boolean };
  blindCount: boolean;
  isSelected: boolean;
  onClick: () => void;
  disabled: boolean;
}

function CompactItemCard({
  item,
  blindCount,
  isSelected,
  onClick,
  disabled,
}: CompactItemCardProps) {
  const counted = item.countedQty ?? 0;
  const system = item.systemQty ?? 0;
  const hasVariance =
    !blindCount && item.variance !== null && item.variance !== 0;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "cursor-pointer transition hover:bg-gray-50 w-full bg-white rounded p-2 text-left",
        isSelected ? "ring-2 ring-blue-500" : "border border-gray-200",
        disabled && "cursor-default",
      )}
    >
      <div className="flex items-center gap-2">
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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-gray-900 text-xs truncate">
              {item.sku}
            </span>
            {counted > 0 && !hasVariance && (
              <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
            )}
            {hasVariance && (
              <AlertTriangle className="w-3 h-3 text-yellow-500 flex-shrink-0" />
            )}
            {item.isUnexpected && (
              <span className="text-[10px] bg-purple-100 text-purple-700 px-1 rounded">
                NEW
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-500 truncate">
            {item.productName}
          </p>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="font-bold text-xs text-gray-900">
            {counted}
            {!blindCount && (
              <span className="text-gray-400 font-normal">/{system}</span>
            )}
          </p>
          {hasVariance && (
            <p
              className={cn(
                "text-[10px] font-medium",
                item.variance! > 0 ? "text-blue-600" : "text-red-600",
              )}
            >
              {item.variance! > 0 ? `+${item.variance}` : item.variance}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual Barcode Modal
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
            <X className="w-4 h-4 cursor-pointer" />
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
// Submit Modal
// ─────────────────────────────────────────────────────────────────────────────

interface SubmitModalProps {
  summary: Summary;
  lineItems: Array<LineItem & { isComplete?: boolean }>;
  blindCount: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function SubmitModal({
  summary,
  lineItems,
  blindCount,
  onConfirm,
  onCancel,
}: SubmitModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const uncountedItems = lineItems.filter((l) => (l.countedQty ?? 0) === 0);

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
        <h3 className="font-bold text-gray-900 mb-3">Submit for Review?</h3>

        <div className="bg-gray-50 rounded p-3 mb-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Items Counted</span>
            <span className="font-semibold">
              {summary.countedItems}/{summary.totalItems}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Total Counted</span>
            <span className="font-semibold">{summary.totalCounted}</span>
          </div>
          {!blindCount && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">System Total</span>
                <span className="font-semibold">{summary.totalExpected}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1">
                <span className="text-gray-600">Variances</span>
                <span
                  className={cn(
                    "font-semibold",
                    summary.varianceItems > 0
                      ? "text-yellow-600"
                      : "text-green-600",
                  )}
                >
                  {summary.varianceItems} items
                </span>
              </div>
            </>
          )}
        </div>

        {uncountedItems.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-xs flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-yellow-600" />
            <span className="text-yellow-800">
              {uncountedItems.length} items not counted (will be marked as 0)
            </span>
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
