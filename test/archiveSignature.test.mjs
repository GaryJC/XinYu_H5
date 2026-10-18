import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const filename = new URL("../client/src/features/signature/useArchiveSignature.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const user = { role: "advisor", name: "张三", shopId: "shop-hq" };
const pending = { shop: { id: "shop-hq" }, id: "old-order", advisor: "张三", status: "待客户签字", signatureToken: "old-token", signatures: {}, customer: { name: "车主" } };

function setup(api = {}, account = user) {
  const state = [], updates = [];
  let summaryRefreshes = 0;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === "react") return {
      useState(initial) { const i = state.length; state.push(initial); return [initial, value => { state[i] = value; }]; },
      useRef(value) { return { current: value }; }
    };
    if (name.endsWith("workOrderApi")) return { workOrderApi: api };
    throw new Error(`Unexpected import ${name}`);
  }});
  const actions = exports.useArchiveSignature(account, order => updates.push(order), () => { summaryRefreshes++; });
  return { actions, state, updates, get summaryRefreshes() { return summaryRefreshes; } };
}

test("archive resumes the saved order token and uploads its signature to that exact order", async () => {
  const calls = [];
  const signed = { ...pending, status: "已委托", signatures: { customer: "车主" } };
  const h = setup({
    async findByToken(token) { calls.push(["find", token]); return pending; },
    async uploadFile(file) { calls.push(["upload", file.orderId, file.imageBase64]); return { id: "signature-file" }; },
    async signByToken(...args) { calls.push(["sign", ...args]); return signed; }
  });
  await h.actions.start(pending);
  assert.equal(h.state[0].order.id, "old-order");
  await h.actions.completeSignature(h.state[0].order, h.state[0].token, "drawn-signature");
  assert.deepEqual(calls, [["find", "old-token"], ["upload", "old-order", "drawn-signature"], ["sign", "old-token", "车主", "signature-file"]]);
  assert.equal(h.updates.at(-1), signed);
  assert.equal(h.summaryRefreshes, 1);
});

test("archive starts a draft from its persisted ID without saving or replacing the editor draft", async () => {
  const calls = [];
  const h = setup({ async createSignatureToken(...args) { calls.push(args); return pending; } });
  await h.actions.start({ ...pending, status: "草稿", signatureToken: undefined });
  assert.deepEqual(calls, [["old-order", "张三"]]);
  assert.equal(h.state[0].token, "old-token");
});

test("archive permits the owning advisor or manager and hides signing for signed orders", () => {
  const h = setup();
  assert.equal(h.actions.canSign(pending), true);
  assert.equal(h.actions.canSign({ ...pending, advisor: "李四" }), false);
  assert.equal(h.actions.canSign({ ...pending, signatures: { customer: "已签字" } }), false);
  assert.equal(h.actions.canSign({ ...pending, status: "已委托" }), false);
  assert.equal(setup({}, { role: "manager", name: "经理", shopId: "shop-hq" }).actions.canSign(pending), true);
  assert.equal(setup({}, { role: "technician", name: "张三" }).actions.canSign(pending), false);
});

test("stale sessions and server validation failures stay visible and do not open a signing dialog", async () => {
  for (const result of [undefined, { ...pending, id: "another-order" }, { ...pending, signatureTokenUsed: true }, { ...pending, status: "已委托" }]) {
    const h = setup({ async findByToken() { return result; } });
    await h.actions.start(pending);
    assert.equal(h.state[0], undefined);
    assert.match(h.state[1], /签字会话/);
    assert.equal(h.updates.length, 0);
  }
  const h = setup({ async createSignatureToken() { throw new Error("请完善必填项"); } });
  await h.actions.start({ ...pending, status: "草稿" });
  assert.equal(h.state[0], undefined);
  assert.ok(h.state[1]);
});

test("repeated clicks create only one signature request while a request is pending", async () => {
  let resolve, count = 0;
  const h = setup({ findByToken() { count++; return new Promise(done => { resolve = done; }); } });
  const first = h.actions.start(pending);
  await h.actions.start(pending);
  assert.equal(count, 1);
  resolve(pending);
  await first;
  assert.equal(h.state[0].token, "old-token");
});

test("upload failures never submit a signature or refresh the order", async () => {
  let signs = 0;
  const h = setup({ async uploadFile() { throw new Error("上传失败"); }, async signByToken() { signs++; } });
  await assert.rejects(h.actions.completeSignature(pending, pending.signatureToken, "image"), /上传失败/);
  assert.equal(signs, 0);
  assert.equal(h.updates.length, 0);
  assert.equal(h.summaryRefreshes, 0);
});

test("paper orders and cross-shop records never offer electronic signing",()=>{
  const h=setup();
  assert.equal(h.actions.canSign({...pending,paperOrder:{mode:"dingtalk",photoIds:["photo"]}}),false);
  assert.equal(h.actions.canSign({...pending,shop:{id:"other"}}),false);
});
