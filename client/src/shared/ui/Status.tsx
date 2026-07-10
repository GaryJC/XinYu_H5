import { WorkOrderStatus } from "../../../../shared/types";

const statusTone: Record<WorkOrderStatus, "amber" | "blue" | "green" | "violet" | "gray"> = {
  草稿: "gray",
  待客户签字: "amber",
  已委托: "blue",
  待派工: "blue",
  维修中: "green",
  待结算: "violet",
  完成: "gray"
};

export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>较昨日 +{value}</small>
    </article>
  );
}

export function StatusChip({ status }: { status: WorkOrderStatus }) {
  return <span className={`status-chip ${statusTone[status]}`}>{status}</span>;
}

