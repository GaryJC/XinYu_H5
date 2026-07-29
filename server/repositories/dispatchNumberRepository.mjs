import { transaction } from "../database/pool.mjs";
import { getLatestLegacyDispatchNumber } from "./legacyDispatchNumberRepository.mjs";

const DISPATCH_PREFIX = "A";
const DISPATCH_RESERVATION_LOCK_ID = 736_624_001;

export async function reserveNextDispatchNumber(reservedBy) {
  return transaction((client) => allocateDispatchNumber(client, { reservedBy }));
}

export async function claimDispatchNumberForOrder(client, requestedDispatchNo, reservedBy) {
  return allocateDispatchNumber(client, {
    requestedDispatchNo,
    reservedBy
  });
}

export async function consumeDispatchNumber(client, dispatchNo, orderId) {
  const result = await client.query(
    `
      update dispatch_number_reservations
      set consumed_order_id = $2, consumed_at = now()
      where dispatch_no = $1 and consumed_order_id is null
    `,
    [dispatchNo, orderId]
  );
  if (result.rowCount !== 1) {
    throw new Error(`Dispatch number reservation is unavailable: ${dispatchNo}`);
  }
}

async function allocateDispatchNumber(client, { requestedDispatchNo = "", reservedBy = "" }) {
  await client.query("select pg_advisory_xact_lock($1)", [DISPATCH_RESERVATION_LOCK_ID]);

  const legacy = await getLatestLegacyDispatchNumber(DISPATCH_PREFIX);
  const requestedNumber = parseDispatchNumber(requestedDispatchNo);
  if (requestedNumber > legacy.maxNumber) {
    const requested = await client.query(
      `
        select dispatch_no
        from dispatch_number_reservations
        where dispatch_no = $1 and consumed_order_id is null
        for update
      `,
      [`${DISPATCH_PREFIX}${requestedNumber}`]
    );
    if (requested.rows[0]) return requested.rows[0].dispatch_no;
  }

  if (!requestedNumber && reservedBy) {
    const existing = await client.query(
      `
        select dispatch_no
        from dispatch_number_reservations
        where reserved_by = $1
          and consumed_order_id is null
          and numeric_value > $2
        order by numeric_value desc
        limit 1
        for update
      `,
      [reservedBy, legacy.maxNumber]
    );
    if (existing.rows[0]) return existing.rows[0].dispatch_no;
  }

  const local = await client.query(
    "select coalesce(max(numeric_value), 0)::bigint as max_number from dispatch_number_reservations"
  );
  const localMax = Number(local.rows[0]?.max_number || 0);
  const nextNumber = Math.max(legacy.maxNumber, localMax) + 1;
  const dispatchNo = `${DISPATCH_PREFIX}${nextNumber}`;

  await client.query(
    `
      insert into dispatch_number_reservations (dispatch_no, numeric_value, reserved_by)
      values ($1, $2, $3)
    `,
    [dispatchNo, nextNumber, reservedBy || ""]
  );
  return dispatchNo;
}

function parseDispatchNumber(value) {
  const match = String(value || "").trim().toUpperCase().match(/^A(\d+)$/);
  return match ? Number(match[1]) : 0;
}
