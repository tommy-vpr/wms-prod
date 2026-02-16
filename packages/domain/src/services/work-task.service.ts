/**
 * Work Task Service
 * Main orchestration service for work tasks (picking, packing, etc.)
 */

import type { DomainEvent } from "../events/domain-events.js";
import type {
  WorkTaskStatus,
  WorkTaskBlockReason,
} from "../state-machines/work-task.states.js";

// ============================================================================
// Types (matching Prisma schema)
// ============================================================================

export type WorkTaskType =
  | "PICKING"
  | "PACKING"
  | "SHIPPING"
  | "RECEIVING"
  | "PUTAWAY"
  | "CYCLE_COUNT"
  | "REPLENISHMENT"
  | "QC";

export type WorkTaskItemStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED"
  | "SHORT";

export type { WorkTaskStatus, WorkTaskBlockReason };

export interface WorkTask {
  id: string;
  taskNumber: string;
  type: WorkTaskType;
  status: WorkTaskStatus;
  priority: number;
  idempotencyKey: string | null;
  assignedTo: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  blockReason: WorkTaskBlockReason | null;
  blockedAt: Date | null;
  orderIds: string[];
  totalOrders: number;
  completedOrders: number;
  totalItems: number;
  completedItems: number;
  shortItems: number;
  skippedItems: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskItem {
  id: string;
  taskId: string;
  orderId: string | null;
  orderItemId: string | null;
  productVariantId: string | null;
  locationId: string | null;
  allocationId: string | null;
  sequence: number;
  quantityRequired: number;
  quantityCompleted: number;
  status: WorkTaskItemStatus;
  completedBy: string | null;
  completedAt: Date | null;
  shortReason: string | null;
  locationScanned: boolean;
  itemScanned: boolean;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface WorkTaskRepository {
  create(data: {
    taskNumber: string;
    type: WorkTaskType;
    orderIds: string[];
    totalOrders: number;
    totalItems: number;
    priority?: number;
    idempotencyKey?: string;
    notes?: string;
  }): Promise<WorkTask>;
  findById(id: string): Promise<WorkTask | null>;
  findByIdempotencyKey(key: string): Promise<WorkTask | null>;
  updateStatus(id: string, status: WorkTaskStatus): Promise<void>;
  assign(id: string, userId: string): Promise<void>;
  unassign(id: string): Promise<void>;
  block(id: string, reason: WorkTaskBlockReason): Promise<void>;
  unblock(id: string): Promise<void>;
  incrementProgress(
    id: string,
    field: "completedItems" | "shortItems" | "skippedItems" | "completedOrders",
  ): Promise<void>;
  generateTaskNumber(type: WorkTaskType): Promise<string>;
}

export interface TaskItemRepository {
  createMany(items: Omit<TaskItem, "id">[]): Promise<TaskItem[]>;
  findById(id: string): Promise<TaskItem | null>;
  findByTaskId(taskId: string): Promise<TaskItem[]>;
  findPendingByTaskId(taskId: string): Promise<TaskItem[]>;
  updateStatus(id: string, status: WorkTaskItemStatus): Promise<void>;
  complete(
    id: string,
    data: {
      quantityCompleted: number;
      completedBy: string;
      status?: WorkTaskItemStatus;
      shortReason?: string;
    },
  ): Promise<void>;
  markLocationScanned(id: string): Promise<void>;
  markItemScanned(id: string): Promise<void>;
  getNextItem(taskId: string): Promise<TaskItem | null>;
}

export interface TaskEventRepository {
  create(data: {
    taskId: string;
    eventType: string;
    userId?: string;
    taskItemId?: string;
    data?: unknown;
  }): Promise<unknown>;
}

export interface AllocationServiceInterface {
  allocateForOrders(orderIds: string[]): Promise<{
    success: boolean;
    allocations: Array<{
      id: string;
      orderId: string;
      orderItemId: string | null;
      productVariantId: string;
      locationId: string;
      quantity: number;
      lotNumber: string | null;
    }>;
    errors: Array<{ orderId: string; message: string }>;
  }>;
  releaseByOrderId(orderId: string): Promise<void>;
  markPicked(allocationId: string): Promise<void>;
}

export interface OrderServiceInterface {
  getOrders(orderIds: string[]): Promise<
    Array<{
      id: string;
      orderNumber: string;
      status: string;
      items: Array<{
        id: string;
        productVariantId: string | null; // Changed from string
        sku: string;
        quantity: number;
        matched?: boolean; // Added
      }>;
    }>
  >;
  updateStatus(orderId: string, status: string): Promise<void>;
}
// ============================================================================
// Service Dependencies
// ============================================================================

export interface WorkTaskServiceDeps {
  workTaskRepo: WorkTaskRepository;
  taskItemRepo: TaskItemRepository;
  taskEventRepo: TaskEventRepository;
  allocationService: AllocationServiceInterface;
  orderService: OrderServiceInterface;
  eventPublisher?: (event: DomainEvent) => Promise<void>;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CreatePickingTaskRequest {
  orderIds: string[];
  idempotencyKey: string;
  priority?: number;
  notes?: string;
}

export interface CreatePickingTaskResult {
  success: boolean;
  workTask?: WorkTask;
  taskItems?: TaskItem[];
  error?: string;
}

export interface RecordPickResult {
  complete: boolean;
  short: boolean;
  taskComplete: boolean;
}

// ============================================================================
// Work Task Service
// ============================================================================

export class WorkTaskService {
  private workTaskRepo: WorkTaskRepository;
  private taskItemRepo: TaskItemRepository;
  private taskEventRepo: TaskEventRepository;
  private allocationService: AllocationServiceInterface;
  private orderService: OrderServiceInterface;
  private eventPublisher?: (event: DomainEvent) => Promise<void>;

  constructor(deps: WorkTaskServiceDeps) {
    this.workTaskRepo = deps.workTaskRepo;
    this.taskItemRepo = deps.taskItemRepo;
    this.taskEventRepo = deps.taskEventRepo;
    this.allocationService = deps.allocationService;
    this.orderService = deps.orderService;
    this.eventPublisher = deps.eventPublisher;
  }

  /**
   * Create a picking task for one or more orders
   * This is the main workflow - call from a worker job
   */
  async createPickingTask(
    request: CreatePickingTaskRequest,
  ): Promise<CreatePickingTaskResult> {
    // Step 1: Idempotency check
    if (request.idempotencyKey) {
      const existing = await this.workTaskRepo.findByIdempotencyKey(
        request.idempotencyKey,
      );
      if (existing) {
        const items = await this.taskItemRepo.findByTaskId(existing.id);
        return { success: true, workTask: existing, taskItems: items };
      }
    }

    // Step 2: Get and validate orders
    const orders = await this.orderService.getOrders(request.orderIds);
    if (orders.length !== request.orderIds.length) {
      const foundIds = orders.map((o) => o.id);
      const missing = request.orderIds.filter((id) => !foundIds.includes(id));
      return {
        success: false,
        error: `Orders not found: ${missing.join(", ")}`,
      };
    }

    // Step 3: Allocate inventory
    const allocationResult = await this.allocationService.allocateForOrders(
      request.orderIds,
    );
    if (!allocationResult.success) {
      return {
        success: false,
        error: `Allocation failed: ${allocationResult.errors.map((e) => e.message).join(", ")}`,
      };
    }

    // Step 4: Create work task
    const taskNumber = await this.workTaskRepo.generateTaskNumber("PICKING");
    const workTask = await this.workTaskRepo.create({
      taskNumber,
      type: "PICKING",
      orderIds: request.orderIds,
      totalOrders: orders.length,
      totalItems: allocationResult.allocations.length,
      priority: request.priority ?? 0,
      idempotencyKey: request.idempotencyKey,
      notes: request.notes,
    });

    // Step 5: Create task items with optimized sequence
    const taskItems = await this.createTaskItems(
      workTask.id,
      allocationResult.allocations,
    );

    // Step 6: Record event
    await this.taskEventRepo.create({
      taskId: workTask.id,
      eventType: "TASK_CREATED",
      data: { orderIds: request.orderIds, itemCount: taskItems.length },
    });

    // Step 7: Update order statuses
    for (const orderId of request.orderIds) {
      await this.orderService.updateStatus(orderId, "ALLOCATED");
    }

    return { success: true, workTask, taskItems };
  }

  /**
   * Assign a work task to a user
   */
  async assign(taskId: string, userId: string): Promise<void> {
    const task = await this.workTaskRepo.findById(taskId);
    if (!task) throw new WorkTaskNotFoundError(taskId);
    if (task.status !== "PENDING") {
      throw new Error(`Cannot assign task in ${task.status} status`);
    }

    await this.workTaskRepo.assign(taskId, userId);
    await this.taskEventRepo.create({
      taskId,
      eventType: "TASK_ASSIGNED",
      userId,
    });
  }

  /**
   * Start working on a task
   */
  async start(taskId: string, userId: string): Promise<void> {
    const task = await this.workTaskRepo.findById(taskId);
    if (!task) throw new WorkTaskNotFoundError(taskId);
    if (task.status !== "ASSIGNED") {
      throw new Error(`Cannot start task in ${task.status} status`);
    }
    if (task.assignedTo !== userId) {
      throw new Error(`Task is assigned to another user`);
    }

    await this.workTaskRepo.updateStatus(taskId, "IN_PROGRESS");
    await this.taskEventRepo.create({
      taskId,
      eventType: "TASK_STARTED",
      userId,
    });
  }

  /**
   * Record completion of a task item
   */
  async recordItemCompletion(
    taskItemId: string,
    userId: string,
    actualQuantity: number,
  ): Promise<RecordPickResult> {
    const item = await this.taskItemRepo.findById(taskItemId);
    if (!item) throw new Error(`Task item ${taskItemId} not found`);

    const short = actualQuantity < item.quantityRequired;
    const status: WorkTaskItemStatus = short ? "SHORT" : "COMPLETED";

    await this.taskItemRepo.complete(taskItemId, {
      quantityCompleted: actualQuantity,
      completedBy: userId,
      status,
      shortReason: short ? "Insufficient quantity at location" : undefined,
    });

    // Update task progress
    if (short) {
      await this.workTaskRepo.incrementProgress(item.taskId, "shortItems");
    }
    await this.workTaskRepo.incrementProgress(item.taskId, "completedItems");

    // Mark allocation as picked
    if (item.allocationId) {
      await this.allocationService.markPicked(item.allocationId);
    }

    // Record event
    await this.taskEventRepo.create({
      taskId: item.taskId,
      eventType: short ? "ITEM_SHORT" : "ITEM_COMPLETED",
      userId,
      taskItemId,
      data: {
        quantityRequired: item.quantityRequired,
        quantityCompleted: actualQuantity,
      },
    });

    // Check if task is complete
    const pendingItems = await this.taskItemRepo.findPendingByTaskId(
      item.taskId,
    );
    const taskComplete = pendingItems.length === 0;

    if (taskComplete) {
      await this.complete(item.taskId, userId);
    }

    return { complete: !short, short, taskComplete };
  }

  /**
   * Skip a task item
   */
  async skipItem(
    taskItemId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    const item = await this.taskItemRepo.findById(taskItemId);
    if (!item) throw new Error(`Task item ${taskItemId} not found`);

    await this.taskItemRepo.complete(taskItemId, {
      quantityCompleted: 0,
      completedBy: userId,
      status: "SKIPPED",
      shortReason: reason,
    });

    await this.workTaskRepo.incrementProgress(item.taskId, "skippedItems");
    await this.taskEventRepo.create({
      taskId: item.taskId,
      eventType: "ITEM_SKIPPED",
      userId,
      taskItemId,
      data: { reason },
    });
  }

  /**
   * Block a work task
   */
  async block(
    taskId: string,
    reason: WorkTaskBlockReason,
    userId?: string,
  ): Promise<void> {
    const task = await this.workTaskRepo.findById(taskId);
    if (!task) throw new WorkTaskNotFoundError(taskId);
    if (task.status !== "IN_PROGRESS") {
      throw new Error(`Cannot block task in ${task.status} status`);
    }

    await this.workTaskRepo.block(taskId, reason);
    await this.taskEventRepo.create({
      taskId,
      eventType: "TASK_BLOCKED",
      userId,
      data: { reason },
    });
  }

  /**
   * Unblock a work task
   */
  async unblock(taskId: string, userId?: string): Promise<void> {
    const task = await this.workTaskRepo.findById(taskId);
    if (!task) throw new WorkTaskNotFoundError(taskId);
    if (task.status !== "BLOCKED") {
      throw new Error(`Task ${taskId} is not blocked`);
    }

    await this.workTaskRepo.unblock(taskId);
    await this.taskEventRepo.create({
      taskId,
      eventType: "TASK_UNBLOCKED",
      userId,
    });
  }

  /**
   * Complete a work task
   */
  async complete(taskId: string, userId?: string): Promise<void> {
    const task = await this.workTaskRepo.findById(taskId);
    if (!task) throw new WorkTaskNotFoundError(taskId);

    const pendingItems = await this.taskItemRepo.findPendingByTaskId(taskId);
    if (pendingItems.length > 0) {
      throw new Error(
        `Cannot complete task - ${pendingItems.length} items still pending`,
      );
    }

    await this.workTaskRepo.updateStatus(taskId, "COMPLETED");
    await this.taskEventRepo.create({
      taskId,
      eventType: "TASK_COMPLETED",
      userId,
    });

    // Update order statuses
    if (task.type === "PICKING") {
      for (const orderId of task.orderIds) {
        await this.orderService.updateStatus(orderId, "PICKED");
      }
    }
  }

  /**
   * Cancel a work task
   */
  async cancel(taskId: string, reason: string, userId?: string): Promise<void> {
    const task = await this.workTaskRepo.findById(taskId);
    if (!task) throw new WorkTaskNotFoundError(taskId);
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      throw new Error(`Cannot cancel task in ${task.status} status`);
    }

    // Release allocations
    for (const orderId of task.orderIds) {
      await this.allocationService.releaseByOrderId(orderId);
    }

    await this.workTaskRepo.updateStatus(taskId, "CANCELLED");
    await this.taskEventRepo.create({
      taskId,
      eventType: "TASK_CANCELLED",
      userId,
      data: { reason },
    });
  }

  /**
   * Get next item to pick for a task
   */
  async getNextItem(taskId: string): Promise<TaskItem | null> {
    return this.taskItemRepo.getNextItem(taskId);
  }

  /**
   * Verify location scan
   */
  async verifyLocationScan(
    taskItemId: string,
    scannedBarcode: string,
  ): Promise<boolean> {
    const item = await this.taskItemRepo.findById(taskItemId);
    if (!item) throw new Error(`Task item ${taskItemId} not found`);

    // In production, you'd verify the barcode matches the expected location
    // For now, just mark as scanned
    await this.taskItemRepo.markLocationScanned(taskItemId);
    return true;
  }

  /**
   * Verify item scan
   */
  async verifyItemScan(
    taskItemId: string,
    scannedBarcode: string,
  ): Promise<boolean> {
    const item = await this.taskItemRepo.findById(taskItemId);
    if (!item) throw new Error(`Task item ${taskItemId} not found`);

    // In production, verify barcode matches product variant
    await this.taskItemRepo.markItemScanned(taskItemId);
    return true;
  }

  /**
   * Create task items from allocations with optimized sequence
   */
  private async createTaskItems(
    taskId: string,
    allocations: Array<{
      id: string;
      orderId: string;
      orderItemId: string | null;
      productVariantId: string;
      locationId: string;
      quantity: number;
      lotNumber: string | null;
    }>,
  ): Promise<TaskItem[]> {
    // Sort by location for optimized pick path
    const sorted = [...allocations].sort((a, b) =>
      a.locationId.localeCompare(b.locationId),
    );

    const items = sorted.map((allocation, index) => ({
      taskId,
      orderId: allocation.orderId,
      orderItemId: allocation.orderItemId,
      productVariantId: allocation.productVariantId,
      locationId: allocation.locationId,
      allocationId: allocation.id,
      sequence: index + 1,
      quantityRequired: allocation.quantity,
      quantityCompleted: 0,
      status: "PENDING" as WorkTaskItemStatus,
      completedBy: null,
      completedAt: null,
      shortReason: null,
      locationScanned: false,
      itemScanned: false,
    }));

    return this.taskItemRepo.createMany(items);
  }
}

// ============================================================================
// Errors
// ============================================================================

export class WorkTaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Work task not found: ${taskId}`);
    this.name = "WorkTaskNotFoundError";
  }
}
