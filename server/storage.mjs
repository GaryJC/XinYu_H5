import fs from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import { HttpError, createFileRecord } from "./db.mjs";

let ossClient;

export async function saveUploadedFile({ orderId, kind, fileName, mimeType, imageBase64, uploadedBy }) {
  if (!imageBase64 || typeof imageBase64 !== "string") throw new HttpError(400, "缺少文件内容");
  if (!kind || typeof kind !== "string") throw new HttpError(400, "缺少文件类型");

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

async function putObject(objectKey, buffer, mimeType) {
  const bucket = process.env.OSS_BUCKET;
  if (bucket) {
    const client = getOssClient();
    await client.put(objectKey, buffer, {
      headers: {
        "Content-Type": mimeType
      }
    });
    return { provider: "oss", bucket, objectKey };
  }

  const uploadRoot = path.resolve("server/data/uploads");
  const target = path.join(uploadRoot, objectKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { provider: "local", bucket: "local", objectKey };
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
