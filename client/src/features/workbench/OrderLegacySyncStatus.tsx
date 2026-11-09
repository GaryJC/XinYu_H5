import type {WorkOrder} from "../../../../shared/types";
import {LegacySyncStatusChip} from "../../shared/ui/Status";
import {CustomerVehicleUpdateTag} from "../customer-vehicle-update/CustomerVehicleUpdateTag";
export function OrderLegacySyncStatus({ order }: { order: Pick<WorkOrder,"status"|"legacySyncStatus"|"customerVehicleUpdatedAt"|"customerVehicleUpdatedBy"> }) {
  if (order.status === "草稿") return null;
  return <><LegacySyncStatusChip status={order.legacySyncStatus} /><CustomerVehicleUpdateTag order={order} /></>;
}
