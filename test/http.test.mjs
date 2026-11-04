import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";
import { readJson, sendError } from "../server/http/response.mjs";
import { contentType } from "../server/http/staticFiles.mjs";

test("contentType returns production-safe MIME types", () => {
  assert.equal(contentType("index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("assets/app.js"), "text/javascript; charset=utf-8");
  assert.equal(contentType("assets/app.css"), "text/css; charset=utf-8");
  assert.equal(contentType("assets/photo.webp"), "image/webp");
});

test("readJson parses a JSON request body", async () => {
  const request = Readable.from([Buffer.from('{"ok":true}')]);
  assert.deepEqual(await readJson(request), { ok: true });
});

test("readJson rejects malformed JSON with a client error", async () => {
  const request = Readable.from([Buffer.from("{broken")]);
  await assert.rejects(
    () => readJson(request),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("JSON API bodies must be objects rather than null, arrays or primitives", async () => {
  for (const body of ["null", "[]", "42", "true", '"text"']) {
    await assert.rejects(() => readJson(Readable.from([Buffer.from(body)])), error => error.status === 400);
  }
  assert.deepEqual(await readJson(Readable.from([])), {});
});

test("unexpected server errors do not expose SQL, paths or credentials to clients", () => {
  let body;
  const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
  sendError(res, new Error('connection failed postgres://secret@internal; select * from auth_sessions'));
  assert.equal(res.statusCode, 500);
  assert.equal(body.error, "服务器处理失败，请稍后重试");
  sendError(res, new HttpError(409, "工单已更新，请刷新"));
  assert.equal(res.statusCode, 409);
  assert.equal(body.error, "工单已更新，请刷新");
});
