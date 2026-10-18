import { Tag } from "antd";
import type { WorkOrder } from "../../../../shared/types";

export function CustomerVehicleUpdateTag({ order }: { order: WorkOrder }) {
  const pending = Boolean(order.customerVehicleUpdatedAt
    && ["pending", "processing", "failed"].includes(order.legacySyncStatus || ""));
  return pending ? <Tag color="orange">待更新</Tag> : null;
}
