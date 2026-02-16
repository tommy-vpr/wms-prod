/**
 * Receiving Dashboard - Production Version
 *
 * Save to: apps/web/src/pages/receiving/index.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Package,
  ClipboardCheck,
  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
  Plus,
  Search,
  RefreshCw,
  AlertTriangle,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SessionListItem {
  id: string;
  poId: string;
  poReference: string;
  vendor: string | null;
  status: string;
  version: number;
  countedBy: { id: string; name: string | null } | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  totalItems: number;
  totalExpected: number;
  totalCounted: number;
}

interface PendingSession {
  id: string;
  poReference: string;
  vendor: string | null;
  status: string;
  submittedAt: string | null;
  totalItems: number;
  totalExpected: number;
  totalCounted: number;
  totalDamaged: number;
  countedByUser: { id: string; name: string | null } | null;
  assignedToUser: { id: string; name: string | null } | null;
}

type TabType = "active" | "pending" | "history";

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ReceivingDashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ type: string; message: string } | null>(
    (location.state as any)?.toast || null,
  );

  // Data states
  const [activeSessions, setActiveSessions] = useState<SessionListItem[]>([]);
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [historySessions, setHistorySessions] = useState<SessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Clear location state after reading toast
  useEffect(() => {
    if (location.state) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Clear toast after delay
  useEffect(() => {
    if (toast) {
      const timeout = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timeout);
    }
  }, [toast]);

  // Fetch data
  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);

    try {
      const [activeRes, pendingRes, historyRes] = await Promise.all([
        apiClient.get<{ sessions: SessionListItem[] }>(
          "/receiving?status=IN_PROGRESS,SUBMITTED",
        ),
        apiClient.get<PendingSession[]>("/receiving/pending"),
        apiClient.get<{ sessions: SessionListItem[] }>(
          "/receiving?status=APPROVED,REJECTED,CANCELLED&limit=50",
        ),
      ]);

      setActiveSessions(activeRes.sessions || []);
      setPendingSessions(pendingRes || []);
      setHistorySessions(historyRes.sessions || []);
    } catch (err) {
      console.error("Failed to fetch receiving data:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Poll for updates
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Filter sessions by search
  const filterSessions = <
    T extends { poReference: string; vendor?: string | null },
  >(
    sessions: T[],
  ): T[] => {
    if (!searchQuery) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.poReference?.toLowerCase().includes(q) ||
        s.vendor?.toLowerCase().includes(q),
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-800";
      case "SUBMITTED":
        return "bg-yellow-100 text-yellow-800";
      case "APPROVED":
        return "bg-green-100 text-green-800";
      case "REJECTED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "IN_PROGRESS":
        return <Clock className="w-4 h-4" />;
      case "SUBMITTED":
        return <ClipboardCheck className="w-4 h-4" />;
      case "APPROVED":
        return <CheckCircle className="w-4 h-4" />;
      case "REJECTED":
        return <XCircle className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed top-4 left-4 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center gap-3",
            toast.type === "success" && "bg-green-600 text-white",
            toast.type === "error" && "bg-red-600 text-white",
            toast.type === "info" && "bg-blue-600 text-white",
          )}
        >
          {toast.type === "success" && <CheckCircle className="w-5 h-5" />}
          {toast.type === "error" && <AlertTriangle className="w-5 h-5" />}
          <span className="flex-1 font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Receiving</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
                className="cursor-pointer p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("w-5 h-5", isRefreshing && "animate-spin")}
                />
              </button>
              <button
                onClick={() => navigate("/receiving/purchase-orders")}
                className="cursor-pointer flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 active:bg-blue-800"
              >
                <Plus className="w-5 h-5" />
                <span>New</span>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search PO# or vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="cursor-pointer w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-gray-200">
          <button
            onClick={() => setActiveTab("active")}
            className={cn(
              "cursor-pointer flex-1 py-3 text-sm font-medium text-center border-b-2 transition-colors",
              activeTab === "active"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            Active
            {activeSessions.length > 0 && (
              <span className="ml-1.5 bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-xs">
                {activeSessions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("pending")}
            className={cn(
              "cursor-pointer flex-1 py-3 text-sm font-medium text-center border-b-2 transition-colors",
              activeTab === "pending"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            Pending Approval
            {pendingSessions.length > 0 && (
              <span className="ml-1.5 bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full text-xs">
                {pendingSessions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={cn(
              "cursor-pointer flex-1 py-3 text-sm font-medium text-center border-b-2 transition-colors",
              activeTab === "history"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700",
            )}
          >
            History
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === "active" && (
          <SessionList
            sessions={filterSessions(activeSessions)}
            isLoading={isLoading}
            emptyMessage="No active receiving sessions"
            emptyAction={
              <button
                onClick={() => navigate("/receiving/purchase-orders")}
                className="cursor-pointer mt-4 text-blue-600 font-medium"
              >
                Start New Session
              </button>
            }
            onSessionClick={(id) => navigate(`/receiving/session/${id}`)}
            getStatusColor={getStatusColor}
            getStatusIcon={getStatusIcon}
          />
        )}

        {activeTab === "pending" && (
          <PendingList
            sessions={filterSessions(pendingSessions)}
            isLoading={isLoading}
            emptyMessage="No sessions pending approval"
            onSessionClick={(id) => navigate(`/receiving/approve/${id}`)}
            getStatusColor={getStatusColor}
            getStatusIcon={getStatusIcon}
          />
        )}

        {activeTab === "history" && (
          <SessionList
            sessions={filterSessions(historySessions)}
            isLoading={isLoading}
            emptyMessage="No receiving history"
            onSessionClick={(id) => navigate(`/receiving/session/${id}`)}
            getStatusColor={getStatusColor}
            getStatusIcon={getStatusIcon}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session List Component
// ─────────────────────────────────────────────────────────────────────────────

interface SessionListProps {
  sessions: SessionListItem[];
  isLoading: boolean;
  emptyMessage: string;
  emptyAction?: React.ReactNode;
  onSessionClick: (id: string) => void;
  getStatusColor: (status: string) => string;
  getStatusIcon: (status: string) => React.ReactNode;
}

function SessionList({
  sessions,
  isLoading,
  emptyMessage,
  emptyAction,
  onSessionClick,
  getStatusColor,
  getStatusIcon,
}: SessionListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg p-4 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className="text-center py-12">
        <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => onSessionClick(session.id)}
          className="cursor-pointer w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 text-left hover:border-blue-300 hover:shadow transition-all active:bg-gray-50"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-900 truncate">
                  {session.poReference}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                    getStatusColor(session.status),
                  )}
                >
                  {getStatusIcon(session.status)}
                  {session.status.replace("_", " ")}
                </span>
              </div>
              {session.vendor && (
                <p className="text-sm text-gray-600 truncate">
                  {session.vendor}
                </p>
              )}
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <span>{session.totalItems} items</span>
                <span>
                  {session.totalCounted}/{session.totalExpected} units
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" />
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                session.totalCounted >= session.totalExpected
                  ? "bg-green-500"
                  : "bg-blue-500",
              )}
              style={{
                width: `${Math.min(100, (session.totalCounted / session.totalExpected) * 100)}%`,
              }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending List Component
// ─────────────────────────────────────────────────────────────────────────────

interface PendingListProps {
  sessions: PendingSession[];
  isLoading: boolean;
  emptyMessage: string;
  onSessionClick: (id: string) => void;
  getStatusColor: (status: string) => string;
  getStatusIcon: (status: string) => React.ReactNode;
}

function PendingList({
  sessions,
  isLoading,
  emptyMessage,
  onSessionClick,
  getStatusColor,
  getStatusIcon,
}: PendingListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg p-4 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className="text-center py-12">
        <ClipboardCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const hasVariance = session.totalCounted !== session.totalExpected;
        const hasDamage = session.totalDamaged > 0;

        return (
          <button
            key={session.id}
            onClick={() => onSessionClick(session.id)}
            className="cursor-pointer w-full bg-white rounded-lg p-4 shadow-sm border border-gray-200 text-left hover:border-blue-300 hover:shadow transition-all active:bg-gray-50"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-semibold text-gray-900 truncate">
                    {session.poReference}
                  </span>
                  {hasVariance && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      Variance
                    </span>
                  )}
                  {hasDamage && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                      Damaged
                    </span>
                  )}
                </div>
                {session.vendor && (
                  <p className="text-sm text-gray-600 truncate">
                    {session.vendor}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                  <span>{session.totalItems} items</span>
                  <span>
                    {session.totalCounted}/{session.totalExpected} units
                  </span>
                </div>
                {session.countedByUser && (
                  <p className="text-sm text-gray-500 mt-1">
                    By {session.countedByUser.name || "Unknown"} •{" "}
                    {session.submittedAt
                      ? new Date(session.submittedAt).toLocaleDateString()
                      : ""}
                  </p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2" />
            </div>

            {/* Review prompt */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <span className="text-sm font-medium text-blue-600">
                Review & Approve →
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
