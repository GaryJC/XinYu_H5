import { Tag } from "antd";
import type { WorkOrder } from "../../../../shared/types";

export function CustomerVehicleUpdateTag({ order }: { order: Pick<WorkOrder,"customerVehicleUpdatedAt"|"legacySyncStatus"> }) {
  const pending = Boolean(order.customerVehicleUpdatedAt
    && ["pending", "processing", "failed"].includes(order.legacySyncStatus || ""));
  return pending ? <Tag color="orange">待更新</Tag> : null;
}
