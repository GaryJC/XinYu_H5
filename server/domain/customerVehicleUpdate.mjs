import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { HttpError } from "../http/HttpError.mjs";

const limits = { contact: 50, phone: 50 };

export function parseCustomerVehicleUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !Object.hasOwn(limits, key) && key !== "expectedRevision")) {
    throw new HttpError(400, "仅允许修改联系人和联系电话");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new HttpError(400, "缺少有效同步版本，请刷新后重试");
  const result = { expectedRevision: input.expectedRevision };
  for (const [key, max] of Object.entries(limits)) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].trim().length > max || /[\u0000-\u001f\u007f]/.test(input[key])) {
      throw new HttpError(400, "联系人和联系电话不能为空、超过 50 个字符或包含控制字符");
    }
    result[key] = input[key].trim();
  }
  return result;
}

export function customerVehicleValues(order) {
  return {
    contact: order.customer_contact || "", phone: order.customer_phone || ""
  };
}

export function assertCustomerVehicleEditable(order, actor, expectedRevision) {
  if (!actor?.active || !hasAnyRole(actor, ["manager", "advisor"]) || !actor.shopId || actor.shopId !== order.shop_id
      || (!hasRole(actor, 'manager') && hasRole(actor, 'advisor') && actor.name !== order.advisor)) throw new HttpError(403, "无权修改该委托单");
  if (["草稿", "待客户签字", "待处理纸质委托书"].includes(order.status) || !["pending", "processing", "synced"].includes(order.legacy_sync_status)) throw new HttpError(409, "仅可修改待拉取、拉取中或已同步的委托单");
  const needsLink = order.legacy_sync_status === "synced" || order.legacy_reid != null || order.legacy_document_no != null || Boolean(order.dispatch_no);
  if (needsLink && (!Number.isSafeInteger(Number(order.legacy_reid)) || Number(order.legacy_reid) < 1
      || !Number.isSafeInteger(Number(order.legacy_document_no)) || Number(order.legacy_document_no) < 1
      || !/^[ABFJ][0-9]+$/.test(order.dispatch_no || ""))) throw new HttpError(409, "缺少完整润丰关联，请先核对原单");
  if (Number(order.legacy_sync_revision) !== expectedRevision) throw new HttpError(409, "委托单已被更新，请刷新后重新修改");
}
