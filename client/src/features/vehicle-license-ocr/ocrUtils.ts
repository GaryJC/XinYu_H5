import { VehicleLicenseOcrResult } from "../../../../shared/types";

export function formatVehicleLicenseSummary(result: VehicleLicenseOcrResult) {
  const items = [
    result.plate && `车牌 ${result.plate}`,
    result.vin && `VIN ${result.vin}`,
    result.owner && `车主 ${result.owner}`
  ].filter(Boolean);
  return items.join(" · ") || "已识别行驶证";
}

export function normalizeOcrDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const compact = raw.replace(/[^\d]/g, "");
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return raw;
}
