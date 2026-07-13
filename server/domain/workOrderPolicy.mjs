import { HttpError } from "../http/HttpError.mjs";

const nextStatus = new Map([
  ["已委托", "待派工"],
  ["待派工", "维修中"],
  ["维修中", "待结算"],
  ["待结算", "完成"]
]);

const repairActionSourceStatus = new Map([
  ["assign", "待派工"],
  ["pick", "待领料"],
  ["start", "待开工"],
  ["finish", "维修中"],
  ["inspect", "待检验"]
]);

export function assertDraftEditable(status) {
  if (status !== "草稿") throw new HttpError(409, `当前状态“${status}”不能修改委托单内容`);
}

export function assertStatusTransition(currentStatus, targetStatus) {
  if (nextStatus.get(currentStatus) !== targetStatus) {
    throw new HttpError(409, `不能从“${currentStatus}”直接变更为“${targetStatus}”`);
  }
}

export function assertRepairItemAction(item, action) {
  if (!item) throw new HttpError(404, "维修项目不存在");
  const expectedStatus = repairActionSourceStatus.get(action);
  if (!expectedStatus) throw new HttpError(400, "不支持的维修项目操作");
  if (item.status !== expectedStatus) {
    throw new HttpError(409, `维修项目当前状态“${item.status}”不能执行该操作`);
  }
}

export function assertSettlementAllowed(status) {
  if (status !== "待结算") throw new HttpError(409, "委托单进入待结算后才能生成结算清单");
}

export function assertPlatformSyncAllowed(order) {
  if (["草稿", "待客户签字"].includes(order.status)) {
    throw new HttpError(409, "客户完成签字后才能同步维修平台");
  }
  if (order.platformOrderNo) throw new HttpError(409, `委托单已同步维修平台：${order.platformOrderNo}`);
}
