import pg from "pg";
import bcrypt from "bcryptjs";
import { createId } from "@paralleldrive/cuid2";

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME || "Super Admin";

  if (!databaseUrl) {
    console.error("❌ Missing DATABASE_URL");
    process.exit(1);
  }

  if (!email || !password) {
    console.error("❌ Missing SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD");
    console.log(
      "Usage: DATABASE_URL=... SUPER_ADMIN_EMAIL=you@email.com SUPER_ADMIN_PASSWORD=yourpass pnpm seed",
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Check if user exists
    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );

    if (existing.rows.length > 0) {
      console.log("ℹ️  Super admin already exists:", email);
      return;
    }

    // Create user with cuid
    const hashedPassword = await hashPassword(password);
    const id = createId();

    await client.query(
      `INSERT INTO users (id, email, password, name, role, active, "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', true, NOW(), NOW())`,
      [id, email, hashedPassword, name],
    );

    console.log("✅ Super admin created:", email);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
