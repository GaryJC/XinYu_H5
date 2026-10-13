import { recognizeVehicleLicense } from "../ocr.mjs";
import { getStoredOcrSource } from "../storage.mjs";
import { assertFileAccess } from "../repositories/fileRepository.mjs";
import { HttpError } from "../http/HttpError.mjs";
import { measureStage } from "../http/requestTiming.mjs";

export async function recognizeVehicleLicenseInput(input, user, dependencies = {}) {
  if (!input || typeof input !== "object") throw new HttpError(400, "缺少行驶证识别参数");
  const { authorize = assertFileAccess, getSource = getStoredOcrSource, recognize = recognizeVehicleLicense } = dependencies;
  if (input.fileId !== undefined) {
    if (typeof input.fileId !== "string" || !input.fileId.trim()) throw new HttpError(400, "行驶证文件 ID 无效");
    if (input.imageBase64 !== undefined) throw new HttpError(400, "请仅提供行驶证文件 ID 或图片内容之一");
    await measureStage("file_access", () => authorize(input.fileId, user));
    const source = await measureStage("ocr_source", () => getSource(input.fileId));
    return recognize(source.imageBase64, source.url);
  }
  // Existing callers can still send imageBase64 to the same API path.
  return recognize(input.imageBase64);
}
