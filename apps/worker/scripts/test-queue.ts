/**
 * Queue Test Script
 * Run with: npx tsx scripts/test-queue.ts
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from monorepo root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import { Redis } from "ioredis";
import {
  getConnection,
  enqueueCreatePickingTask,
  getWorkTaskQueueStats,
  closeQueues,
} from "@wms/queue";

async function main() {
  console.log("========================================");
  console.log("  Queue Test");
  console.log("========================================\n");

  // Test 1: Check Redis connection
  console.log("[1] Testing Redis connection...");
  try {
    const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    await redis.ping();
    console.log("    ✓ Redis connected\n");
    await redis.quit();
  } catch (error) {
    console.error("    ✗ Redis connection failed:", error);
    process.exit(1);
  }

  // Test 2: Get queue stats (before)
  console.log("[2] Queue stats (before):");
  const statsBefore = await getWorkTaskQueueStats();
  console.log(`    Waiting: ${statsBefore.waiting}`);
  console.log(`    Active: ${statsBefore.active}`);
  console.log(`    Completed: ${statsBefore.completed}`);
  console.log(`    Failed: ${statsBefore.failed}\n`);

  // Test 3: Enqueue a test job
  console.log("[3] Enqueueing test job...");
  const testJob = await enqueueCreatePickingTask({
    orderIds: ["test-order-001", "test-order-002"],
    idempotencyKey: `test-${Date.now()}`,
    priority: 5,
    notes: "Test job from queue test script",
  });
  console.log(`    ✓ Job enqueued: ${testJob.id}`);
  console.log(`    Name: ${testJob.name}\n`);

  // Test 4: Get queue stats (after)
  console.log("[4] Queue stats (after):");
  const statsAfter = await getWorkTaskQueueStats();
  console.log(`    Waiting: ${statsAfter.waiting}`);
  console.log(`    Active: ${statsAfter.active}\n`);

  // Cleanup
  await closeQueues();
  console.log("========================================");
  console.log("  Test complete");
  console.log("========================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
