/**
 * Order State Machine
 * Defines valid states and transitions for orders
 */

export const OrderStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  READY_TO_PICK: "READY_TO_PICK",
  PICKING: "PICKING",
  PICKED: "PICKED",
  PACKING: "PACKING",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  ON_HOLD: "ON_HOLD",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderHoldReason = {
  PAYMENT_PENDING: "PAYMENT_PENDING",
  CREDIT_HOLD: "CREDIT_HOLD",
  FRAUD_REVIEW: "FRAUD_REVIEW",
  ADDRESS_VERIFICATION: "ADDRESS_VERIFICATION",
  INVENTORY_SHORTAGE: "INVENTORY_SHORTAGE",
  CUSTOMER_REQUEST: "CUSTOMER_REQUEST",
} as const;

export type OrderHoldReason =
  (typeof OrderHoldReason)[keyof typeof OrderHoldReason];

// Valid state transitions
const transitions: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.READY_TO_PICK,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.READY_TO_PICK]: [
    OrderStatus.PICKING,
    OrderStatus.ON_HOLD,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PICKING]: [
    OrderStatus.PICKED,
    OrderStatus.READY_TO_PICK,
    OrderStatus.ON_HOLD,
  ],
  [OrderStatus.PICKED]: [OrderStatus.PACKING, OrderStatus.ON_HOLD],
  [OrderStatus.PACKING]: [OrderStatus.PACKED, OrderStatus.PICKED],
  [OrderStatus.PACKED]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [], // Terminal state
  [OrderStatus.CANCELLED]: [], // Terminal state
  [OrderStatus.ON_HOLD]: [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.READY_TO_PICK,
    OrderStatus.PICKING,
    OrderStatus.PICKED,
    OrderStatus.CANCELLED,
  ],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}

export function getValidTransitions(status: OrderStatus): OrderStatus[] {
  return transitions[status];
}

export function isTerminalState(status: OrderStatus): boolean {
  return transitions[status].length === 0;
}

export function isPickable(status: OrderStatus): boolean {
  return status === OrderStatus.READY_TO_PICK;
}

export function isShippable(status: OrderStatus): boolean {
  return status === OrderStatus.PACKED;
}

export class InvalidOrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Invalid order transition: ${from} → ${to}`);
    this.name = "InvalidOrderTransitionError";
  }
}
