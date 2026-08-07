import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const consumerId = `codex-batch-verification-${Date.now()}`;
let transactionStarted = false;

try {
  await client.connect();
  await client.query("begin");
  transactionStarted = true;

  const roleResult = await client.query(
    "select exists (select 1 from pg_roles where rolname = 'runfeng_sync') as exists"
  );
  const createdTemporaryRole = !roleResult.rows[0].exists;
  if (createdTemporaryRole) {
    const currentUserResult = await client.query("select current_user as name");
    const quotedCurrentUser = `"${currentUserResult.rows[0].name.replaceAll('"', '""')}"`;
    await client.query("create role runfeng_sync");
    await client.query(`grant runfeng_sync to ${quotedCurrentUser}`);
    await client.query("grant usage on schema public to runfeng_sync");
    await client.query(
      "grant execute on function acknowledge_legacy_sync_events(text, jsonb) to runfeng_sync"
    );
    await client.query(
      "grant execute on function fail_legacy_sync_events(text, jsonb) to runfeng_sync"
    );
  }

  const ordersResult = await client.query(`
    select id
    from work_orders
    order by created_at, id
    limit 4
    for update
  `);
  assert.equal(ordersResult.rowCount, 4, "batch verification requires four existing work orders");

  const events = [];
  for (const [index, order] of ordersResult.rows.entries()) {
    const revisionResult = await client.query(
      `select coalesce(max(revision), 0) + 1 as revision from legacy_sync_outbox where order_id = $1`,
      [order.id]
    );
    const revision = Number(revisionResult.rows[0].revision);
    const eventId = `${consumerId}-${index + 1}`;

    await client.query(
      `
        update work_orders
        set legacy_sync_revision = $2, legacy_sync_status = 'processing', legacy_sync_error = null
        where id = $1
      `,
      [order.id, revision]
    );
    await client.query(
      `
        insert into legacy_sync_outbox (
          event_id, order_id, revision, event_type, payload, status,
          attempt_count, locked_by, locked_at
        ) values ($1, $2, $3, 'created', $4::jsonb, 'processing', 1, $5, now())
      `,
      [eventId, order.id, revision, JSON.stringify({ verification: true }), consumerId]
    );
    events.push({ eventId, orderId: order.id, revision });
  }

  const acknowledgements = events.slice(0, 2).map((event, index) => ({
    event_id: event.eventId,
    legacy_reid: 9900001 + index,
    legacy_document_no: 99001 + index,
    legacy_dispatch_no: `A9900${index + 1}`
  }));
  const failures = events.slice(2).map((event, index) => ({
    event_id: event.eventId,
    error_message: `batch verification failure ${index + 1}`,
    retry_after_seconds: 60 + index * 60
  }));

  await client.query("set local role runfeng_sync");
  let acknowledgedResult;
  let failedResult;
  try {
    acknowledgedResult = await client.query(
      "select * from acknowledge_legacy_sync_events($1, $2::jsonb)",
      [consumerId, JSON.stringify(acknowledgements)]
    );
    failedResult = await client.query(
      "select * from fail_legacy_sync_events($1, $2::jsonb)",
      [consumerId, JSON.stringify(failures)]
    );
  } finally {
    await client.query("reset role");
  }

  assert.deepEqual(
    acknowledgedResult.rows,
    acknowledgements.map((result) => ({ event_id: result.event_id, acknowledged: true }))
  );
  assert.deepEqual(
    failedResult.rows,
    failures.map((result) => ({ event_id: result.event_id, failed: true }))
  );

  const persistedResult = await client.query(
    `
      select
        event.event_id,
        event.status,
        event.legacy_reid::text,
        event.legacy_document_no,
        event.legacy_dispatch_no,
        event.last_error,
        work_order.legacy_sync_status as work_order_sync_status,
        work_order.dispatch_no
      from legacy_sync_outbox event
      join work_orders work_order on work_order.id = event.order_id
      where event.event_id = any($1::text[])
      order by event.event_id
    `,
    [events.map((event) => event.eventId)]
  );

  const succeeded = persistedResult.rows.filter((row) => row.status === "synced");
  const failed = persistedResult.rows.filter((row) => row.status === "failed");
  assert.equal(succeeded.length, 2);
  assert.equal(failed.length, 2);
  assert.ok(succeeded.every((row) => row.work_order_sync_status === "synced"));
  assert.ok(succeeded.every((row) => row.dispatch_no === row.legacy_dispatch_no));
  assert.ok(failed.every((row) => row.work_order_sync_status === "failed"));
  assert.ok(failed.every((row) => row.last_error?.startsWith("batch verification failure")));

  console.log(JSON.stringify({
    acknowledged: acknowledgedResult.rows,
    failed: failedResult.rows,
    databaseState: persistedResult.rows,
    executedAs: "runfeng_sync",
    roleSetup: createdTemporaryRole ? "created inside test transaction" : "existing database role",
    cleanup: "transaction rolled back"
  }, null, 2));
} finally {
  if (transactionStarted) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
