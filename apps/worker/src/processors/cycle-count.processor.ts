/**
 * Cycle Count Processor
 *
 * Save to: apps/worker/src/processors/cycle-count.processor.ts
 */

import { Job } from "bullmq";
import { CYCLE_COUNT_JOBS } from "@wms/queue";
import { prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { randomUUID } from "crypto";

export async function processCycleCountJob(job: Job): Promise<unknown> {
  console.log(`[CycleCount] Processing ${job.name}`, { id: job.id });

  switch (job.name) {
    case CYCLE_COUNT_JOBS.PROCESS_APPROVAL:
      return processApproval(job);
    case CYCLE_COUNT_JOBS.GENERATE_TASKS:
      return generateTasks(job);
    case CYCLE_COUNT_JOBS.NOTIFY_REVIEWERS:
      return notifyReviewers(job);
    case CYCLE_COUNT_JOBS.GENERATE_VARIANCE_REPORT:
      return generateVarianceReport(job);
    default:
      throw new Error(`Unknown cycle count job: ${job.name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function processApproval(job: Job) {
  const { sessionId, approvedById } = job.data;

  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    include: {
      lineItems: { include: { inventoryUnit: true } },
      location: true,
    },
  });

  if (!session) throw new Error("Session not found");
  if (session.status !== "SUBMITTED") {
    throw new Error("Session is not submitted");
  }

  let adjustmentsCreated = 0;

  await prisma.$transaction(async (tx) => {
    for (const line of session.lineItems) {
      if (line.variance === 0 || line.variance === null) continue;

      const year = new Date().getFullYear();
      const count = await tx.inventoryAdjustment.count({
        where: { adjustmentNumber: { startsWith: `ADJ-${year}` } },
      });
      const adjustmentNumber = `ADJ-${year}-${String(count + 1).padStart(5, "0")}`;

      await tx.inventoryAdjustment.create({
        data: {
          adjustmentNumber,
          reason: "CYCLE_COUNT",
          sourceType: "CYCLE_COUNT",
          sourceId: sessionId,
          productVariantId: line.productVariantId,
          locationId: session.locationId,
          inventoryUnitId: line.inventoryUnitId,
          previousQty: line.systemQty,
          adjustedQty: line.countedQty!,
          changeQty: line.variance!,
          lotNumber: line.lotNumber,
          status: "APPROVED",
          createdById: approvedById,
          approvedById: approvedById,
          approvedAt: new Date(),
        },
      });

      // Update inventory
      if (line.inventoryUnitId) {
        await tx.inventoryUnit.update({
          where: { id: line.inventoryUnitId },
          data: { quantity: line.countedQty! },
        });
      } else if (line.isUnexpected && line.countedQty! > 0) {
        await tx.inventoryUnit.create({
          data: {
            productVariantId: line.productVariantId,
            locationId: session.locationId,
            quantity: line.countedQty!,
            lotNumber: line.lotNumber,
            expiryDate: line.expiryDate,
            status: "AVAILABLE",
          },
        });
      }

      adjustmentsCreated++;
    }

    await tx.cycleCountSession.update({
      where: { id: sessionId },
      data: {
        status: "APPROVED",
        reviewedById: approvedById,
        reviewedAt: new Date(),
      },
    });

    // Update parent task if all sessions complete
    if (session.taskId) {
      const pending = await tx.cycleCountSession.count({
        where: {
          taskId: session.taskId,
          status: { in: ["IN_PROGRESS", "SUBMITTED"] },
        },
      });

      if (pending === 0) {
        await tx.cycleCountTask.update({
          where: { id: session.taskId },
          data: { status: "COMPLETED" },
        });
      }
    }

    await tx.cycleCountAudit.create({
      data: {
        sessionId,
        action: "APPROVED",
        userId: approvedById,
        data: { adjustmentsCreated },
      },
    });
  });

  // Emit event
  try {
    await publish({
      id: randomUUID(),
      type: EVENT_TYPES.CYCLE_COUNT_APPROVED as any,
      payload: {
        sessionId,
        locationId: session.locationId,
        locationName: session.location.name,
        adjustmentsCreated,
      },
      userId: approvedById,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[CycleCount] Failed to publish event:", err);
  }

  return { adjustmentsCreated };
}

async function generateTasks(job: Job) {
  const { type, criteria, assignToId, createdById } = job.data;

  let locationIds: string[] = [];

  if (type === "ZONE" && criteria.zone) {
    // zone is a string field, not a relation
    const locations = await prisma.location.findMany({
      where: { zone: criteria.zone },
      select: { id: true },
      take: criteria.maxLocations || 50,
    });
    locationIds = locations.map((l) => l.id);
  } else if (type === "ABC" && criteria.abcClass) {
    // ProductVariant doesn't have abcClass - skip or implement differently
    // Option 1: Skip ABC logic for now
    console.log(
      "[CycleCount] ABC class not supported - ProductVariant has no abcClass field",
    );
    return { tasksCreated: 0, message: "ABC classification not configured" };

    // Option 2: If you want ABC, you'd need to add it to ProductVariant schema:
    // abcClass String? // A, B, C
  } else if (type === "DAYS_SINCE_COUNT" && criteria.daysSinceCount) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - criteria.daysSinceCount);

    const recentlyCounted = await prisma.cycleCountSession.findMany({
      where: { createdAt: { gte: cutoff }, status: "APPROVED" },
      select: { locationId: true },
      distinct: ["locationId"],
    });

    const excludeIds = recentlyCounted.map((s) => s.locationId);

    const locations = await prisma.location.findMany({
      where: {
        id: { notIn: excludeIds },
        type: "STORAGE",
      },
      select: { id: true },
      take: criteria.maxLocations || 50,
    });
    locationIds = locations.map((l) => l.id);
  }

  if (locationIds.length === 0) {
    return { tasksCreated: 0, message: "No locations matched criteria" };
  }

  const year = new Date().getFullYear();
  const count = await prisma.cycleCountTask.count({
    where: { taskNumber: { startsWith: `CC-${year}` } },
  });
  const taskNumber = `CC-${year}-${String(count + 1).padStart(4, "0")}`;

  const task = await prisma.cycleCountTask.create({
    data: {
      taskNumber,
      name: `Auto-generated ${type} count`,
      type: type === "ZONE" ? "ZONE" : type === "ABC" ? "ABC" : "LOCATION",
      locationIds,
      zoneId: criteria.zone, // Store the zone string
      abcClass: criteria.abcClass,
      assignedToId: assignToId,
      createdById,
      status: "PENDING",
    },
  });

  return {
    tasksCreated: 1,
    taskId: task.id,
    locationCount: locationIds.length,
  };
}
async function notifyReviewers(job: Job) {
  const { sessionId, locationName, countedByName, varianceCount } = job.data;

  // TODO: Implement notification logic (email, Slack, etc.)
  console.log(
    `[CycleCount] Notify: ${locationName} counted by ${countedByName}, ${varianceCount} variances`,
  );

  return { notified: true };
}

async function generateVarianceReport(job: Job) {
  const { sessionId, format, emailTo } = job.data;

  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    include: {
      lineItems: true,
      location: true,
      countedBy: true,
      reviewedBy: true,
    },
  });

  if (!session) throw new Error("Session not found");

  // TODO: Implement PDF/CSV generation
  console.log(`[CycleCount] Generate ${format} report for ${sessionId}`);

  return { generated: true, format };
}
