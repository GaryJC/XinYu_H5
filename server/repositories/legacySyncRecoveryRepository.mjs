import { pool } from "../database/pool.mjs";

export async function requeueTimedOutLegacySyncEvents() {
  const { rows } = await pool.query("select requeue_timed_out_legacy_sync_events() as count");
  return Number(rows[0].count);
}
