import fs from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import { createImageThumbnail } from "./images/thumbnail.mjs";
import { HttpError } from "./http/HttpError.mjs";
import { createFileRecord, findFileRecord } from "./repositories/fileRepository.mjs";
import { measureStage } from "./http/requestTiming.mjs";

let ossClient;
const pendingThumbnails = new Map();

const allowedFileKinds = new Set(["vehicle_nameplate_photo", "repair_completed_photo", "repair_parts_photo", "repair_progress_photo", "vehicle_license", "repair_order_photo", "damage_photo", "signature_image", "other"]);
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif"
]);

export async function saveUploadedFile({ orderId, kind, fileName, mimeType, imageBase64, uploadedBy, uploadRequestId, database }) {
  if (!imageBase64 || typeof imageBase64 !== "string") throw new HttpError(400, "缺少文件内容");
  validateUploadedImageMetadata(kind, mimeType);

  const buffer = Buffer.from(stripDataUrlPrefix(imageBase64), "base64");
  if (!buffer.length) throw new HttpError(400, "文件内容为空");

  const safeName = sanitizeFileName(fileName || `upload-${Date.now()}.jpg`);
  const objectKey = buildObjectKey({ orderId, kind, fileName: safeName });
  const storage = await measureStage("image_store", () => putObject(objectKey, buffer, mimeType || "application/octet-stream"));

  return measureStage("file_record", () => createFileRecord({
    orderId: orderId || null,
    kind,
    storageProvider: storage.provider,
    bucket: storage.bucket,
    objectKey: storage.objectKey,
    originalName: safeName,
    mimeType: mimeType || "application/octet-stream",
    sizeBytes: buffer.length,
    uploadedBy: uploadedBy || null, uploadRequestId, database
  }));
}

export async function getStoredOcrSource(fileId) {
  const record = await findFileRecord(fileId);
  if (record.kind !== "vehicle_license") throw new HttpError(400, "请选择行驶证照片进行识别");
  if (record.storageProvider === "oss") {
    if (record.bucket !== process.env.OSS_BUCKET) throw new HttpError(500, "行驶证照片存储桶与当前配置不一致");
    // Private OSS images remain private; only the OCR service gets a short-lived URL.
    const url = getOssClient().signatureUrl(record.objectKey, { expires: 300, method: "GET" });
    return { url };
  }
  if (record.storageProvider !== "local") throw new HttpError(500, "不支持的图片存储服务");
  const { body } = await readStoredFile(fileId);
  return { imageBase64: body.toString("base64") };
}

export function validateUploadedImageMetadata(kind, mimeType) {
  if (!kind || typeof kind !== "string") throw new HttpError(400, "缺少文件类型");
  if (!allowedFileKinds.has(kind)) throw new HttpError(400, "不支持的文件类型");
  if (!mimeType || typeof mimeType !== "string") throw new HttpError(400, "缺少图片 MIME 类型");
  if (!allowedImageMimeTypes.has(mimeType.toLowerCase())) throw new HttpError(400, "仅支持安全的图片格式");
}

export async function readStoredFile(fileId) {
  const record = await findFileRecord(fileId);
  return { record, body: await readStorageObject(record, record.objectKey) };
}

export async function readStoredThumbnail(fileId) {
  const record = await findFileRecord(fileId);
  if (!record.mimeType.toLowerCase().startsWith("image/")) throw new HttpError(400, "该文件不是图片");
  const existing = pendingThumbnails.get(fileId);
  if (existing) return existing;
  const pending = loadOrCreateThumbnail(record);
  pendingThumbnails.set(fileId, pending);
  try {
    return await pending;
  } finally {
    pendingThumbnails.delete(fileId);
  }
}

export async function loadOrCreateThumbnail(record) {
  const thumbnailKey = `${record.objectKey}.thumb.jpg`;
  try {
    const body = await readStorageObject(record, thumbnailKey);
    return { record, body, mimeType: "image/jpeg" };
  } catch (error) {
    if (!isMissingStorageObject(error)) throw error;
  }

  const original = await readStorageObject(record, record.objectKey);
  const thumbnail = await createImageThumbnail(original);
  if (!thumbnail || thumbnail.byteLength >= original.byteLength) {
    return { record, body: original, mimeType: record.mimeType };
  }
  await putDerivedObject(record, thumbnailKey, thumbnail);
  return { record, body: thumbnail, mimeType: "image/jpeg" };
}

async function readStorageObject(record, objectKey) {
  if (record.storageProvider === "oss") {
    const result = await getOssClient().get(objectKey);
    return result.content;
  }

  if (record.storageProvider !== "local") throw new HttpError(500, "不支持的图片存储服务");
  return fs.readFile(resolveLocalObjectPath(objectKey));
}

function resolveLocalObjectPath(objectKey) {
  const uploadRoot = getLocalUploadRoot();
  const target = path.resolve(uploadRoot, objectKey);
  const relative = path.relative(uploadRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "文件路径非法");
  return target;
}

async function putDerivedObject(record, objectKey, body) {
  if (record.storageProvider === "oss") {
    await getOssClient().put(objectKey, body, { headers: { "Content-Type": "image/jpeg" } });
    return;
  }
  const target = resolveLocalObjectPath(objectKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

function isMissingStorageObject(error) {
  return error?.code === "ENOENT" || error?.code === "NoSuchKey" || error?.code === "NoSuchObject" || error?.status === 404 || error?.statusCode === 404;
}

async function putObject(objectKey, buffer, mimeType) {
  const provider = resolveStorageProvider();
  const bucket = process.env.OSS_BUCKET;
  if (provider === "oss") {
    const client = getOssClient();
    await client.put(objectKey, buffer, {
      headers: {
        "Content-Type": mimeType
      }
    });
    return { provider: "oss", bucket, objectKey };
  }

  const uploadRoot = getLocalUploadRoot();
  const target = path.join(uploadRoot, objectKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { provider: "local", bucket: "local", objectKey };
}

export function resolveStorageProvider(env = process.env) {
  const configuredProvider = String(env.FILE_STORAGE_PROVIDER || "").trim().toLowerCase();
  if (configuredProvider && configuredProvider !== "local" && configuredProvider !== "oss") {
    throw new HttpError(500, "FILE_STORAGE_PROVIDER 仅支持 local 或 oss");
  }
  if (configuredProvider) return configuredProvider;
  if (env.OSS_BUCKET) return "oss";
  if (env.APP_ENV === "production") {
    throw new HttpError(500, "生产环境请配置 FILE_STORAGE_PROVIDER=local 或 oss");
  }
  return "local";
}

function getLocalUploadRoot() {
  return path.resolve(process.env.LOCAL_UPLOAD_ROOT || "server/data/uploads");
}

function getOssClient() {
  if (ossClient) return ossClient;
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  if (!accessKeyId || !accessKeySecret || !bucket) throw new HttpError(500, "未配置 OSS 上传参数");

  ossClient = new OSS({
    region: process.env.OSS_REGION || "oss-cn-hangzhou",
    accessKeyId,
    accessKeySecret,
    bucket
  });
  return ossClient;
}

function buildObjectKey({ orderId, kind, fileName }) {
  const date = new Date().toISOString().slice(0, 10);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scope = orderId ? `work-orders/${orderId}` : `drafts/${date}`;
  return `shops/shop-hq/${scope}/${kind}/${id}-${fileName}`;
}

function sanitizeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.jpg";
}

function stripDataUrlPrefix(value) {
  const index = value.indexOf(",");
  return value.startsWith("data:") && index >= 0 ? value.slice(index + 1) : value;
}
