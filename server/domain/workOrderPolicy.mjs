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

const transitionPatchFields = new Map([
  ["待派工", []],
  ["维修中", ["technician"]],
  ["待结算", ["inspector", "signatures"]],
  ["完成", ["settlementAmount", "feeNote"]]
]);

export function assertDraftEditable(status) {
  if (status !== "草稿") throw new HttpError(409, `当前状态“${status}”不能修改委托单内容`);
}

export function assertOrderReadyForSignature(order) {
  const missing = [];
  if (!order.department?.code?.trim() || !order.department?.name?.trim()) missing.push("部门");
  if (!order.vehicle?.plate?.trim()) missing.push("车牌号码");
  if (!/^[A-Z0-9]{17}$/i.test(order.vehicle?.vin?.trim() || "")) missing.push("17 位 VIN");
  if (!/^\d+(\.\d+)?$/.test(order.vehicle?.mileage?.trim() || "")) missing.push("进厂里程");
  if (!order.vehicle?.model?.trim()) missing.push("车型");
  if (!order.vehicle?.modelLegacyCode?.trim()) missing.push("车型编码");
  if (!order.customer?.name?.trim()) missing.push("车主名称/所属单位");
  if (!order.customer?.legacyCode?.trim()) missing.push("所属单位编码");
  if (!order.customer?.phone?.trim()) missing.push("联系电话");
  if (!order.repairItems?.length || order.repairItems.some((item) => !item.name?.trim())) missing.push("维修项目");
  if (missing.length) throw new HttpError(400, `请完善必填项：${missing.join("、")}`);
}

export function assertVehicleLicenseRequirement(vehicleLookupStatus, hasVehicleLicense) {
  if (vehicleLookupStatus === "new" && !hasVehicleLicense) {
    throw new HttpError(400, "公司系统中未找到该车辆，新车必须上传行驶证照片后再发起签字");
  }
}

export function assertStatusTransition(currentStatus, targetStatus) {
  if (nextStatus.get(currentStatus) !== targetStatus) {
    throw new HttpError(409, `不能从“${currentStatus}”直接变更为“${targetStatus}”`);
  }
}

export function sanitizeTransitionPatch(targetStatus, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new HttpError(400, "流程变更参数必须是对象");
  }
  const allowedFields = transitionPatchFields.get(targetStatus) || [];
  const unexpectedFields = Object.keys(patch).filter((field) => !allowedFields.includes(field));
  if (unexpectedFields.length) {
    throw new HttpError(400, `流程变更包含不允许的字段：${unexpectedFields.join("、")}`);
  }
  if (targetStatus === "维修中" && (typeof patch.technician !== "string" || !patch.technician.trim())) {
    throw new HttpError(400, "进入维修中前必须指定维修技师");
  }
  if (patch.signatures !== undefined && (!patch.signatures || typeof patch.signatures !== "object" || Array.isArray(patch.signatures))) {
    throw new HttpError(400, "签字参数必须是对象");
  }
  if (patch.settlementAmount !== undefined && (!Number.isFinite(Number(patch.settlementAmount)) || Number(patch.settlementAmount) < 0)) {
    throw new HttpError(400, "结算金额必须是非负数字");
  }
  return Object.fromEntries(allowedFields.filter((field) => Object.hasOwn(patch, field)).map((field) => [field, patch[field]]));
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
  if (!order.dispatchNo?.trim()) {
    throw new HttpError(409, "润丰尚未回填派工号，请等待润丰同步完成后再同步维修平台");
  }
}
