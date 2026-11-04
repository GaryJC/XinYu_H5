import { RoleKey, WorkOrder } from "../../../../../shared/types";

export function canCreateOrder(role: RoleKey) {
  return ["employee", "advisor", "manager", "technician", "inspector", "warehouse", "outsourcing"].includes(role);
}

export function canSendSignature(role: RoleKey, order?: WorkOrder) {
  return Boolean(order && canCreateOrder(role) && order.status === "草稿");
}

export function canSubmitDispatch(role: RoleKey, order?: WorkOrder) {
  return Boolean(order && (role === "advisor" || role === "manager") && order.status === "已委托");
}

export function canDispatch(role: RoleKey, order?: WorkOrder) {
  return Boolean(order && (role === "advisor" || role === "manager") && order.status === "待派工");
}

export function canCompleteRepair(role: RoleKey, order?: WorkOrder) {
  return Boolean(order && (role === "technician" || role === "manager") && order.status === "维修中");
}

export function canSettle(role: RoleKey, order?: WorkOrder) {
  return Boolean(order && (role === "advisor" || role === "manager") && order.status === "待结算");
}

