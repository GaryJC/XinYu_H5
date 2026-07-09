import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = path.resolve("supabase/migrations");
const client = new Client({ connectionString: DATABASE_URL });

try {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await client.connect();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`Applying ${file}... `);
    await client.query(sql);
    process.stdout.write("ok\n");
  }
} finally {
  await client.end().catch(() => undefined);
}
