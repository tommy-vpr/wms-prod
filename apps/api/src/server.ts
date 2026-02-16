import "dotenv/config"; // MUST be first

import { buildApp } from "./app.js";

console.log("ENV CHECK:", {
  DATABASE_URL: process.env.DATABASE_URL ? "✓" : "✗",
  REDIS_URL: process.env.REDIS_URL ? "✓" : "✗",
  JWT_SECRET: process.env.JWT_SECRET ? "✓" : "✗",
  NODE_ENV: process.env.NODE_ENV || "development",
});

async function start() {
  const app = await buildApp();
  const port = Number(process.env.PORT) || 3000;

  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 Server running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
