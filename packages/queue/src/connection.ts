import type { ConnectionOptions } from "bullmq";

export function getConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL || "redis://localhost:6379";

  // Parse URL for BullMQ
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
