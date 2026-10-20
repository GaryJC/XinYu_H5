import assert from "node:assert/strict";
import test from "node:test";
import { createEmployeeBindingService, assertEmployeeBound } from "../server/domain/employeeBinding.mjs";
process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:1/unused";
const { saveEmployeeBinding } = await import("../server/repositories/employeeBindingRepository.mjs");
const { findLegacyEmployeesByName, FIND_LEGACY_EMPLOYEES_QUERY } = await import("../server/repositories/legacyEmployeeRepository.mjs");
const user = { id: "ding-user", name: "李富强", role: "technician", active: true };
const employee = (code, departmentCode = "A") => ({ code, name: "李富强", departmentCode, departmentName: departmentCode, status: "在职" });
function setup(found) {
  const saves = [];
  let lookups = 0;
  const service = createEmployeeBindingService({ findEmployees: async name => { assert.equal(name, user.name); lookups++; return found; }, saveBinding: async (id, e) => { saves.push({ id, employee: e }); return e.code; } });
  return { service, saves, lookups: () => lookups };
}
test("a unique active same-name mechanic is automatically persisted", async () => {
  const { service, saves } = setup([employee("027")]);
  const result = await service.status(user);
  assert.equal(result.required, false); assert.equal(result.employeeCode, "027");
  assert.deepEqual(saves, [{ id: user.id, employee: employee("027") }]);
});
test("three same-name employees require explicit selection; the selected department is saved", async () => {
  const found = [employee("027"), employee("021", "B"), employee("013", "M")];
  const { service, saves } = setup(found);
  assert.deepEqual(await service.status(user), { required: true, candidates: found });
  assert.equal(saves.length, 0);
  assert.equal((await service.confirm(user, "013")).employeeCode, "013");
  assert.equal(saves[0].employee.departmentCode, "M");
});
test("saved bindings survive later logins and do not query Runfeng again", async () => {
  const { service, lookups } = setup([]);
  const bound = { ...user, legacyEmployeeCode: "027" };
  assert.equal((await service.status(bound)).employeeCode, "027");
  assert.equal((await service.confirm(bound, "027")).required, false);
  await assert.rejects(() => service.confirm(bound, "021"), e => e.status === 409);
  assert.equal(lookups(), 0); assert.doesNotThrow(() => assertEmployeeBound(bound));
});
test("no match, nonmatching names and departed workers do not unlock access", async () => {
  const { service, saves } = setup([{ ...employee("027"), status: "离职" }, { ...employee("021"), name: "其他员工" }]);
  assert.deepEqual(await service.status(user), { required: true, candidates: [] });
  await assert.rejects(() => service.confirm(user, "027"), e => e.status === 400);
  assert.equal(saves.length, 0); assert.throws(() => assertEmployeeBound(user), e => e.status === 403);
});
test("confirmation re-queries candidates and rejects arbitrary or removed employee codes", async () => {
  const { service, saves } = setup([employee("027"), employee("021")]);
  await assert.rejects(() => service.confirm(user, "013"), e => e.status === 400);
  await assert.rejects(() => service.confirm(user, undefined), e => e.status === 400);
  assert.equal(saves.length, 0);
});
test("Runfeng failure and duplicate codes fail closed without persistence", async () => {
  const { service, saves } = setup([employee("027"), employee("027", "B")]);
  await assert.rejects(() => service.status(user), e => e.status === 409); assert.equal(saves.length, 0);
  const unavailable = createEmployeeBindingService({ findEmployees: async () => { throw new Error("credentials must not leak"); }, saveBinding: async () => assert.fail() });
  await assert.rejects(() => unavailable.status(user), e => e.status === 503 && !e.message.includes("credentials"));
});
test("other roles do not need binding and cannot self-bind", async () => {
  const { service, lookups } = setup([]);
  for (const role of ["advisor", "manager", "warehouse", "inspector"]) {
    const actor = { ...user, role };
    assert.equal((await service.status(actor)).required, false);
    assert.doesNotThrow(() => assertEmployeeBound(actor));
    await assert.rejects(() => service.confirm(actor, "027"), e => e.status === 403);
  }
  assert.equal(lookups(), 0);
});
test("SQL candidate lookup filters active mechanics and parameterizes the authenticated name", async () => {
  assert.match(FIND_LEGACY_EMPLOYEES_QUERY, /e\.wxg = 1/);
  assert.match(FIND_LEGACY_EMPLOYEES_QUERY, /RTRIM\(e\.zt\) = N'在职'/);
  let parameter;
  const result = await findLegacyEmployeesByName("李富强", async (query, configure) => {
    configure({ input: (...args) => { parameter = args; } }, { NVarChar: n => n });
    return { recordset: [{ code: "027  ", name: "李富强 ", department_code: "A ", department_name: "机电一部 ", status: "在职 " }] };
  });
  assert.deepEqual(parameter, ["name", 100, "李富强"]);
  assert.equal(result[0].code, "027"); assert.equal(result[0].status, "在职");
});
test("concurrent identical confirmation is idempotent; a conflicting binding is never overwritten", async () => {
  const queries = [];
  const db = { query: async (sql, params) => { queries.push([sql, params]); return { rows: sql.includes("update users") ? [] : [{ legacy_employee_code: "027" }] }; } };
  assert.equal(await saveEmployeeBinding(user.id, employee("027"), db), "027");
  assert.match(queries[0][0], /legacy_employee_code is null/);
  await assert.rejects(() => saveEmployeeBinding(user.id, employee("021"), db), e => e.status === 409);
});
