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
const LEGACY_BASELINE = "202607310002_repair_identity_sequences.sql";

try {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await client.connect();
  await client.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedResult = await client.query("select filename from schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.filename));
  if (!applied.size) {
    const existingSchema = await client.query(
      `
        select
          to_regclass('public.work_orders') is not null as has_work_orders,
          to_regclass('public.legacy_sync_outbox') is not null as has_legacy_sync_outbox,
          exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'work_orders'
              and column_name = 'department_code'
          ) as has_department_code
      `
    );
    const schema = existingSchema.rows[0];
    if (schema.has_work_orders) {
      if (!schema.has_legacy_sync_outbox || !schema.has_department_code) {
        throw new Error("Existing database schema is older than the migration baseline; apply missing legacy migrations before continuing");
      }
      const baselineFiles = files.filter((file) => file <= LEGACY_BASELINE);
      for (const file of baselineFiles) {
        await client.query(
          "insert into schema_migrations (filename) values ($1) on conflict (filename) do nothing",
          [file]
        );
        applied.add(file);
      }
      process.stdout.write(`Recorded ${baselineFiles.length} existing migrations as the legacy baseline.\n`);
    }
  }

  for (const file of files) {
    if (applied.has(file)) {
      process.stdout.write(`Skipping ${file}... already applied\n`);
      continue;
    }
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`Applying ${file}... `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      process.stdout.write("ok\n");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end().catch(() => undefined);
}
