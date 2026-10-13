import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { recognizeVehicleLicenseInput } = await import("../server/services/vehicleLicenseOcr.mjs");

test("saved vehicle license uses an authorized signed URL without another image upload", async () => {
  const user = { id: "advisor-1", role: "advisor" };
  const calls = [];
  const result = await recognizeVehicleLicenseInput({ fileId: "file-1" }, user, {
    authorize: async (id, actor) => { assert.equal(actor, user); calls.push(`authorize:${id}`); },
    getSource: async (id) => { calls.push(`source:${id}`); return { url: "https://example.test/private-image?signature=test" }; },
    recognize: async (image, url) => {
      assert.equal(image, undefined);
      assert.equal(url, "https://example.test/private-image?signature=test");
      calls.push("recognize");
      return { plate: "辽A12345" };
    }
  });
  assert.deepEqual(calls, ["authorize:file-1", "source:file-1", "recognize"]);
  assert.deepEqual(result, { plate: "辽A12345" });
});

test("unauthorized file never reaches storage or the OCR provider", async () => {
  await assert.rejects(() => recognizeVehicleLicenseInput({ fileId: "other-user-file" }, {}, {
    authorize: async () => { throw new HttpError(403, "无权访问该文件"); },
    getSource: () => assert.fail("must not read unauthorized files"),
    recognize: () => assert.fail("must not send unauthorized images")
  }), (error) => error.status === 403);
});

test("explicit local storage can reuse the saved bytes", async () => {
  await recognizeVehicleLicenseInput({ fileId: "local-file" }, {}, {
    authorize: async () => {},
    getSource: async () => ({ imageBase64: "saved-image" }),
    recognize: async (image, url) => { assert.equal(image, "saved-image"); assert.equal(url, undefined); }
  });
});

test("existing imageBase64 callers remain compatible", async () => {
  await recognizeVehicleLicenseInput({ imageBase64: "original-image" }, {}, {
    authorize: () => assert.fail("base64 callers do not reference a file"),
    getSource: () => assert.fail("base64 callers do not read storage"),
    recognize: async (image) => assert.equal(image, "original-image")
  });
});

test("invalid and ambiguous file inputs are rejected before storage access", async () => {
  for (const input of [null, {}, { fileId: "" }, { fileId: 123 }, { fileId: "file-1", imageBase64: "data" }]) {
    await assert.rejects(() => recognizeVehicleLicenseInput(input, {}, {
      authorize: () => assert.fail("invalid input must not reach authorization"),
      getSource: () => assert.fail("invalid input must not reach storage"),
      recognize: async (image) => { if (!image) throw new HttpError(400, "请上传行驶证照片"); }
    }), (error) => error.status === 400);
  }
});
