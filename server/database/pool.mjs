import pg from "pg";
import { requiredEnv } from "../config/env.mjs";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: requiredEnv("DATABASE_URL")
});

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
