/**
 * Order Service
 * Orchestrates order-related business logic
 */

import {
  OrderStatus,
  assertTransition,
  isPickable,
} from "../state-machines/order.states.js";
import {
  EligibilityPolicy,
  createDefaultEligibilityPolicy,
  type Order,
  type Customer,
  type EligibilityResult,
} from "../policies/eligibility.policy.js";

export interface OrderRepository {
  findById(id: string): Promise<Order | null>;
  findByIds(ids: string[]): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus): Promise<void>;
  setHold(id: string, reason: string): Promise<void>;
  releaseHold(id: string): Promise<void>;
}

export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
}

export interface OrderServiceDeps {
  orderRepo: OrderRepository;
  customerRepo?: CustomerRepository;
  eligibilityPolicy?: EligibilityPolicy;
}

export class OrderService {
  private orderRepo: OrderRepository;
  private customerRepo?: CustomerRepository;
  private eligibilityPolicy: EligibilityPolicy;

  constructor(deps: OrderServiceDeps) {
    this.orderRepo = deps.orderRepo;
    this.customerRepo = deps.customerRepo;
    this.eligibilityPolicy =
      deps.eligibilityPolicy ?? createDefaultEligibilityPolicy();
  }

  /**
   * Check if an order is eligible for picking
   */
  async checkEligibility(orderId: string): Promise<EligibilityResult> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      return { eligible: false, reasons: [`Order ${orderId} not found`] };
    }

    let customer: Customer | undefined;
    if (this.customerRepo) {
      customer =
        (await this.customerRepo.findById(order.customerId)) ?? undefined;
    }

    return this.eligibilityPolicy.check(order, customer);
  }

  /**
   * Transition order to READY_TO_PICK
   */
  async markReadyToPick(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    assertTransition(order.status as OrderStatus, OrderStatus.READY_TO_PICK);
    await this.orderRepo.updateStatus(orderId, OrderStatus.READY_TO_PICK);
  }

  /**
   * Transition order to PICKING
   */
  async markPicking(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (!isPickable(order.status as OrderStatus)) {
      throw new OrderNotPickableError(orderId, order.status);
    }

    assertTransition(order.status as OrderStatus, OrderStatus.PICKING);
    await this.orderRepo.updateStatus(orderId, OrderStatus.PICKING);
  }

  /**
   * Transition order to PICKED
   */
  async markPicked(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    assertTransition(order.status as OrderStatus, OrderStatus.PICKED);
    await this.orderRepo.updateStatus(orderId, OrderStatus.PICKED);
  }

  /**
   * Place order on hold
   */
  async placeOnHold(orderId: string, reason: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    assertTransition(order.status as OrderStatus, OrderStatus.ON_HOLD);
    await this.orderRepo.setHold(orderId, reason);
  }

  /**
   * Release order from hold, returning to previous logical state
   */
  async releaseHold(orderId: string, targetStatus: OrderStatus): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (order.status !== OrderStatus.ON_HOLD) {
      throw new Error(`Order ${orderId} is not on hold`);
    }

    assertTransition(OrderStatus.ON_HOLD, targetStatus);
    await this.orderRepo.releaseHold(orderId);
    await this.orderRepo.updateStatus(orderId, targetStatus);
  }

  /**
   * Get multiple orders by IDs
   */
  async getOrders(orderIds: string[]): Promise<Order[]> {
    return this.orderRepo.findByIds(orderIds);
  }
}

export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotPickableError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly currentStatus: string,
  ) {
    super(`Order ${orderId} cannot be picked in status ${currentStatus}`);
    this.name = "OrderNotPickableError";
  }
}
