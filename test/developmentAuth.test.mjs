import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { loginForDevelopment } = await import("../server/auth.mjs");

test("development login is unavailable unless both server guards are enabled", { concurrency: false }, async () => {
  const previousAppEnv = process.env.APP_ENV;
  const previousEnabled = process.env.ENABLE_DEV_AUTH;
  process.env.APP_ENV = "production";
  process.env.ENABLE_DEV_AUTH = "false";
  try {
    await assert.rejects(
      () => loginForDevelopment("advisor"),
      (error) => error instanceof HttpError && error.status === 404
    );
  } finally {
    restoreEnv("APP_ENV", previousAppEnv);
    restoreEnv("ENABLE_DEV_AUTH", previousEnabled);
  }
});

test("unassigned development persona is denied before a session is created", { concurrency: false }, async () => {
  const previousAppEnv = process.env.APP_ENV;
  const previousEnabled = process.env.ENABLE_DEV_AUTH;
  process.env.APP_ENV = "development";
  process.env.ENABLE_DEV_AUTH = "true";
  try {
    await assert.rejects(
      () => loginForDevelopment("unassigned"),
      (error) => error instanceof HttpError && error.status === 403 && error.message.includes("未分配")
    );
  } finally {
    restoreEnv("APP_ENV", previousAppEnv);
    restoreEnv("ENABLE_DEV_AUTH", previousEnabled);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
