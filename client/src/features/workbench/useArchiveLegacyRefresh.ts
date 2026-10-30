import { hasRole, hasAnyRole } from "../../../../shared/roles.mjs";
import { useEffect, useRef, useState } from "react";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";

type RefreshReport = { succeeded: number; failures: Array<{ id: string; message: string }> };
export function useArchiveLegacyRefresh(user: UserProfile | undefined, onUpdated: (order: WorkOrder) => void, onComplete?: () => void) {
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [report, setReport] = useState<RefreshReport>();
  const running = useRef(false);
  const session = useRef(0);
  useEffect(() => {
    session.current += 1;
    setReport(undefined);
    setProgress(undefined);
    return () => { session.current += 1; };
  }, [user?.id]);
  function canRefresh(order: WorkOrder) {
    return Boolean(user && user.shopId === order.shop.id && hasAnyRole(user, ["manager", "advisor"])
      && (hasRole(user, 'manager') || order.advisor === user.name)
      && order.legacySyncStatus === "synced" && !["草稿", "待客户签字"].includes(order.status));
  }
  async function refresh(orders?: WorkOrder[]) {
    if (running.current) return;
    running.current = true;
    const generation = session.current;
    const next: RefreshReport = { succeeded: 0, failures: [] };
    setReport(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      const targets = orders ? orders.filter(canRefresh).map(order=>order.id) : await workOrderApi.refreshTargets();
      if(generation!==session.current)return;
      setProgress({done:0,total:targets.length});
      // Each order commits independently, so one missing legacy record cannot
      // hide successful updates. Sequential requests bound SQL Server load.
      for (const [index, id] of targets.entries()) {
        if (generation !== session.current) break;
        try {
          const updated = await workOrderApi.refreshFromRunfeng(id);
          if (generation !== session.current) break;
          onUpdated(updated);
          next.succeeded += 1;
        } catch (error) {
          if (generation !== session.current) break;
          next.failures.push({ id, message: error instanceof Error ? error.message : "更新失败，请重试" });
        }
        setProgress({ done: index + 1, total: targets.length });
      }
      if (generation === session.current) {
        setReport(next);
        if (next.succeeded) onComplete?.();
      }
    } catch(error) {
      if(generation===session.current)setReport({succeeded:0,failures:[{id:"获取更新列表",message:error instanceof Error?error.message:"加载失败"}]});
    } finally {
      running.current = false;
      if (generation === session.current) setProgress(undefined);
    }
  }
  return { canRefresh, refresh, refreshAll:()=>refresh(), progress, report, clearReport: () => setReport(undefined) };
}
