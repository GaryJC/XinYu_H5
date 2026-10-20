import assert from "node:assert/strict";
import test from "node:test";
process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "employee-binding-test-secret";
const { pool } = await import("../server/database/pool.mjs");
const { createTokenForUser } = await import("../server/auth.mjs");
const { handleApiRequest } = await import("../server/routes/apiRouter.mjs");
test("unbound authenticated technicians can read identity but cannot reach any business router", async t => {
  t.mock.method(pool, "query", async sql => {
    if (sql.includes("auth_sessions")) return { rows: [{ id: "session" }] };
    if (sql.includes("from users where id")) return { rows: [{ id: "u", name: "李富强", role: "technician", active: true, shop_id: "shop-hq" }] };
    assert.fail(`Unexpected business query: ${sql}`);
  });
  const req = { method: "GET", headers: { authorization: `Bearer ${createTokenForUser("u")}` } };
  let body;
  const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
  assert.equal(await handleApiRequest(req, res, new URL("http://local/api/auth/me")), true);
  assert.equal(body.name, "李富强");
  for (const route of ["/api/dispatch/tasks", "/api/work-orders", "/api/users", "/api/files/example"]) {
    await assert.rejects(() => handleApiRequest(req, res, new URL(`http://local${route}`)), e => e.status === 403 && e.message.includes("员工编码"));
  }
});
