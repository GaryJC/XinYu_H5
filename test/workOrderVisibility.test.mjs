import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { deleteDraftWorkOrder, roleFilter, sanitizeVisibleOrders } = await import("../server/db.mjs");

test("service advisors list all work orders", () => {
  assert.deepEqual(roleFilter("advisor", { name: "张三" }), { where: "", params: [] });
});

test("other advisors' signature session tokens are not exposed in the shared list", () => {
  const own = { id: "own", advisor: "张三", signatureToken: "sig-own", signatureTokenUsed: false };
  const other = { id: "other", advisor: "李四", signatureToken: "sig-other", signatureTokenUsed: false };
  const visible = sanitizeVisibleOrders([own, other], "advisor", { name: "张三" });
  assert.equal(visible[0].signatureToken, "sig-own");
  assert.equal(visible[1].signatureToken, undefined);
  assert.equal(visible[1].signatureTokenUsed, undefined);
});

test("only draft work orders can be deleted", async () => {
  const draftClient = fakeDeleteClient("草稿");
  assert.deepEqual(
    await deleteDraftWorkOrder("WT-20260817-ABC123DEF456", async (work) => work(draftClient)),
    { id: "WT-20260817-ABC123DEF456" }
  );
  assert.match(draftClient.calls[1].query, /delete from work_orders/i);

  const signedClient = fakeDeleteClient("已委托");
  await assert.rejects(
    () => deleteDraftWorkOrder("WT-20260817-SIGNED123456", async (work) => work(signedClient)),
    (error) => error instanceof HttpError && error.status === 409
  );
  assert.equal(signedClient.calls.length, 1);
});

function fakeDeleteClient(status) {
  const calls = [];
  return {
    calls,
    async query(query, params) {
      calls.push({ query, params });
      if (calls.length === 1) return { rows: [{ id: params[0], status }] };
      return { rows: [{ id: params[0] }] };
    }
  };
}
