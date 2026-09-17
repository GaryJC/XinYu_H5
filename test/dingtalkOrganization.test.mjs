import assert from "node:assert/strict";
import test from "node:test";
import definitions from "../shared/dingtalkRoles.json" with { type: "json" };
import { normalizeDingTalkUserProfile, resolveDingTalkOrganizationMapping as resolve } from "../server/integrations/dingtalk/organization.mjs";

const profile = (names) => normalizeDingTalkUserProfile({
  userid: "employee", name: "员工", active: true, dept_id_list: [123],
  role_list: names.map((name, index) => ({ id: index + 1, name }))
}, "fallback");

test("normalizes DingTalk identity, department and role IDs", () => {
  const user = profile(["维修工"]);
  assert.equal(user.userId, "employee");
  assert.deepEqual(user.departmentIds, ["123"]);
  assert.deepEqual(user.roles, [{ id: "1", name: "维修工" }]);
});

test("every documented role name enters its designated workflow without configuration", () => {
  for (const definition of definitions) {
    for (const name of definition.names) {
      const result = resolve(profile([name]));
      assert.equal(result.role, definition.role, name);
      assert.equal(result.homeRoute, definition.homeRoute, name);
      assert.equal(result.shopId, "shop-hq");
    }
  }
});

test("old ID and department rules cannot deny or override a named role", () => {
  const result = resolve(profile(["维修工"]), {
    roleMappings: [{ dingtalkRoleId: "1", appRole: "manager", enabled: false }],
    departmentMappings: [{ dingtalkDepartmentId: "123", shopId: "other", enabled: true }]
  });
  assert.equal(result.role, "technician");
  assert.equal(result.shopId, "shop-hq");
  assert.equal(resolve(profile(["自定义员工"]), {
    roleMappings: [{ dingtalkRoleId: "1", appRole: "manager", enabled: true }]
  }), undefined);
});

test("missing roles, job titles and role group names do not grant access", () => {
  assert.equal(resolve(profile([])), undefined);
  assert.equal(resolve(profile(["普通员工"])), undefined);
  const user = normalizeDingTalkUserProfile({
    title: "门店管理员",
    role_list: [{ id: 1, group_name: "门店管理员" }]
  }, "employee");
  assert.equal(resolve(user), undefined);
});

test("preserves existing store ownership regardless of department or role changes", () => {
  assert.equal(resolve(profile(["门店管理员"]), { shopId: "existing-shop" }).shopId, "existing-shop");
});

test("multiple roles resolve by explicit priority independent of response order", () => {
  const names = ["维修技师", "检验员", "调度员", "门店管理员"];
  const roles = ["technician", "inspector", "advisor", "manager"];
  for (let i = 1; i <= names.length; i++) {
    assert.equal(resolve(profile(names.slice(0, i))).role, roles[i - 1]);
    assert.equal(resolve(profile(names.slice(0, i).reverse())).role, roles[i - 1]);
  }
  assert.equal(resolve(profile([" 维修工 "])).role, "technician");
});
