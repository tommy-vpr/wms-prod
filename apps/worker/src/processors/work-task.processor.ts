/**
 * Work Task Processor
 * Handles BullMQ jobs for work task operations
 */

import { Job } from "bullmq";
import { WorkTaskService, type WorkTaskServiceDeps } from "@wms/domain";
import {
  prisma,
  workTaskRepository,
  taskItemRepository,
  taskEventRepository,
  allocationRepository,
  inventoryRepository,
  orderRepository,
} from "@wms/db";
import {
  WORK_TASK_JOBS,
  type CreatePickingTaskJobData,
  type AssignTaskJobData,
  type StartTaskJobData,
  type CompleteTaskJobData,
  type CancelTaskJobData,
  type WorkTaskJobData,
} from "@wms/queue";

// ============================================================================
// Service Factory
// ============================================================================

/**
 * Creates a WorkTaskService instance with all dependencies wired up
 */
function createWorkTaskService(): WorkTaskService {
  // Create a simple allocation service adapter
  const allocationService = {
    async allocateForOrders(orderIds: string[]) {
      // Get orders with items
      const orders = await orderRepository.findByIds(orderIds);
      const allocations: Array<{
        id: string;
        orderId: string;
        orderItemId: string | null;
        productVariantId: string;
        locationId: string;
        quantity: number;
        lotNumber: string | null;
      }> = [];
      const errors: Array<{ orderId: string; message: string }> = [];

      for (const order of orders) {
        for (const item of order.items) {
          // Skip unmatched items (no productVariantId)
          if (!item.productVariantId) {
            console.log(`[Worker] Skipping unmatched item: ${item.sku}`);
            continue;
          }

          // Find available inventory for this product variant
          const available =
            await inventoryRepository.findAvailableByProductVariant(
              item.productVariantId,
            );

          let remainingQty = item.quantity;

          for (const inv of available) {
            if (remainingQty <= 0) break;

            const allocateQty = Math.min(inv.quantity, remainingQty);

            // Create allocation record
            const allocation = await allocationRepository.create({
              inventoryUnitId: inv.id,
              orderId: order.id,
              orderItemId: item.id,
              productVariantId: item.productVariantId,
              locationId: inv.location.id,
              quantity: allocateQty,
              lotNumber: inv.lotNumber,
              status: "ALLOCATED",
              taskItemId: null,
            });

            // Update inventory status
            await inventoryRepository.updateStatus(inv.id, "RESERVED");

            // Update order item allocated quantity
            await orderRepository.incrementItemAllocated(item.id, allocateQty);

            allocations.push({
              id: allocation.id,
              orderId: order.id,
              orderItemId: item.id,
              productVariantId: item.productVariantId,
              locationId: inv.location.id,
              quantity: allocateQty,
              lotNumber: inv.lotNumber,
            });

            remainingQty -= allocateQty;
          }

          if (remainingQty > 0) {
            errors.push({
              orderId: order.id,
              message: `Insufficient inventory for ${item.sku}: need ${item.quantity}, available ${item.quantity - remainingQty}`,
            });
          }
        }
      }

      // If any errors, we should rollback (simplified - in production use transaction)
      if (errors.length > 0) {
        // Release all allocations we just made
        for (const allocation of allocations) {
          await allocationRepository.updateStatus(allocation.id, "RELEASED");
        }
        return { success: false, allocations: [], errors };
      }

      return { success: true, allocations, errors: [] };
    },

    async releaseByOrderId(orderId: string) {
      const allocations = await allocationRepository.findByOrderId(orderId);
      for (const allocation of allocations) {
        if (allocation.status === "ALLOCATED") {
          await inventoryRepository.updateStatus(
            allocation.inventoryUnitId,
            "AVAILABLE",
          );
          await allocationRepository.updateStatus(allocation.id, "RELEASED");
        }
      }
    },

    async markPicked(allocationId: string) {
      await allocationRepository.updateStatus(allocationId, "PICKED");
    },
  };

  // Create a simple order service adapter

  const orderService = {
    async getOrders(orderIds: string[]) {
      const orders = await orderRepository.findByIds(orderIds);
      return orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status as string,
        items: o.items.map((i) => ({
          id: i.id,
          productVariantId: i.productVariantId,
          sku: i.sku,
          quantity: i.quantity,
          matched: i.matched,
        })),
      }));
    },

    async updateStatus(orderId: string, status: string) {
      await orderRepository.updateStatus(orderId, status as any);
    },
  };

  const deps: WorkTaskServiceDeps = {
    workTaskRepo: workTaskRepository,
    taskItemRepo: taskItemRepository,
    taskEventRepo: taskEventRepository,
    allocationService,
    orderService,
    eventPublisher: async (event) => {
      // TODO: Publish to Ably or other event bus
      console.log("[Event]", event.type, event.payload);
    },
  };

  return new WorkTaskService(deps);
}

// Singleton service instance
let workTaskService: WorkTaskService | null = null;

function getWorkTaskService(): WorkTaskService {
  if (!workTaskService) {
    workTaskService = createWorkTaskService();
  }
  return workTaskService;
}

// ============================================================================
// Job Processors
// ============================================================================

/**
 * Process create-picking-task jobs
 */
async function processCreatePickingTask(job: Job<CreatePickingTaskJobData>) {
  const { orderIds, idempotencyKey, priority, notes } = job.data;

  console.log(
    `[Worker] Creating picking task for orders: ${orderIds.join(", ")}`,
  );

  const service = getWorkTaskService();
  const result = await service.createPickingTask({
    orderIds,
    idempotencyKey,
    priority,
    notes,
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  console.log(`[Worker] Created task: ${result.workTask?.taskNumber}`);

  return {
    taskId: result.workTask?.id,
    taskNumber: result.workTask?.taskNumber,
    itemCount: result.taskItems?.length,
  };
}

/**
 * Process assign-task jobs
 */
async function processAssignTask(job: Job<AssignTaskJobData>) {
  const { taskId, userId } = job.data;

  console.log(`[Worker] Assigning task ${taskId} to user ${userId}`);

  const service = getWorkTaskService();
  await service.assign(taskId, userId);

  return { taskId, userId, assigned: true };
}

/**
 * Process start-task jobs
 */
async function processStartTask(job: Job<StartTaskJobData>) {
  const { taskId, userId } = job.data;

  console.log(`[Worker] Starting task ${taskId}`);

  const service = getWorkTaskService();
  await service.start(taskId, userId);

  return { taskId, started: true };
}

/**
 * Process complete-task jobs (force complete)
 */
async function processCompleteTask(job: Job<CompleteTaskJobData>) {
  const { taskId, userId } = job.data;

  console.log(`[Worker] Completing task ${taskId}`);

  const service = getWorkTaskService();
  await service.complete(taskId, userId);

  return { taskId, completed: true };
}

/**
 * Process cancel-task jobs
 */
async function processCancelTask(job: Job<CancelTaskJobData>) {
  const { taskId, reason, userId } = job.data;

  console.log(`[Worker] Cancelling task ${taskId}: ${reason}`);

  const service = getWorkTaskService();
  await service.cancel(taskId, reason, userId);

  return { taskId, cancelled: true };
}

// ============================================================================
// Main Processor
// ============================================================================

/**
 * Main processor function for work task queue
 */
export async function processWorkTaskJob(
  job: Job<WorkTaskJobData>,
): Promise<unknown> {
  console.log(`[Worker] Processing job: ${job.name} (${job.id})`);

  try {
    switch (job.name) {
      case WORK_TASK_JOBS.CREATE_PICKING_TASK:
        return await processCreatePickingTask(
          job as Job<CreatePickingTaskJobData>,
        );

      case WORK_TASK_JOBS.ASSIGN_TASK:
        return await processAssignTask(job as Job<AssignTaskJobData>);

      case WORK_TASK_JOBS.START_TASK:
        return await processStartTask(job as Job<StartTaskJobData>);

      case WORK_TASK_JOBS.COMPLETE_TASK:
        return await processCompleteTask(job as Job<CompleteTaskJobData>);

      case WORK_TASK_JOBS.CANCEL_TASK:
        return await processCancelTask(job as Job<CancelTaskJobData>);

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  } catch (error) {
    console.error(`[Worker] Job failed: ${job.name}`, error);
    throw error;
  }
}
