// apps/worker/src/index.ts

import "dotenv/config";
import { Worker, type Job } from "bullmq";
import {
  getConnection,
  QUEUES,
  WORK_TASK_JOBS,
  SHOPIFY_JOBS,
  ORDER_JOBS,
  PRODUCT_JOBS,
  INVENTORY_PLANNER_JOBS,
  CYCLE_COUNT_JOBS,
  PACKING_IMAGE_JOBS,
  PICK_BIN_JOBS, // ← Add this import
} from "@wms/queue";
import {
  processWorkTaskJob,
  processShopifyJob,
  processOrderJob,
  processProductJob,
  processInventoryPlannerJob,
  processCycleCountJob,
  processShippingJob,
  processPackingImageJob,
  processPickBinJob,
} from "./processors/index.js";

// ============================================================================
// Configuration
// ============================================================================

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "5", 10);

// ============================================================================
// Worker Setup
// ============================================================================

function createPickBinWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.PICK_BIN,
    async (job: Job) => processPickBinJob(job),
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 500, age: 24 * 60 * 60 },
      removeOnFail: { count: 1000, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.PICK_BIN} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[PickBin] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[PickBin] Job failed: ${job?.name}`, err.message);
  });

  return worker;
}

function createWorkTaskWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.WORK_TASKS,
    async (job: Job) => {
      return processWorkTaskJob(job);
    },
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
      removeOnComplete: {
        count: 1000,
        age: 24 * 60 * 60,
      },
      removeOnFail: {
        count: 5000,
        age: 7 * 24 * 60 * 60,
      },
    },
  );

  worker.on("ready", () => {
    console.log(`[Worker] ${QUEUES.WORK_TASKS} worker ready`);
  });

  worker.on("completed", (job, result) => {
    console.log(`[Worker] Job completed: ${job.name} (${job.id})`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[Worker] Job failed: ${job?.name} (${job?.id})`,
      err.message,
    );
  });

  worker.on("error", (err) => {
    console.error("[Worker] Worker error:", err);
  });

  return worker;
}

function createCycleCountWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.CYCLE_COUNT,
    async (job: Job) => processCycleCountJob(job),
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 500, age: 24 * 60 * 60 },
      removeOnFail: { count: 2000, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.CYCLE_COUNT} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[CycleCount] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[CycleCount] Job failed: ${job?.name}`, err.message);
  });

  return worker;
}

function createShopifyWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.SHOPIFY,
    async (job: Job) => processShopifyJob(job),
    {
      connection,
      concurrency: 3,
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.SHOPIFY} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[Shopify] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[Shopify] Job failed: ${job?.name}`, err.message);
  });

  return worker;
}

function createOrdersWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.ORDERS,
    async (job: Job) => processOrderJob(job),
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.ORDERS} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[Orders] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[Orders] Job failed: ${job?.name}`, err.message);
  });

  return worker;
}

function createProductsWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.PRODUCTS,
    async (job: Job) => processProductJob(job),
    {
      connection,
      concurrency: 3,
      removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
      removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.PRODUCTS} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[Products] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[Products] Job failed: ${job?.name}`, err.message);
  });
  worker.on("progress", (job, progress) => {
    console.log(`[Products] Job progress: ${job.name} - ${progress}%`);
  });

  return worker;
}

function createInventoryPlannerWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.INVENTORY_PLANNER,
    async (job: Job) => processInventoryPlannerJob(job),
    {
      connection,
      concurrency: 1,
      removeOnComplete: { count: 100, age: 24 * 60 * 60 },
      removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.INVENTORY_PLANNER} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[IP Sync] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[IP Sync] Job failed: ${job?.name}`, err.message);
  });
  worker.on("progress", (job, progress) => {
    console.log(`[IP Sync] Job progress: ${job.name} - ${progress}%`);
  });

  return worker;
}

function createPackingImageWorker() {
  const connection = getConnection();

  const worker = new Worker(
    QUEUES.PACKING_IMAGES,
    async (job: Job) => processPackingImageJob(job),
    {
      connection,
      concurrency: 3,
      removeOnComplete: { count: 500, age: 24 * 60 * 60 },
      removeOnFail: { count: 1000, age: 7 * 24 * 60 * 60 },
    },
  );

  worker.on("ready", () =>
    console.log(`[Worker] ${QUEUES.PACKING_IMAGES} worker ready`),
  );
  worker.on("completed", (job, result) => {
    console.log(`[PackingImage] Job completed: ${job.name}`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[PackingImage] Job failed: ${job?.name}`, err.message);
  });
  worker.on("progress", (job, progress) => {
    console.log(`[PackingImage] Job progress: ${job.name} - ${progress}%`);
  });

  return worker;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(workers: Worker[]) {
  console.log("\n[Worker] Shutting down...");

  await Promise.all(workers.map((w) => w.close()));
  console.log("[Worker] All workers closed");

  process.exit(0);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("========================================");
  console.log("  WMS Worker Starting");
  console.log("========================================");
  console.log(
    `[Config] Redis: ${process.env.REDIS_URL || "redis://localhost:6379"}`,
  );
  console.log(`[Config] Concurrency: ${WORKER_CONCURRENCY}`);
  console.log("");

  // Create workers
  const workers: Worker[] = [];

  // Work Tasks Worker
  const workTaskWorker = createWorkTaskWorker();
  workers.push(workTaskWorker);

  // Shopify Worker
  const shopifyWorker = createShopifyWorker();
  workers.push(shopifyWorker);

  // Orders Worker
  const ordersWorker = createOrdersWorker();
  workers.push(ordersWorker);

  // Products Worker
  const productsWorker = createProductsWorker();
  workers.push(productsWorker);

  // Inventory Planner Worker
  const inventoryPlannerWorker = createInventoryPlannerWorker();
  workers.push(inventoryPlannerWorker);

  // Cycle Count Worker
  const cycleCountWorker = createCycleCountWorker();
  workers.push(cycleCountWorker);

  // Packing Image Worker
  const packingImageWorker = createPackingImageWorker();
  workers.push(packingImageWorker);

  // Pick Bin Worker
  const pickBinWorker = createPickBinWorker();
  workers.push(pickBinWorker);

  // Register shutdown handlers
  process.on("SIGTERM", () => shutdown(workers));
  process.on("SIGINT", () => shutdown(workers));

  console.log("[Worker] Workers started, waiting for jobs...");
  console.log("");
  console.log("Available job types:");
  Object.values(WORK_TASK_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.WORK_TASKS}:${job}`);
  });
  Object.values(SHOPIFY_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.SHOPIFY}:${job}`);
  });
  Object.values(ORDER_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.ORDERS}:${job}`);
  });
  Object.values(PRODUCT_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.PRODUCTS}:${job}`);
  });
  Object.values(INVENTORY_PLANNER_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.INVENTORY_PLANNER}:${job}`);
  });
  Object.values(CYCLE_COUNT_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.CYCLE_COUNT}:${job}`);
  });
  Object.values(PACKING_IMAGE_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.PACKING_IMAGES}:${job}`);
  });
  Object.values(PICK_BIN_JOBS).forEach((job) => {
    console.log(`  - ${QUEUES.PICK_BIN}:${job}`);
  });
  console.log("");
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
