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
  pending: { label: "", color: "default" },
  processing: { label: "", color: "default" },
  synced: { label: "已写入", color: "success" },
  failed: { label: "写入失败", color: "error" }
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
  if (status === "not_applicable" || status === "pending" || status === "processing") return null;
  const presentation = legacySyncPresentation[status];
  return <Tag color={presentation.color}>润丰：{presentation.label}</Tag>;
}
