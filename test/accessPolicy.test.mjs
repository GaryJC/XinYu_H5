import assert from "node:assert/strict";
import test from "node:test";
import { requireAnyRole, requireAuthenticatedUser, requireTransitionRole } from "../server/domain/accessPolicy.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

test("business APIs reject unauthenticated requests", () => {
  assert.throws(
    () => requireAuthenticatedUser(null),
    (error) => error instanceof HttpError && error.status === 401
  );
});

test("manager-only operations reject an advisor", () => {
  assert.throws(
    () => requireAnyRole({ role: "advisor" }, ["manager"]),
    (error) => error instanceof HttpError && error.status === 403
  );
});

test("advisor can only perform the two MVP workflow transitions", () => {
  const advisor = { role: "advisor" };
  assert.equal(requireTransitionRole(advisor, "待派工"), advisor);
  assert.equal(requireTransitionRole(advisor, "完成"), advisor);
  assert.throws(() => requireTransitionRole(advisor, "维修中"), (error) => error.status === 403);
});
