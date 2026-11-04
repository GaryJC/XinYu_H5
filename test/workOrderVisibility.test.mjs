import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { deleteDraftWorkOrder, roleFilter, sanitizeVisibleOrders } = await import("../server/db.mjs");

test("service advisors list all work orders within their shop", () => {
  assert.deepEqual(roleFilter("advisor", { name: "张三", shopId: "shop-hq" }), { where: "where wo.shop_id = $1", params: ["shop-hq"] });
});

test("other advisors' signature session tokens are not exposed in the shared list", () => {
  const own = { id: "own", shop: { id: "s" }, advisor: "张三", signatureToken: "sig-own", signatureTokenUsed: false };
  const other = { id: "other", shop: { id: "s" }, advisor: "李四", signatureToken: "sig-other", signatureTokenUsed: false };
  const visible = sanitizeVisibleOrders([own, other], "advisor", { name: "张三", shopId: "s" });
  assert.equal(visible[0].signatureToken, "sig-own");
  assert.equal(visible[1].signatureToken, undefined);
  assert.equal(visible[1].signatureTokenUsed, undefined);
});

test("cross-shop read access never exposes signing tokens, even to managers or namesakes", () => {
  const foreign = { shop: { id: "other" }, advisor: "张三", signatureToken: "secret", signatureTokenUsed: false };
  for (const role of ["manager", "advisor", "technician"]) {
    const [visible] = sanitizeVisibleOrders([foreign], role, { role, name: "张三", shopId: "s" });
    assert.equal(visible.signatureToken, undefined);
    assert.equal(visible.signatureTokenUsed, undefined);
  }
  const [local] = sanitizeVisibleOrders([{ ...foreign, shop: { id: "s" } }], "advisor", { role: "advisor", roles: ["advisor", "manager"], name: "其他人", shopId: "s" });
  assert.equal(local.signatureToken, "secret", "all current memberships apply within the shop");
  assert.equal(sanitizeVisibleOrders([{ signatureToken: "secret" }], "advisor", {})[0].signatureToken, undefined);
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
