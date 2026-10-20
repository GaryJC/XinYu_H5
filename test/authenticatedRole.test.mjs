import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule(relativePath, dependencies) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(name) {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  } });
  return exports;
}

const { roles } = loadModule("../client/src/features/work-orders/domain/workOrderDomain.ts", {
  "../../dispatch/dispatchAvailability": { dispatchEnabled: false },
  "./repairItems": {}
});

function setup(response) {
  const savedTokens = [];
  const { workOrderApi } = loadModule("../client/src/features/work-orders/api/workOrderApi.ts", {
    "../../../shared/api/httpClient": {
      request: async () => response,
      setAuthToken: token => savedTokens.push(token)
    },
    "../../dispatch/dispatchAvailability": { dispatchEnabled: false },
    "../domain/workOrderDomain": { roles }
  });
  return { api: workOrderApi, savedTokens };
}

test("restoring an unsupported session rejects it before the role reaches the workbench", async () => {
  for (const role of ["unknown", "constructor", "__proto__", undefined]) {
    const { api } = setup({ id: "old-session", name: "测试用户", role });
    await assert.rejects(api.me(), /岗位尚未在此版本开放/);
  }
  await assert.rejects(setup(null).api.me(), /岗位尚未在此版本开放/);
});

test("all configured workbench roles can restore their session", async () => {
  for (const role of Object.keys(roles)) {
    const user = { id: "test-user", name: "测试用户", role };
    assert.equal(await setup(user).api.me(), user);
  }
});

test("neither login flow persists a token for an unsupported role", async () => {
  for (const method of ["loginWithDingTalk", "loginForDevelopment"]) {
    const { api, savedTokens } = setup({ token: "unsupported-token", user: { role: "unknown" } });
    await assert.rejects(api[method]("test"), /岗位尚未在此版本开放/);
    assert.deepEqual(savedTokens, []);
  }
});

test("supported logins still save their token and return the authenticated user", async () => {
  for (const method of ["loginWithDingTalk", "loginForDevelopment"]) {
    const response = { token: "test-token", user: { id: "test-user", role: "warehouse" } };
    const { api, savedTokens } = setup(response);
    assert.equal(await api[method]("test"), response);
    assert.deepEqual(savedTokens, ["test-token"]);
  }
});
