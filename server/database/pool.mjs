import pg from "pg";
import {measureStage} from "../http/requestTiming.mjs";
import { requiredEnv } from "../config/env.mjs";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: requiredEnv("DATABASE_URL"),
  connectionTimeoutMillis: 5000
});

pool.on("error", error => console.error("[database-idle-error]", {code:error.code}));

export async function transaction(callback, {interactive=true}={}) {
  const client = await measureStage("db_wait",()=>pool.connect());
  let failedRollback;
  try {
    await client.query("begin");
    if(interactive)await client.query("set local lock_timeout = '3s'; set local statement_timeout = '15s'");
    const result = await measureStage("db_transaction",()=>callback(client));
    await client.query("commit");
    return result;
  } catch (error) {
    try {await client.query("rollback");} catch(rollbackError) {failedRollback=rollbackError;console.error("[database-rollback-error]", {code:rollbackError.code});}
    throw error;
  } finally {
    client.release(failedRollback);
  }
}

export async function closePool() {
  await pool.end();
}
