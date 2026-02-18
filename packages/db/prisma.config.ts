import dotenv from "dotenv";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Load .env from monorepo root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"), // Use DIRECT_URL for migrations
  },
});
