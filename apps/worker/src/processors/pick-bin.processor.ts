// apps/worker/src/processors/pick-bin.processor.ts

import { Job } from "bullmq";
import { prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { randomUUID } from "crypto";
import {
  PICK_BIN_JOBS,
  type PrintBinLabelJobData,
  type NotifyPackStationJobData,
  type HandleShortPickJobData,
  type RecordPickMetricsJobData,
} from "@wms/queue";

export async function processPickBinJob(job: Job): Promise<unknown> {
  console.log(`[PickBin] Processing: ${job.name} (${job.id})`);

  switch (job.name) {
    case PICK_BIN_JOBS.PRINT_LABEL:
      return processPrintLabel(job as Job<PrintBinLabelJobData>);

    case PICK_BIN_JOBS.NOTIFY_PACK_STATION:
      return processNotifyPackStation(job as Job<NotifyPackStationJobData>);

    case PICK_BIN_JOBS.HANDLE_SHORT_PICK:
      return processShortPick(job as Job<HandleShortPickJobData>);

    case PICK_BIN_JOBS.RECORD_METRICS:
      return processRecordMetrics(job as Job<RecordPickMetricsJobData>);

    default:
      throw new Error(`Unknown job: ${job.name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Print Bin Label
// ─────────────────────────────────────────────────────────────────────────────

async function processPrintLabel(job: Job<PrintBinLabelJobData>) {
  const {
    binId,
    binNumber,
    barcode,
    orderNumber,
    itemCount,
    totalQuantity,
    printerId,
    copies = 1,
  } = job.data;

  console.log(`[PickBin] Printing label for ${binNumber}`);

  // Generate ZPL for Zebra printer (4x6 label)
  const zpl = `
^XA
^FO50,30^A0N,50,50^FD${binNumber}^FS
^FO50,100^A0N,30,30^FDOrder: ${orderNumber}^FS
^FO50,145^A0N,25,25^FD${itemCount} SKUs / ${totalQuantity} units^FS
^FO50,200^BY3
^BCN,100,Y,N,N
^FD${barcode}^FS
^FO50,340^A0N,20,20^FD${new Date().toLocaleString()}^FS
^XZ
`.trim();

  // Update bin with label ZPL
  await prisma.pickBin.update({
    where: { id: binId },
    data: {
      labelZpl: zpl,
      labelPrintedAt: printerId ? new Date() : null,
    },
  });

  // If printer specified, send to network printer
  if (printerId) {
    // Implementation depends on your printer setup
    // await sendToPrinter(printerId, zpl, copies);
    console.log(`[PickBin] Sent to printer ${printerId}`);
  }

  // Publish event for UI feedback
  await publish({
    id: randomUUID(),
    type: EVENT_TYPES.PICKBIN_LABEL_PRINTED,
    orderId: job.data.orderId,
    payload: {
      binId,
      binNumber,
      barcode,
      printed: !!printerId,
    },
    timestamp: new Date().toISOString(),
  });

  return { binId, printed: !!printerId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notify Pack Station
// ─────────────────────────────────────────────────────────────────────────────

async function processNotifyPackStation(job: Job<NotifyPackStationJobData>) {
  const {
    binId,
    binNumber,
    orderId,
    orderNumber,
    priority,
    itemCount,
    totalQuantity,
  } = job.data;

  console.log(`[PickBin] Notifying pack station: ${binNumber}`);

  // Publish real-time notification to pack station screens
  await publish({
    id: randomUUID(),
    type: EVENT_TYPES.PACKSTATION_BIN_READY,
    orderId,
    payload: {
      binId,
      binNumber,
      orderNumber,
      priority,
      itemCount,
      totalQuantity,
      stagedAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });

  // Could also send push notification, Slack message, etc.
  // if (priority === "EXPRESS" || priority === "RUSH") {
  //   await sendSlackNotification(`🚨 Priority bin ${binNumber} ready for packing`);
  // }

  return { notified: true, binNumber };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle Short Pick
// ─────────────────────────────────────────────────────────────────────────────

async function processShortPick(job: Job<HandleShortPickJobData>) {
  const {
    taskItemId,
    orderId,
    orderNumber,
    productVariantId,
    sku,
    locationId,
    locationName,
    expectedQty,
    actualQty,
    userId,
    reason,
  } = job.data;

  const shortage = expectedQty - actualQty;
  console.log(
    `[PickBin] Short pick: ${sku} at ${locationName}, ${shortage} short`,
  );

  // 1. Create inventory discrepancy record
  await prisma.inventoryDiscrepancy.create({
    data: {
      type: "SHORT_PICK",
      productVariantId,
      locationId,
      expectedQty,
      actualQty,
      variance: -shortage,
      orderId,
      taskItemId,
      reportedBy: userId,
      status: "PENDING_REVIEW",
      notes:
        reason ||
        `Short pick during fulfillment: expected ${expectedQty}, found ${actualQty}`,
    },
  });

  // 2. Check if location needs cycle count (3+ shorts in 7 days)
  const recentShorts = await prisma.inventoryDiscrepancy.count({
    where: {
      locationId,
      type: "SHORT_PICK",
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  let cycleCountFlagged = false;
  if (recentShorts >= 3) {
    await prisma.location.update({
      where: { id: locationId },
      data: {
        needsCycleCount: true,
        cycleCountPriority: "HIGH",
        cycleCountReason: `${recentShorts} short picks in 7 days`,
      },
    });
    cycleCountFlagged = true;
    console.log(`[PickBin] Location ${locationName} flagged for cycle count`);
  }

  // 3. Publish event for real-time dashboard
  await publish({
    id: randomUUID(),
    type: EVENT_TYPES.SHORT_PICK_DETECTED,
    orderId,
    payload: {
      taskItemId,
      orderNumber,
      sku,
      locationName,
      expectedQty,
      actualQty,
      shortage,
      cycleCountFlagged,
      reportedBy: userId,
    },
    timestamp: new Date().toISOString(),
  });

  return { discrepancyCreated: true, cycleCountFlagged, shortage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Pick Metrics
// ─────────────────────────────────────────────────────────────────────────────

async function processRecordMetrics(job: Job<RecordPickMetricsJobData>) {
  const {
    taskId,
    taskNumber,
    orderId,
    orderNumber,
    userId,
    itemCount,
    startedAt,
    completedAt,
    shortCount,
  } = job.data;

  const start = new Date(startedAt);
  const end = new Date(completedAt);
  const durationMs = end.getTime() - start.getTime();
  const durationSeconds = Math.round(durationMs / 1000);
  const itemsPerMinute = itemCount / (durationMs / 1000 / 60);

  console.log(
    `[PickBin] Metrics: ${itemCount} items in ${(durationSeconds / 60).toFixed(1)}min = ${itemsPerMinute.toFixed(1)} items/min`,
  );

  // Record metric
  await prisma.fulfillmentMetric.create({
    data: {
      type: "PICKING",
      taskId,
      taskNumber,
      orderId,
      orderNumber,
      userId,
      itemCount,
      shortCount,
      startedAt: start,
      completedAt: end,
      durationSeconds,
      itemsPerMinute: Math.round(itemsPerMinute * 100) / 100,
    },
  });

  // Update user's rolling performance stats
  if (userId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const stats = await prisma.fulfillmentMetric.aggregate({
      where: { userId, type: "PICKING", createdAt: { gte: thirtyDaysAgo } },
      _avg: { itemsPerMinute: true, durationSeconds: true },
      _sum: { itemCount: true, shortCount: true },
      _count: true,
    });

    await prisma.userPerformance.upsert({
      where: { userId_metricType: { userId, metricType: "PICKING" } },
      update: {
        avgItemsPerMinute: stats._avg.itemsPerMinute ?? 0,
        totalItems: stats._sum.itemCount ?? 0,
        totalShorts: stats._sum.shortCount ?? 0,
        taskCount: stats._count,
        updatedAt: new Date(),
      },
      create: {
        userId,
        metricType: "PICKING",
        avgItemsPerMinute: stats._avg.itemsPerMinute ?? 0,
        totalItems: stats._sum.itemCount ?? 0,
        totalShorts: stats._sum.shortCount ?? 0,
        taskCount: stats._count,
      },
    });
  }

  return {
    recorded: true,
    itemsPerMinute: Math.round(itemsPerMinute * 100) / 100,
  };
}
