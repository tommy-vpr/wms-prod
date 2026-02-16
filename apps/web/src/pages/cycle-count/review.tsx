/**
 * Cycle Count Review - Manager Approval
 *
 * Save to: apps/web/src/pages/cycle-count/review.tsx
 */

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Package,
  MapPin,
  User,
  Clock,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

interface LineItem {
  id: string;
  sku: string;
  productName: string;
  systemQty: number | null;
  countedQty: number | null;
  variance: number | null;
  isUnexpected: boolean;
  imageUrl: string | null;
}

interface SessionData {
  session: {
    id: string;
    location: { id: string; name: string };
    blindCount: boolean;
    status: string;
    countedBy: { id: string; name: string | null } | null;
    startedAt: string;
    submittedAt: string | null;
    task: { taskNumber: string; name: string | null } | null;
  };
  lineItems: LineItem[];
  summary: {
    totalItems: number;
    totalExpected: number;
    totalCounted: number;
    varianceItems: number;
  };
}

export default function CycleCountReviewPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();

  const [data, setData] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const result = await apiClient.get<SessionData>(
          `/cycle-count/sessions/${sessionId}`,
        );
        setData(result);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [sessionId]);

  const handleApprove = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      await apiClient.post(`/cycle-count/sessions/${sessionId}/approve`, {});
      navigate("/cycle-count", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setIsProcessing(false);
    }
  };

  const handleReject = async (reason: string) => {
    setIsProcessing(true);
    setError(null);

    try {
      await apiClient.post(`/cycle-count/sessions/${sessionId}/reject`, {
        reason,
      });
      navigate("/cycle-count", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="bg-white rounded-lg p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-gray-900 font-medium mb-2">{error}</p>
          <button
            onClick={() => navigate("/cycle-count")}
            className="text-blue-600"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { session, lineItems, summary } = data;
  const varianceLines = lineItems.filter(
    (l) => l.variance !== null && l.variance !== 0,
  );
  const netVariance = lineItems.reduce((sum, l) => sum + (l.variance ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate("/cycle-count")}
            className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Review Count</h1>
            <p className="text-sm text-gray-500">{session.location.name}</p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Summary Card */}
      <div className="p-4">
        <div className="bg-white rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span>{session.location.name}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-gray-400" />
              <span>{session.countedBy?.name || "Unknown"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-400" />
              <span>
                {session.submittedAt
                  ? new Date(session.submittedAt).toLocaleString()
                  : "-"}
              </span>
            </div>
            {session.task && (
              <div className="flex items-center gap-2 text-sm">
                <Package className="w-4 h-4 text-gray-400" />
                <span>{session.task.taskNumber}</span>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Items Counted</span>
              <span className="font-semibold">{summary.totalItems}</span>
            </div>
            {!session.blindCount && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">System Total</span>
                  <span className="font-semibold">{summary.totalExpected}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Counted Total</span>
                  <span className="font-semibold">{summary.totalCounted}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
                  <span className="text-gray-600">Net Variance</span>
                  <span
                    className={cn(
                      "font-bold",
                      netVariance === 0
                        ? "text-green-600"
                        : netVariance > 0
                          ? "text-blue-600"
                          : "text-red-600",
                    )}
                  >
                    {netVariance > 0 ? `+${netVariance}` : netVariance}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Variance Items */}
        {varianceLines.length > 0 && !session.blindCount && (
          <div className="mb-4">
            <h2 className="font-semibold text-gray-900 mb-2">
              Variances ({varianceLines.length})
            </h2>
            <div className="space-y-2">
              {varianceLines.map((line) => (
                <div
                  key={line.id}
                  className="bg-white rounded-lg p-3 border border-yellow-200"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{line.sku}</p>
                      <p className="text-sm text-gray-500">
                        {line.productName}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">
                        {line.systemQty} → {line.countedQty}
                      </p>
                      <p
                        className={cn(
                          "font-bold",
                          line.variance! > 0 ? "text-blue-600" : "text-red-600",
                        )}
                      >
                        {line.variance! > 0
                          ? `+${line.variance}`
                          : line.variance}
                      </p>
                    </div>
                  </div>
                  {line.isUnexpected && (
                    <span className="inline-block mt-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                      Unexpected Item
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Items */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-2">
            All Items ({lineItems.length})
          </h2>
          <div className="space-y-1">
            {lineItems.map((line) => (
              <div
                key={line.id}
                className={cn(
                  "bg-white rounded-lg p-2 border",
                  line.variance !== 0 && line.variance !== null
                    ? "border-yellow-200"
                    : "border-gray-200",
                )}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">{line.sku}</span>
                  <span>
                    {!session.blindCount && (
                      <span className="text-gray-400">{line.systemQty} → </span>
                    )}
                    <span className="font-semibold">{line.countedQty}</span>
                    {line.variance !== 0 && line.variance !== null && (
                      <span
                        className={cn(
                          "ml-2 font-semibold",
                          line.variance > 0 ? "text-blue-600" : "text-red-600",
                        )}
                      >
                        (
                        {line.variance > 0
                          ? `+${line.variance}`
                          : line.variance}
                        )
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {session.status === "SUBMITTED" && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
          <div className="flex gap-3">
            <button
              onClick={() => setShowRejectModal(true)}
              disabled={isProcessing}
              className="flex-1 py-3 bg-red-100 text-red-700 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <XCircle className="w-5 h-5" />
              Reject
            </button>
            <button
              onClick={handleApprove}
              disabled={isProcessing}
              className="flex-1 py-3 bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Approve
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <RejectModal
          onReject={handleReject}
          onCancel={() => setShowRejectModal(false)}
          isProcessing={isProcessing}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reject Modal
// ─────────────────────────────────────────────────────────────────────────────

function RejectModal({
  onReject,
  onCancel,
  isProcessing,
}: {
  onReject: (reason: string) => void;
  onCancel: () => void;
  isProcessing: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-xl p-4">
        <h3 className="font-bold text-gray-900 mb-3">Reject Count</h3>
        <p className="text-sm text-gray-600 mb-3">
          Please provide a reason for rejection. The counter will be notified.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection..."
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 mb-3"
        />

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onReject(reason)}
            disabled={isProcessing || !reason.trim()}
            className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Reject"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
