import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLicensePlateOcr, normalizeVinOcr } from "../server/ocr.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

test("normalizes the nested Aliyun license plate response", () => {
  assert.deepEqual(
    normalizeLicensePlateOcr(JSON.stringify({ data: { licensePlateNumber: "辽 A12345" } })),
    { value: "辽A12345", confidence: 0 }
  );
});

test("normalizes an Aliyun VIN response with value metadata", () => {
  assert.deepEqual(
    normalizeVinOcr(JSON.stringify({ vinCode: { value: "lsvcy6c49mn027789", confidence: 0.98 } })),
    { value: "LSVCY6C49MN027789", confidence: 0.98 }
  );
});

test("identifier OCR rejects a response without a recognized value", () => {
  assert.throws(
    () => normalizeVinOcr(JSON.stringify({ data: {} })),
    (error) => error instanceof HttpError && error.status === 422
  );
});
