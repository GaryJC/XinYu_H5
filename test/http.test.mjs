import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";
import { readJson } from "../server/http/response.mjs";
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
