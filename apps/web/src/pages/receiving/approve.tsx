/**
 * Receiving Approval Page - Production Version
 *
 * Save to: apps/web/src/pages/receiving/approve.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Package,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  User,
  Clock,
  Truck,
  ChevronDown,
  ChevronUp,
  MapPin,
  AlertCircle,
  RotateCcw,
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
  quantityExpected: number;
  quantityCounted: number;
  quantityDamaged: number;
  variance: number | null;
  isComplete: boolean;
  isOverage: boolean;
}

interface Session {
  id: string;
  poId: string;
  poReference: string;
  vendor: string | null;
  status: string;
  countedBy: { id: string; name: string | null } | null;
  receivingLocation: { id: string; name: string } | null;
  putawayTask: { id: string; taskNumber: string } | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

interface Summary {
  totalExpected: number;
  totalCounted: number;
  totalDamaged: number;
  variance: number;
  progress: number;
  hasVariances: boolean;
  hasExceptions: boolean;
}

interface SessionData {
  session: Session;
  lineItems: LineItem[];
  summary: Summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ReceivingApprovePage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();

  const [data, setData] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedItems, setExpandedItems] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isReopening, setIsReopening] = useState(false);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      const result = await apiClient.get<SessionData>(
        `/receiving/${sessionId}`,
      );
      setData(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch session:", err);
      setError((err as Error).message || "Failed to load session");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const handleApprove = async () => {
    if (!sessionId || isApproving) return;

    setIsApproving(true);
    setError(null);

    try {
      const result = await apiClient.post<{
        putawayTask: { id: string; taskNumber: string };
      }>(`/receiving/${sessionId}/approve`);

      navigate("/receiving", {
        replace: true,
        state: {
          toast: {
            type: "success",
            message: `Approved! Putaway task ${result.putawayTask.taskNumber} created.`,
          },
        },
      });
    } catch (err) {
      console.error("Failed to approve:", err);
      setError((err as Error).message || "Failed to approve");
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!sessionId || !rejectReason.trim() || isRejecting) return;

    setIsRejecting(true);
    setError(null);

    try {
      await apiClient.post(`/receiving/${sessionId}/reject`, {
        reason: rejectReason.trim(),
      });

      navigate("/receiving", {
        replace: true,
        state: {
          toast: {
            type: "info",
            message: "Session rejected and returned for re-counting",
          },
        },
      });
    } catch (err) {
      console.error("Failed to reject:", err);
      setError((err as Error).message || "Failed to reject");
      setIsRejecting(false);
    }
  };

  const handleReopen = async () => {
    if (!sessionId || isReopening) return;

    setIsReopening(true);
    setError(null);

    try {
      await apiClient.post(`/receiving/${sessionId}/reopen`);
      navigate(`/receiving/session/${sessionId}`, { replace: true });
    } catch (err) {
      console.error("Failed to reopen:", err);
      setError((err as Error).message || "Failed to reopen");
      setIsReopening(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="bg-white rounded-lg p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">{error}</h2>
          <button
            onClick={() => navigate("/receiving")}
            className="text-blue-600 font-medium"
          >
            ← Back to Receiving
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { session, lineItems, summary } = data;
  const isPending = session.status === "SUBMITTED";
  const isRejected = session.status === "REJECTED";
  const isApproved = session.status === "APPROVED";

  const varianceItems = lineItems.filter(
    (item) => item.variance !== 0 && item.variance !== null,
  );
  const shortItems = lineItems.filter((item) => (item.variance || 0) < 0);
  const overItems = lineItems.filter((item) => (item.variance || 0) > 0);
  const damagedItems = lineItems.filter((item) => item.quantityDamaged > 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/receiving")}
              className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">
                {isPending ? "Review Receiving" : "Receiving Details"}
              </h1>
              <p className="text-sm text-gray-500">{session.poReference}</p>
            </div>
            {isApproved && session.putawayTask && (
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                {session.putawayTask.taskNumber}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Rejected Banner */}
        {isRejected && session.rejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-red-800">Session Rejected</h3>
                <p className="text-sm text-red-700 mt-1">
                  {session.rejectionReason}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Approved Banner */}
        {isApproved && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-green-800">Session Approved</h3>
                <p className="text-sm text-green-700 mt-1">
                  Inventory has been created.
                  {session.putawayTask && (
                    <span>
                      {" "}
                      Putaway task:{" "}
                      <strong>{session.putawayTask.taskNumber}</strong>
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Session Info */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
          <div className="space-y-3">
            {session.vendor && (
              <div className="flex items-center gap-3">
                <Truck className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Vendor</p>
                  <p className="font-medium text-gray-900">{session.vendor}</p>
                </div>
              </div>
            )}

            {session.countedBy && (
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Counted By</p>
                  <p className="font-medium text-gray-900">
                    {session.countedBy.name || "Unknown"}
                  </p>
                </div>
              </div>
            )}

            {session.receivingLocation && (
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Receiving Location</p>
                  <p className="font-medium text-gray-900">
                    {session.receivingLocation.name}
                  </p>
                </div>
              </div>
            )}

            {session.submittedAt && (
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Submitted</p>
                  <p className="font-medium text-gray-900">
                    {new Date(session.submittedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
          <h2 className="font-semibold text-gray-900 mb-4">Summary</h2>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {summary.totalCounted}
              </p>
              <p className="text-sm text-gray-500">Counted</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {summary.totalExpected}
              </p>
              <p className="text-sm text-gray-500">Expected</p>
            </div>
            <div
              className={cn(
                "text-center p-3 rounded-lg",
                summary.variance === 0
                  ? "bg-green-50"
                  : summary.variance > 0
                    ? "bg-yellow-50"
                    : "bg-red-50",
              )}
            >
              <p
                className={cn(
                  "text-2xl font-bold",
                  summary.variance === 0
                    ? "text-green-600"
                    : summary.variance > 0
                      ? "text-yellow-600"
                      : "text-red-600",
                )}
              >
                {summary.variance > 0 ? "+" : ""}
                {summary.variance}
              </p>
              <p className="text-sm text-gray-500">Variance</p>
            </div>
          </div>

          {summary.totalDamaged > 0 && (
            <div className="p-3 bg-red-50 rounded-lg mb-4">
              <div className="flex items-center justify-between">
                <span className="text-red-800 font-medium">Damaged</span>
                <span className="text-red-800 font-bold">
                  {summary.totalDamaged} units
                </span>
              </div>
            </div>
          )}

          {/* Progress */}
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                summary.progress >= 100 ? "bg-green-500" : "bg-blue-500",
              )}
              style={{ width: `${Math.min(100, summary.progress)}%` }}
            />
          </div>
          <p className="text-center text-sm text-gray-500 mt-2">
            {summary.progress}% complete
          </p>
        </div>

        {/* Variance Alert */}
        {varianceItems.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-yellow-800">
                  Variances Detected
                </h3>
                <p className="text-sm text-yellow-700 mt-1">
                  {shortItems.length > 0 && (
                    <span className="block">
                      • {shortItems.length} items short
                    </span>
                  )}
                  {overItems.length > 0 && (
                    <span className="block">
                      • {overItems.length} items over
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Damage Alert */}
        {damagedItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-red-800">
                  Damaged Items Reported
                </h3>
                <p className="text-sm text-red-700 mt-1">
                  {damagedItems.length} items with damage (
                  {summary.totalDamaged} units)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Items with Variance */}
        {varianceItems.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">
                Items with Variance
              </h2>
            </div>
            <div className="divide-y divide-gray-100">
              {varianceItems.map((item) => (
                <VarianceItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* All Items (Collapsible) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <button
            onClick={() => setExpandedItems(!expandedItems)}
            className="w-full p-4 flex items-center justify-between text-left"
          >
            <h2 className="font-semibold text-gray-900">
              All Items ({lineItems.length})
            </h2>
            {expandedItems ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {expandedItems && (
            <div className="border-t border-gray-200 divide-y divide-gray-100">
              {lineItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">
                        {item.sku}
                      </p>
                      {item.quantityDamaged > 0 && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                          {item.quantityDamaged} damaged
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {item.productName}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-medium text-gray-900">
                      {item.quantityCounted} / {item.quantityExpected}
                    </p>
                    {item.variance !== 0 && item.variance !== null && (
                      <p
                        className={cn(
                          "text-sm font-medium",
                          item.variance > 0
                            ? "text-yellow-600"
                            : "text-red-600",
                        )}
                      >
                        {item.variance > 0 ? "+" : ""}
                        {item.variance}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="ml-auto flex gap-2">
          {/* Bottom Action Bar */}
          {isPending && (
            <div className="p-4">
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={isApproving || isRejecting}
                  className="cursor-pointer py-2.5 px-4 bg-red-500 text-white rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-red-400 active:bg-red-300 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={isApproving || isRejecting}
                  className="cursor-pointer py-2.5 px-4 bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-green-500 active:bg-green-800 disabled:opacity-50"
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>Approve</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Rejected - Reopen Button */}
          {isRejected && (
            <div className="p-4">
              <button
                onClick={handleReopen}
                disabled={isReopening}
                className="cursor-pointer py-4 bg-blue-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50"
              >
                {isReopening ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Reopening...
                  </>
                ) : (
                  <>Reopen for Re-counting</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <RejectModal
          reason={rejectReason}
          onReasonChange={setRejectReason}
          isSubmitting={isRejecting}
          onConfirm={handleReject}
          onCancel={() => {
            setShowRejectModal(false);
            setRejectReason("");
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variance Item Row
// ─────────────────────────────────────────────────────────────────────────────

function VarianceItemRow({ item }: { item: LineItem }) {
  const isShort = (item.variance || 0) < 0;

  return (
    <div className="p-4 flex items-center gap-3">
      <div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
          isShort ? "bg-red-100" : "bg-yellow-100",
        )}
      >
        <AlertTriangle
          className={cn(
            "w-5 h-5",
            isShort ? "text-red-600" : "text-yellow-600",
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{item.sku}</p>
        <p className="text-sm text-gray-500 truncate">{item.productName}</p>
      </div>
      <div className="text-right">
        <p className="font-medium text-gray-900">
          {item.quantityCounted} / {item.quantityExpected}
        </p>
        <p
          className={cn(
            "text-sm font-medium",
            isShort ? "text-red-600" : "text-yellow-600",
          )}
        >
          {isShort ? "" : "+"}
          {item.variance} {isShort ? "short" : "over"}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reject Modal
// ─────────────────────────────────────────────────────────────────────────────

interface RejectModalProps {
  reason: string;
  onReasonChange: (reason: string) => void;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function RejectModal({
  reason,
  onReasonChange,
  isSubmitting,
  onConfirm,
  onCancel,
}: RejectModalProps) {
  const quickReasons = [
    "Recount needed",
    "Wrong quantities",
    "Items not received",
    "Data entry error",
    "Damaged not reported",
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-xl p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Reject Session</h3>

        <p className="text-gray-600 mb-4">
          Please provide a reason for rejection. The counter will be notified
          and can reopen the session.
        </p>

        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Enter rejection reason..."
          rows={4}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
        />

        {/* Quick Reasons */}
        <div className="flex flex-wrap gap-2 mt-3 mb-4">
          {quickReasons.map((quickReason) => (
            <button
              key={quickReason}
              onClick={() => onReasonChange(quickReason)}
              className="cursor-pointer px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-xs hover:bg-gray-200"
            >
              {quickReason}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="cursor-pointer flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting || !reason.trim()}
            className="cursor-pointer flex-1 py-3 bg-red-400 text-white rounded-lg font-medium hover:bg-red-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Rejecting...
              </>
            ) : (
              <>Reject</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
