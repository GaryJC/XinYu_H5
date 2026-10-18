import { useEffect, useRef, useState } from "react";
import type { UserProfile, WorkOrder, WorkOrderCustomerVehicleUpdate } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";

export function useCustomerVehicleEditor(order: WorkOrder, user: UserProfile | undefined, onUpdated: (order: WorkOrder) => void) {
  const [change, setChange] = useState<WorkOrderCustomerVehicleUpdate>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setChange(undefined);
    setError("");
    setSaving(false);
    return () => { generation.current += 1; };
  }, [order.id, user?.id]);

  const canSee = Boolean(!["草稿", "待客户签字", "待处理纸质委托书"].includes(order.status)
    && user?.active && user.shopId === order.shop.id
    && ["manager", "advisor"].includes(user.role));
  const hasPermission = Boolean(user?.role === "manager" || user?.role === "advisor" && user.name === order.advisor);
  const disabledReason = !hasPermission ? `本单服务顾问为${order.advisor}；仅本人或本店管理员可编辑`
    : !order.customerVehicleEditEnabled ? "待启用：润丰完成更新事件适配后，由管理员开启"
    : !(Number.isSafeInteger(order.legacySyncRevision) && order.legacySyncRevision! >= 0) || order.legacySyncStatus === "synced" && !order.customerVehicleLinkComplete ? "缺少完整润丰关联，请先核对原单"
    : !["pending", "processing", "synced"].includes(order.legacySyncStatus || "") ? "当前同步状态不支持修改，请先处理同步失败" : "";
  const canEdit = canSee && !disabledReason;

  function open() {
    if (!canEdit) return;
    setError("");
    setChange({ expectedRevision: order.legacySyncRevision!, contact: order.customer.contact, phone: order.customer.phone,
      model: order.vehicle.model, modelLegacyCode: order.vehicle.modelLegacyCode,
      organization: order.customer.name, organizationLegacyCode: order.customer.legacyCode });
  }
  async function save() {
    if (!change || running.current || !canEdit) return;
    if (Object.entries(change).some(([key, value]) => key !== "expectedRevision" && !String(value ?? "").trim())) {
      setError("请填写四项信息，并选择或新增有编码的车型和所属单位");
      return;
    }
    running.current = true;
    setSaving(true);
    setError("");
    const current = generation.current;
    try {
      const updated = await workOrderApi.updateCustomerVehicle(order.id, change);
      if (current !== generation.current) return;
      onUpdated(updated);
      setChange(undefined);
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      running.current = false;
      if (current === generation.current) setSaving(false);
    }
  }
  return { change, setChange, canSee, canEdit, hasPermission, disabledReason, saving, error, open, save, close: () => { if (!running.current) setChange(undefined); } };
}
