import {
  executeSqlServerQuery,
  executeSqlServerTransaction
} from "../database/sqlServerPool.mjs";

export const FIND_LEGACY_TEST_ORDER_QUERY = `
  select top 2
    work_order.reid,
    work_order.dh,
    RTRIM(work_order.pgd) as pgd,
    RTRIM(work_order.ch) as ch,
    RTRIM(work_order.bzxx) as bzxx,
    (select count(*) from dbo.qxwxmxb item where item.wd = '' and item.dh = work_order.dh) as repair_item_count,
    (select count(*) from dbo.qxpgmxb assignment where RTRIM(assignment.pgd) = RTRIM(work_order.pgd)) as assignment_count,
    (select count(*) from dbo.ckdb1 outbound where RTRIM(outbound.pgd) = RTRIM(work_order.pgd)) as outbound_count,
    (select count(*) from dbo.cljgb completion where RTRIM(completion.pgd) = RTRIM(work_order.pgd)) as completion_count,
    (select count(*) from dbo.qxthb returned where RTRIM(returned.pgd) = RTRIM(work_order.pgd)) as return_count,
    (select count(*) from dbo.skxcb payment where RTRIM(payment.pgd) = RTRIM(work_order.pgd)) as payment_count,
    (select count(*) from dbo.lscxwx018 archived where RTRIM(archived.pgd) = RTRIM(work_order.pgd)) as archive_count
  from dbo.qxwxb work_order with (updlock, holdlock)
  where RTRIM(work_order.bzxx) = @source_marker
  order by work_order.reid desc
`;

export const DELETE_LEGACY_TEST_ORDER_ITEMS_QUERY = `
  delete from dbo.qxwxmxb
  where wd = '' and dh = @document_no
`;

export const DELETE_LEGACY_TEST_ORDER_QUERY = `
  delete from dbo.qxwxb
  where reid = @legacy_reid
    and dh = @document_no
    and RTRIM(bzxx) = @source_marker
`;

const downstreamFields = [
  ["assignment_count", "派工明细"],
  ["outbound_count", "出库单"],
  ["completion_count", "车辆竣工记录"],
  ["return_count", "退回记录"],
  ["payment_count", "收款记录"],
  ["archive_count", "历史归档"]
];

export async function inspectLegacyTestOrder(
  orderId,
  { executeQuery = executeSqlServerQuery } = {}
) {
  const normalizedOrderId = normalizeOrderId(orderId);
  const sourceMarker = `H5:${normalizedOrderId}`;
  const result = await executeQuery(FIND_LEGACY_TEST_ORDER_QUERY, (request, sql) => {
    request.input("source_marker", sql.VarChar(50), sourceMarker);
  });
  const rows = result.recordset || [];
  if (new Set(rows.map((row) => Number(row.reid))).size > 1) {
    throw new Error(`润丰存在多个来源标记为 ${sourceMarker} 的维修单，禁止自动删除`);
  }
  return rows[0] ? mapLegacyOrder(rows[0], normalizedOrderId) : null;
}

export async function deleteLegacyTestOrder(
  orderId,
  { executeTransaction = executeSqlServerTransaction } = {}
) {
  const normalizedOrderId = normalizeOrderId(orderId);
  const sourceMarker = `H5:${normalizedOrderId}`;
  return executeTransaction(async (execute) => {
    const found = await execute(FIND_LEGACY_TEST_ORDER_QUERY, (request, sql) => {
      request.input("source_marker", sql.VarChar(50), sourceMarker);
    });
    const rows = found.recordset || [];
    if (new Set(rows.map((row) => Number(row.reid))).size > 1) {
      throw new Error(`润丰存在多个来源标记为 ${sourceMarker} 的维修单，禁止自动删除`);
    }
    if (!rows[0]) return { orderId: normalizedOrderId, found: false, deleted: false };

    const target = mapLegacyOrder(rows[0], normalizedOrderId);
    assertNoDownstreamRecords(target);

    const deletedItems = await execute(DELETE_LEGACY_TEST_ORDER_ITEMS_QUERY, (request, sql) => {
      request.input("document_no", sql.Int, target.documentNo);
    });
    if (Number(deletedItems.rowsAffected?.[0] ?? deletedItems.rowCount ?? 0) !== target.repairItemCount) {
      throw new Error(`润丰维修项目数量在清理期间发生变化：${target.dispatchNo}`);
    }

    const deletedHeader = await execute(DELETE_LEGACY_TEST_ORDER_QUERY, (request, sql) => {
      request.input("legacy_reid", sql.Int, target.legacyReid);
      request.input("document_no", sql.Int, target.documentNo);
      request.input("source_marker", sql.VarChar(50), sourceMarker);
    });
    if (Number(deletedHeader.rowsAffected?.[0] ?? deletedHeader.rowCount ?? 0) !== 1) {
      throw new Error(`润丰维修单在清理期间发生变化：${target.dispatchNo}`);
    }

    return { ...target, found: true, deleted: true };
  });
}

export function assertNoDownstreamRecords(target) {
  const found = downstreamFields
    .filter(([field]) => Number(target[field] || 0) > 0)
    .map(([field, label]) => `${label} ${target[field]} 条`);
  if (found.length) {
    throw new Error(`润丰维修单 ${target.dispatchNo} 已产生下游业务数据（${found.join("、")}），禁止自动删除`);
  }
}

function mapLegacyOrder(row, orderId) {
  const mapped = {
    orderId,
    legacyReid: Number(row.reid || 0),
    documentNo: Number(row.dh || 0),
    dispatchNo: String(row.pgd || "").trim(),
    plate: String(row.ch || "").trim(),
    sourceMarker: String(row.bzxx || "").trim(),
    repairItemCount: Number(row.repair_item_count || 0),
    assignment_count: Number(row.assignment_count || 0),
    outbound_count: Number(row.outbound_count || 0),
    completion_count: Number(row.completion_count || 0),
    return_count: Number(row.return_count || 0),
    payment_count: Number(row.payment_count || 0),
    archive_count: Number(row.archive_count || 0)
  };
  if (!Number.isInteger(mapped.legacyReid) || mapped.legacyReid < 1) throw new Error("润丰维修单 reid 无效");
  if (!Number.isInteger(mapped.documentNo) || mapped.documentNo < 1) throw new Error("润丰维修单内部单号无效");
  if (!/^[A-Z][0-9]+$/.test(mapped.dispatchNo)) throw new Error("润丰维修单派工号无效");
  return mapped;
}

function normalizeOrderId(value) {
  const orderId = String(value || "").trim();
  if (!/^WT-[0-9]{8}-[A-Z0-9]{6,20}$/.test(orderId)) {
    throw new Error(`委托单号格式无效：${orderId || "空"}`);
  }
  if (`H5:${orderId}`.length > 50) throw new Error(`委托单号过长：${orderId}`);
  return orderId;
}
