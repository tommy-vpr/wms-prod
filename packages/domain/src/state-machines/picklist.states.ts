/**
 * Picklist State Machine
 * Defines valid states and transitions for picklists
 */

export const PicklistStatus = {
  CREATED: "CREATED",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export type PicklistStatus =
  (typeof PicklistStatus)[keyof typeof PicklistStatus];

export const PicklistBlockReason = {
  SHORT_PICK: "SHORT_PICK",
  LOCATION_EMPTY: "LOCATION_EMPTY",
  DAMAGED_INVENTORY: "DAMAGED_INVENTORY",
  PICKER_TIMEOUT: "PICKER_TIMEOUT",
  SUPERVISOR_HOLD: "SUPERVISOR_HOLD",
} as const;

export type PicklistBlockReason =
  (typeof PicklistBlockReason)[keyof typeof PicklistBlockReason];

// Valid state transitions
const transitions: Record<PicklistStatus, PicklistStatus[]> = {
  [PicklistStatus.CREATED]: [PicklistStatus.ASSIGNED, PicklistStatus.CANCELLED],
  [PicklistStatus.ASSIGNED]: [
    PicklistStatus.IN_PROGRESS,
    PicklistStatus.CREATED,
    PicklistStatus.CANCELLED,
  ],
  [PicklistStatus.IN_PROGRESS]: [
    PicklistStatus.COMPLETED,
    PicklistStatus.BLOCKED,
    PicklistStatus.CANCELLED,
  ],
  [PicklistStatus.BLOCKED]: [
    PicklistStatus.IN_PROGRESS,
    PicklistStatus.CANCELLED,
  ],
  [PicklistStatus.COMPLETED]: [], // Terminal state
  [PicklistStatus.CANCELLED]: [], // Terminal state
};

export function canTransition(
  from: PicklistStatus,
  to: PicklistStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: PicklistStatus,
  to: PicklistStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidPicklistTransitionError(from, to);
  }
}

export function getValidTransitions(status: PicklistStatus): PicklistStatus[] {
  return transitions[status];
}

export function isTerminalState(status: PicklistStatus): boolean {
  return transitions[status].length === 0;
}

export class InvalidPicklistTransitionError extends Error {
  constructor(
    public readonly from: PicklistStatus,
    public readonly to: PicklistStatus,
  ) {
    super(`Invalid picklist transition: ${from} → ${to}`);
    this.name = "InvalidPicklistTransitionError";
  }
}
