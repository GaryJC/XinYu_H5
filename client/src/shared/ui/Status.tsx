import { LegacySyncStatus, WorkOrderStatus } from "../../../../shared/types";
import { Card, Statistic, Tag } from "antd";

const statusColor: Record<WorkOrderStatus, string> = {
  草稿: "default",
  待客户签字: "gold",
  已委托: "cyan",
  待派工: "blue",
  维修中: "green",
  待结算: "purple",
  完成: "success"
};

const legacySyncPresentation: Record<LegacySyncStatus, { label: string; color: string }> = {
  not_applicable: { label: "无需同步", color: "default" },
  pending: { label: "待拉取", color: "gold" },
  processing: { label: "拉取中", color: "processing" },
  synced: { label: "已同步", color: "success" },
  failed: { label: "同步失败", color: "error" }
};

export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="metric-card" size="small">
      <Statistic title={label} value={value} suffix={<small>较昨日 +{value}</small>} />
    </Card>
  );
}

export function StatusChip({ status }: { status: WorkOrderStatus }) {
  return <Tag color={statusColor[status]}>{status}</Tag>;
}

export function LegacySyncStatusChip({ status = "not_applicable" }: { status?: LegacySyncStatus }) {
  if (status === "not_applicable") return null;
  const presentation = legacySyncPresentation[status];
  return <Tag color={presentation.color}>润丰：{presentation.label}</Tag>;
}
