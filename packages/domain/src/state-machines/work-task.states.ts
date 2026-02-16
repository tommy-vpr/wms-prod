/**
 * Work Task State Machine
 * Defines valid states and transitions for work tasks
 */

export const WorkTaskStatus = {
  PENDING: "PENDING",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type WorkTaskStatus =
  (typeof WorkTaskStatus)[keyof typeof WorkTaskStatus];

export const WorkTaskBlockReason = {
  SHORT_PICK: "SHORT_PICK",
  LOCATION_EMPTY: "LOCATION_EMPTY",
  DAMAGED_INVENTORY: "DAMAGED_INVENTORY",
  PICKER_TIMEOUT: "PICKER_TIMEOUT",
  SUPERVISOR_HOLD: "SUPERVISOR_HOLD",
  EQUIPMENT_ISSUE: "EQUIPMENT_ISSUE",
  SYSTEM_ERROR: "SYSTEM_ERROR",
} as const;

export type WorkTaskBlockReason =
  (typeof WorkTaskBlockReason)[keyof typeof WorkTaskBlockReason];

// Valid state transitions
const transitions: Record<WorkTaskStatus, WorkTaskStatus[]> = {
  [WorkTaskStatus.PENDING]: [WorkTaskStatus.ASSIGNED, WorkTaskStatus.CANCELLED],
  [WorkTaskStatus.ASSIGNED]: [
    WorkTaskStatus.IN_PROGRESS,
    WorkTaskStatus.PENDING,
    WorkTaskStatus.CANCELLED,
  ],
  [WorkTaskStatus.IN_PROGRESS]: [
    WorkTaskStatus.COMPLETED,
    WorkTaskStatus.BLOCKED,
    WorkTaskStatus.PAUSED,
    WorkTaskStatus.CANCELLED,
  ],
  [WorkTaskStatus.BLOCKED]: [
    WorkTaskStatus.IN_PROGRESS,
    WorkTaskStatus.CANCELLED,
  ],
  [WorkTaskStatus.PAUSED]: [
    WorkTaskStatus.IN_PROGRESS,
    WorkTaskStatus.CANCELLED,
  ],
  [WorkTaskStatus.COMPLETED]: [], // Terminal state
  [WorkTaskStatus.CANCELLED]: [], // Terminal state
};

export function canTransition(
  from: WorkTaskStatus,
  to: WorkTaskStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: WorkTaskStatus,
  to: WorkTaskStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidWorkTaskTransitionError(from, to);
  }
}

export function getValidTransitions(status: WorkTaskStatus): WorkTaskStatus[] {
  return transitions[status];
}

export function isTerminalState(status: WorkTaskStatus): boolean {
  return transitions[status].length === 0;
}

export function isActiveState(status: WorkTaskStatus): boolean {
  return (
    status === WorkTaskStatus.ASSIGNED ||
    status === WorkTaskStatus.IN_PROGRESS ||
    status === WorkTaskStatus.BLOCKED ||
    status === WorkTaskStatus.PAUSED
  );
}

export class InvalidWorkTaskTransitionError extends Error {
  constructor(
    public readonly from: WorkTaskStatus,
    public readonly to: WorkTaskStatus,
  ) {
    super(`Invalid work task transition: ${from} → ${to}`);
    this.name = "InvalidWorkTaskTransitionError";
  }
}
