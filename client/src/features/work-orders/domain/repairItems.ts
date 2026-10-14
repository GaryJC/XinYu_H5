import type { RepairItem } from "../../../../../shared/types";

export function filterEmptyRepairItems(items: RepairItem[]) {
  return items.filter((item) => item.name.trim() || Number(item.laborFee || 0) !== 0);
}
