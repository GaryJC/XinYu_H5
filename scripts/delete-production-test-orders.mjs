import { pool } from "../server/database/pool.mjs";
import { closeSqlServerPool } from "../server/database/sqlServerPool.mjs";
import {
  assertNoDownstreamRecords,
  deleteLegacyTestOrder,
  inspectLegacyTestOrder
} from "../server/repositories/legacyTestOrderCleanupRepository.mjs";

const orderIds = parseOrderIds(process.argv.slice(2));
const expectedConfirmation = orderIds.join(",");
const suppliedConfirmation = readOption(process.argv.slice(2), "--confirm");
const confirmed = suppliedConfirmation === expectedConfirmation;

try {
  const postgresOrders = await findPostgresOrders(orderIds);
  const postgresById = new Map(postgresOrders.map((order) => [order.id, order]));
  const preview = [];

  for (const orderId of orderIds) {
    const postgres = postgresById.get(orderId) || null;
    const runfeng = await inspectLegacyTestOrder(orderId);
    validateCrossDatabaseLink(orderId, postgres, runfeng);
    if (runfeng) assertNoDownstreamRecords(runfeng);
    preview.push({ orderId, postgres, runfeng });
  }

  if (!confirmed) {
    console.log(JSON.stringify({
      deleted: false,
      message: suppliedConfirmation
        ? "确认值与本次委托单号列表不完全一致，未执行删除。"
        : "当前为预览模式，未执行删除。确认这些确实是生产测试单后，再运行 confirmationCommand。",
      targets: preview,
      confirmationCommand: buildConfirmationCommand(orderIds)
    }, null, 2));
    process.exitCode = suppliedConfirmation ? 1 : 0;
  } else {
    const deletedRunfeng = [];
    for (const orderId of orderIds) {
      deletedRunfeng.push(await deleteLegacyTestOrder(orderId));
    }

    const deletedPostgres = await deletePostgresOrders(orderIds);
    console.log(JSON.stringify({
      deleted: true,
      deletedPostgresOrderIds: deletedPostgres,
      runfeng: deletedRunfeng,
      note: "已删除 PostgreSQL 委托单及级联业务数据，并删除润丰 qxwxb/qxwxmxb 测试维修单。车辆档案 qxclxxb 未自动删除，以免误删既有车辆主数据。"
    }, null, 2));
  }
} finally {
  await Promise.allSettled([pool.end(), closeSqlServerPool()]);
}

function parseOrderIds(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--order-id") {
      values.push(args[index + 1]);
      index += 1;
    } else if (argument.startsWith("--order-id=")) {
      values.push(argument.slice("--order-id=".length));
    }
  }
  const normalized = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
  if (!normalized.length) {
    throw new Error("至少提供一个 --order-id，例如：npm run db:delete-test-orders -- --order-id WT-20260817-ABC123DEF456");
  }
  return normalized;
}

function readOption(args, option) {
  const inline = args.find((argument) => argument.startsWith(`${option}=`));
  if (inline) return inline.slice(option.length + 1).trim();
  const index = args.indexOf(option);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

async function findPostgresOrders(ids) {
  const { rows } = await pool.query(
    `
      select
        id,
        status,
        vehicle_plate as "plate",
        dispatch_no as "dispatchNo",
        legacy_reid as "legacyReid",
        legacy_document_no as "legacyDocumentNo",
        created_at as "createdAt"
      from work_orders
      where id = any($1::text[])
      order by id
    `,
    [ids]
  );
  return rows;
}

async function deletePostgresOrders(ids) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      "delete from work_orders where id = any($1::text[]) returning id",
      [ids]
    );
    await client.query("commit");
    return result.rows.map((row) => row.id).sort();
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function validateCrossDatabaseLink(orderId, postgres, runfeng) {
  if (!postgres && !runfeng) throw new Error(`PostgreSQL 和润丰中都没有找到 ${orderId}`);
  if (!postgres || !runfeng) return;
  const mismatches = [];
  if (postgres.legacyReid && Number(postgres.legacyReid) !== runfeng.legacyReid) mismatches.push("reid");
  if (postgres.legacyDocumentNo && Number(postgres.legacyDocumentNo) !== runfeng.documentNo) mismatches.push("内部单号");
  if (postgres.dispatchNo && postgres.dispatchNo.trim() !== runfeng.dispatchNo) mismatches.push("派工号");
  if (postgres.plate && postgres.plate.trim() !== runfeng.plate) mismatches.push("车牌号");
  if (mismatches.length) {
    throw new Error(`${orderId} 在 PostgreSQL 与润丰中的${mismatches.join("、")}不一致，禁止自动删除`);
  }
}

function buildConfirmationCommand(ids) {
  const idArgs = ids.map((id) => `--order-id ${id}`).join(" ");
  return `npm run db:delete-test-orders -- ${idArgs} --confirm=${ids.join(",")}`;
}
