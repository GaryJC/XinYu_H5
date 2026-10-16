import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createImageThumbnail } from "../server/images/thumbnail.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { loadOrCreateThumbnail } = await import("../server/storage.mjs");

test("existing photos produce smaller, bounded JPEG thumbnails", async () => {
  const original = await fs.readFile(new URL("../client/public/photo-guides/rear45-illustrated.jpg", import.meta.url));
  const thumbnail = await createImageThumbnail(original);
  assert.ok(thumbnail);
  assert.ok(thumbnail.length < original.length);
  const metadata = await sharp(thumbnail).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.ok(metadata.width <= 360);
  assert.ok(metadata.height <= 360);
});

test("unsupported image bytes leave the original available", async () => {
  assert.equal(await createImageThumbnail(Buffer.from("not-an-image")), null);
});

test("transparent signature thumbnails use a white background", async () => {
  const original = await sharp({
    create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();
  const thumbnail = await createImageThumbnail(original);
  const pixel = await sharp(thumbnail).raw().toBuffer();
  assert.ok(pixel[0] > 245 && pixel[1] > 245 && pixel[2] > 245);
});

test("stored thumbnails are reused without reading the original again", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repair-thumbnail-"));
  const previousRoot = process.env.LOCAL_UPLOAD_ROOT;
  process.env.LOCAL_UPLOAD_ROOT = root;
  const record = {
    id: "photo-1", objectKey: "orders/photo.jpg",
    storageProvider: "local", mimeType: "image/jpeg"
  };
  try {
    const original = await fs.readFile(new URL("../client/public/photo-guides/rear45-illustrated.jpg", import.meta.url));
    const target = path.join(root, record.objectKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, original);
    const first = await loadOrCreateThumbnail(record);
    assert.equal(first.mimeType, "image/jpeg");
    assert.ok(first.body.length < original.length);
    await fs.unlink(target);
    const second = await loadOrCreateThumbnail(record);
    assert.deepEqual(second.body, first.body);
  } finally {
    if (previousRoot === undefined) delete process.env.LOCAL_UPLOAD_ROOT;
    else process.env.LOCAL_UPLOAD_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});
