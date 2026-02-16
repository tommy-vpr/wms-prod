/**
 * Eligibility Policy
 * Rules that determine if an order can proceed to picking
 */

export interface Order {
  id: string;
  status: string;
  paymentStatus:
    | "PENDING"
    | "AUTHORIZED"
    | "PAID"
    | "PARTIALLY_REFUNDED"
    | "REFUNDED"
    | "FAILED";
  warehouseId?: string;
  customerId: string;
  holdReason?: string;
  items: OrderItem[];
  createdAt: Date;
}

export interface OrderItem {
  sku: string;
  quantity: number;
}

export interface Customer {
  id: string;
  creditStatus: "GOOD" | "ON_HOLD" | "BLOCKED";
  shippingEmbargo: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export interface EligibilityRule {
  name: string;
  check(order: Order, customer?: Customer): EligibilityResult;
}

/**
 * Payment must be confirmed
 */
export class PaymentConfirmedRule implements EligibilityRule {
  name = "PAYMENT_CONFIRMED";

  check(order: Order): EligibilityResult {
    if (order.paymentStatus === "PAID") {
      return { eligible: true, reasons: [] };
    }
    return {
      eligible: false,
      reasons: [`Payment status is ${order.paymentStatus}, expected PAID`],
    };
  }
}

/**
 * Order must not be on hold
 */
export class NotOnHoldRule implements EligibilityRule {
  name = "NOT_ON_HOLD";

  check(order: Order): EligibilityResult {
    if (!order.holdReason) {
      return { eligible: true, reasons: [] };
    }
    return {
      eligible: false,
      reasons: [`Order is on hold: ${order.holdReason}`],
    };
  }
}

/**
 * Order must have items
 * (All items are physical in this system - no digital products)
 */
export class HasPhysicalItemsRule implements EligibilityRule {
  name = "HAS_PHYSICAL_ITEMS";

  check(order: Order): EligibilityResult {
    if (order.items.length > 0) {
      return { eligible: true, reasons: [] };
    }
    return {
      eligible: false,
      reasons: ["Order has no items"],
    };
  }
}

/**
 * Warehouse must be assigned
 */
export class WarehouseAssignedRule implements EligibilityRule {
  name = "WAREHOUSE_ASSIGNED";

  check(order: Order): EligibilityResult {
    if (order.warehouseId) {
      return { eligible: true, reasons: [] };
    }
    return {
      eligible: false,
      reasons: ["No warehouse assigned to order"],
    };
  }
}

/**
 * Customer must not be blocked
 */
export class CustomerNotBlockedRule implements EligibilityRule {
  name = "CUSTOMER_NOT_BLOCKED";

  check(order: Order, customer?: Customer): EligibilityResult {
    if (!customer) {
      return { eligible: true, reasons: [] }; // Skip if no customer info
    }
    if (customer.creditStatus === "BLOCKED") {
      return {
        eligible: false,
        reasons: ["Customer account is blocked"],
      };
    }
    if (customer.shippingEmbargo) {
      return {
        eligible: false,
        reasons: ["Customer has a shipping embargo"],
      };
    }
    return { eligible: true, reasons: [] };
  }
}

/**
 * Order must be in correct status
 */
export class CorrectStatusRule implements EligibilityRule {
  name = "CORRECT_STATUS";

  constructor(
    private allowedStatuses: string[] = ["CONFIRMED", "READY_TO_PICK"],
  ) {}

  check(order: Order): EligibilityResult {
    if (this.allowedStatuses.includes(order.status)) {
      return { eligible: true, reasons: [] };
    }
    return {
      eligible: false,
      reasons: [
        `Order status ${order.status} not in allowed statuses: ${this.allowedStatuses.join(", ")}`,
      ],
    };
  }
}

/**
 * Eligibility Policy - combines multiple rules
 */
export class EligibilityPolicy {
  private rules: EligibilityRule[];

  constructor(rules?: EligibilityRule[]) {
    this.rules = rules ?? [
      new PaymentConfirmedRule(),
      new NotOnHoldRule(),
      new HasPhysicalItemsRule(),
      new WarehouseAssignedRule(),
      new CorrectStatusRule(),
    ];
  }

  check(order: Order, customer?: Customer): EligibilityResult {
    const allReasons: string[] = [];

    for (const rule of this.rules) {
      const result = rule.check(order, customer);
      if (!result.eligible) {
        allReasons.push(...result.reasons);
      }
    }

    return {
      eligible: allReasons.length === 0,
      reasons: allReasons,
    };
  }

  addRule(rule: EligibilityRule): void {
    this.rules.push(rule);
  }
}

/**
 * Factory for creating eligibility policies
 */
export function createDefaultEligibilityPolicy(): EligibilityPolicy {
  return new EligibilityPolicy();
}

export function createStrictEligibilityPolicy(): EligibilityPolicy {
  return new EligibilityPolicy([
    new PaymentConfirmedRule(),
    new NotOnHoldRule(),
    new HasPhysicalItemsRule(),
    new WarehouseAssignedRule(),
    new CustomerNotBlockedRule(),
    new CorrectStatusRule(),
  ]);
}
