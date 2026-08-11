import fs from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import { HttpError } from "./http/HttpError.mjs";
import { createFileRecord, findFileRecord } from "./repositories/fileRepository.mjs";

let ossClient;

const allowedFileKinds = new Set(["vehicle_license", "repair_order_photo", "damage_photo", "signature_image", "other"]);
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

export async function saveUploadedFile({ orderId, kind, fileName, mimeType, imageBase64, uploadedBy }) {
  if (!imageBase64 || typeof imageBase64 !== "string") throw new HttpError(400, "缺少文件内容");
  validateUploadedImageMetadata(kind, mimeType);

  const buffer = Buffer.from(stripDataUrlPrefix(imageBase64), "base64");
  if (!buffer.length) throw new HttpError(400, "文件内容为空");

  const safeName = sanitizeFileName(fileName || `upload-${Date.now()}.jpg`);
  const objectKey = buildObjectKey({ orderId, kind, fileName: safeName });
  const storage = await putObject(objectKey, buffer, mimeType || "application/octet-stream");

  return createFileRecord({
    orderId: orderId || null,
    kind,
    storageProvider: storage.provider,
    bucket: storage.bucket,
    objectKey: storage.objectKey,
    originalName: safeName,
    mimeType: mimeType || "application/octet-stream",
    sizeBytes: buffer.length,
    uploadedBy: uploadedBy || null
  });
}

export function validateUploadedImageMetadata(kind, mimeType) {
  if (!kind || typeof kind !== "string") throw new HttpError(400, "缺少文件类型");
  if (!allowedFileKinds.has(kind)) throw new HttpError(400, "不支持的文件类型");
  if (!mimeType || typeof mimeType !== "string") throw new HttpError(400, "缺少图片 MIME 类型");
  if (!allowedImageMimeTypes.has(mimeType.toLowerCase())) throw new HttpError(400, "仅支持安全的图片格式");
}

export async function readStoredFile(fileId) {
  const record = await findFileRecord(fileId);
  if (record.storageProvider === "oss") {
    const result = await getOssClient().get(record.objectKey);
    return { record, body: result.content };
  }

  const uploadRoot = getLocalUploadRoot();
  const target = path.resolve(uploadRoot, record.objectKey);
  const relative = path.relative(uploadRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new HttpError(403, "文件路径非法");
  return { record, body: await fs.readFile(target) };
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
