import { hasRole, hasAnyRole } from "../../../../../shared/roles.mjs";
import { useEffect, useRef, useState } from "react";
import type { WorkOrder, UserProfile } from "../../../../../shared/types";
import { workOrderApi } from "../api/workOrderApi";

export function usePaperOrderResolution(order: WorkOrder, user: UserProfile | undefined,
  onUpdated: (order: WorkOrder) => void, onEdit: (order: WorkOrder) => void) {
  const [mode, setMode] = useState<"runfeng" | "dingtalk">("runfeng");
  const [dispatchNo, setDispatchNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setMode(order.paperOrder?.mode === "dingtalk" ? "dingtalk" : "runfeng"); setDispatchNo(""); setError(""); setBusy(false);
    return () => { generation.current++; };
  }, [order.id, order.paperOrder?.mode, user?.id]);
  const isDingTalkDraft = order.status === "草稿" && order.paperOrder?.mode === "dingtalk";
  const canChoose = order.status === "待处理纸质委托书" && order.paperOrder?.mode === "pending" || isDingTalkDraft;
  const canProcess = Boolean(user?.active && hasAnyRole(user, ["advisor", "manager"]) && user.shopId === order.shop.id
    && (!isDingTalkDraft || hasRole(user, 'manager') || user.name === order.advisor));
  async function resolve() {
    if (running.current || !canProcess || !canChoose) return;
    if (isDingTalkDraft && mode === "dingtalk") { onEdit(order); return; }
    const number = dispatchNo.trim().toUpperCase();
    if (mode === "runfeng" && !/^[ABFJ][0-9]+$/.test(number)) {
      setError("请填写完整润丰派工号，例如 A66329"); return;
    }
    const session = generation.current;
    running.current = true; setBusy(true); setError("");
    try {
      const updated = await workOrderApi.resolvePaperOrder(order.id, mode === "runfeng" ? { mode, dispatchNo: number } : { mode });
      if (session !== generation.current) return;
      onUpdated(updated);
      if (mode === "dingtalk") onEdit(updated);
    } catch (cause) {
      if (session === generation.current) setError(cause instanceof Error ? cause.message : "处理失败，请重试");
    } finally {
      running.current = false;
      if (session === generation.current) setBusy(false);
    }
  }
  return { mode, setMode, dispatchNo, setDispatchNo, busy, error, canProcess, canChoose, isDingTalkDraft, resolve };
}
