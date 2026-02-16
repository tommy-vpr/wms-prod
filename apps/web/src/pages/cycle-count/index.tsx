/**
 * Cycle Count Dashboard
 *
 * Save to: apps/web/src/pages/cycle-count/index.tsx
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Plus,
  MapPin,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

interface Task {
  id: string;
  taskNumber: string;
  name: string | null;
  type: string;
  status: string;
  priority: number;
  scheduledDate: string | null;
  dueDate: string | null;
  blindCount: boolean;
  locationIds: string[];
  assignedTo: { id: string; name: string | null } | null;
  sessions: Array<{ id: string; status: string; locationId: string }>;
  createdAt: string;
}

interface Session {
  id: string;
  status: string;
  location: { id: string; name: string };
  countedBy: { id: string; name: string | null } | null;
  task: { id: string; taskNumber: string; name: string | null } | null;
  totalExpected: number;
  totalCounted: number;
  varianceCount: number;
  createdAt: string;
}

export default function CycleCountDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"tasks" | "sessions" | "pending">(
    "tasks",
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pendingSessions, setPendingSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [tasksRes, sessionsRes, pendingRes] = await Promise.all([
        apiClient.get<{ tasks: Task[]; total: number }>(
          "/cycle-count/tasks?status=PENDING,IN_PROGRESS",
        ),
        apiClient.get<{ sessions: Session[]; total: number }>(
          "/cycle-count/sessions?status=IN_PROGRESS&limit=20",
        ),
        apiClient.get<{ sessions: Session[]; total: number }>(
          "/cycle-count/sessions/pending",
        ),
      ]);

      setTasks(tasksRes.tasks || []);
      setSessions(sessionsRes.sessions || []);
      setPendingSessions(pendingRes.sessions || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-gray-100 text-gray-700";
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-700";
      case "SUBMITTED":
        return "bg-yellow-100 text-yellow-700";
      case "APPROVED":
        return "bg-green-100 text-green-700";
      case "REJECTED":
        return "bg-red-100 text-red-700";
      case "COMPLETED":
        return "bg-green-100 text-green-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Cycle Count</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchData}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
              <button
                onClick={() => navigate("/cycle-count/start")}
                className="cursor-pointer transition flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium"
              >
                <Plus className="w-4 h-4" />
                New Count
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("tasks")}
            className={cn(
              "cursor-pointer hover:text-blue-400 flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "tasks"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500",
            )}
          >
            Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab("sessions")}
            className={cn(
              "cursor-pointer hover:text-blue-400 flex-1 py-3 text-sm font-medium border-b-2 transition-colors",
              activeTab === "sessions"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500",
            )}
          >
            In Progress ({sessions.length})
          </button>
          <button
            onClick={() => setActiveTab("pending")}
            className={cn(
              "cursor-pointer hover:text-blue-400 flex-1 py-3 text-sm font-medium border-b-2 transition-colors relative",
              activeTab === "pending"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500",
            )}
          >
            Review ({pendingSessions.length})
            {pendingSessions.length > 0 && (
              <span className="absolute top-2 right-4 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {activeTab === "tasks" && (
          <div className="space-y-3">
            {tasks.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No active tasks"
                description="Create a new cycle count task to get started"
                action={() => navigate("/cycle-count/start")}
                actionLabel="New Task"
              />
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate(`/cycle-count/task/${task.id}`)}
                  statusColor={getStatusColor(task.status)}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "sessions" && (
          <div className="space-y-3">
            {sessions.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="No active counts"
                description="Start counting a location"
                action={() => navigate("/cycle-count/start")}
                actionLabel="Start Count"
              />
            ) : (
              sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={() => navigate(`/cycle-count/session/${session.id}`)}
                  statusColor={getStatusColor(session.status)}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "pending" && (
          <div className="space-y-3">
            {pendingSessions.length === 0 ? (
              <EmptyState
                icon={CheckCircle}
                title="No pending reviews"
                description="All counts have been reviewed"
              />
            ) : (
              pendingSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={() => navigate(`/cycle-count/review/${session.id}`)}
                  statusColor={getStatusColor(session.status)}
                  showVariance
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onClick,
  statusColor,
}: {
  task: Task;
  onClick: () => void;
  statusColor: string;
}) {
  const completedSessions = task.sessions.filter(
    (s) => s.status === "APPROVED",
  ).length;
  const totalLocations = task.locationIds.length;
  const progress =
    totalLocations > 0
      ? Math.round((completedSessions / totalLocations) * 100)
      : 0;

  return (
    <button
      onClick={onClick}
      className="cursor-pointer w-full bg-white rounded-lg p-4 text-left border border-gray-200 hover:border-blue-300 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-semibold text-gray-900">{task.taskNumber}</p>
          <p className="text-sm text-gray-500">{task.name || task.type}</p>
        </div>
        <span
          className={cn("px-2 py-1 rounded text-xs font-medium", statusColor)}
        >
          {task.status.replace("_", " ")}
        </span>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
        <span className="flex items-center gap-1">
          <MapPin className="w-4 h-4" />
          {totalLocations} locations
        </span>
        {task.dueDate && (
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            Due {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-gray-500">
          {completedSessions}/{totalLocations}
        </span>
      </div>
    </button>
  );
}

function SessionCard({
  session,
  onClick,
  statusColor,
  showVariance,
}: {
  session: Session;
  onClick: () => void;
  statusColor: string;
  showVariance?: boolean;
}) {
  const progress =
    session.totalExpected > 0
      ? Math.round((session.totalCounted / session.totalExpected) * 100)
      : 0;

  return (
    <button
      onClick={onClick}
      className="cursor-pointer w-full bg-white rounded-lg p-4 text-left border border-gray-200 hover:border-blue-300 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-semibold text-gray-900">{session.location.name}</p>
          {session.task && (
            <p className="text-sm text-gray-500">{session.task.taskNumber}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showVariance && session.varianceCount > 0 && (
            <span className="flex items-center gap-1 text-yellow-600 text-xs font-medium">
              <AlertTriangle className="w-3 h-3" />
              {session.varianceCount}
            </span>
          )}
          <span
            className={cn("px-2 py-1 rounded text-xs font-medium", statusColor)}
          >
            {session.status.replace("_", " ")}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          Counted by {session.countedBy?.name || "Unknown"}
        </span>
        <span className="font-medium">
          {session.totalCounted}/{session.totalExpected}
        </span>
      </div>

      {/* Progress */}
      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            progress >= 100 ? "bg-green-500" : "bg-blue-500",
          )}
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
}: {
  icon: any;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="bg-white rounded-lg p-8 text-center">
      <Icon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="font-medium text-gray-900 mb-1">{title}</p>
      <p className="text-sm text-gray-500 mb-4">{description}</p>
      {action && actionLabel && (
        <button
          onClick={action}
          className="cursor-pointer transition px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
