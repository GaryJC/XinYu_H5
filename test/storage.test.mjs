import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { resolveStorageProvider, validateUploadedImageMetadata } = await import("../server/storage.mjs");

test("uploaded files are limited to known raster image formats", () => {
  assert.doesNotThrow(() => validateUploadedImageMetadata("vehicle_license", "image/jpeg"));
  assert.doesNotThrow(() => validateUploadedImageMetadata("signature_image", "image/png"));
  assert.throws(
    () => validateUploadedImageMetadata("other", "text/html"),
    (error) => error instanceof HttpError && error.status === 400
  );
  assert.throws(
    () => validateUploadedImageMetadata("unknown_kind", "image/png"),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("production may explicitly use local file storage without OSS", () => {
  assert.equal(resolveStorageProvider({ APP_ENV: "production", FILE_STORAGE_PROVIDER: "local" }), "local");
});

test("an existing OSS bucket remains backward compatible", () => {
  assert.equal(resolveStorageProvider({ APP_ENV: "production", OSS_BUCKET: "example" }), "oss");
});

test("production storage selection must be explicit when OSS is absent", () => {
  assert.throws(
    () => resolveStorageProvider({ APP_ENV: "production" }),
    (error) => error instanceof HttpError && error.status === 500 && error.message.includes("FILE_STORAGE_PROVIDER")
  );
});
