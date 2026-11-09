import { legacyTextBytes } from "./legacyInputValidation.mjs";
// Runfeng stores vehicle identifiers in a 10-byte legacy Chinese varchar.
export function vehiclePlateError(value, { required = true } = {}) {
  const plate = typeof value === "string" ? value : "";
  if (!plate.trim()) return required ? "车牌号码必填" : "";
  const bytes = legacyTextBytes(plate);
  return bytes > 10 ? "车牌号码过长，最多10位字母数字，汉字占2位，空格占1位" : "";
}
