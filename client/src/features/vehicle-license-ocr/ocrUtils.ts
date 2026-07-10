import { VehicleLicenseOcrResult } from "../../../../shared/types";

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

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
