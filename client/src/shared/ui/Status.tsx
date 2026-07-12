import { WorkOrderStatus } from "../../../../shared/types";
import { Card, Statistic, Tag } from "antd";

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
    <Card className="metric-card" size="small">
      <Statistic title={label} value={value} suffix={<small>较昨日 +{value}</small>} />
    </Card>
  );
}

export function StatusChip({ status }: { status: WorkOrderStatus }) {
  return <Tag className={`status-chip ${statusTone[status]}`}>{status}</Tag>;
}
