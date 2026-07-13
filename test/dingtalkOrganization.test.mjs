import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDingTalkUserProfile, resolveDingTalkOrganizationMapping } from "../server/integrations/dingtalk/organization.mjs";

test("normalizes DingTalk department and role data from the employee detail response", () => {
  const profile = normalizeDingTalkUserProfile({
    userid: "ding-user-1",
    name: "李顾问",
    mobile: "13800000000",
    active: true,
    dept_id_list: [1001],
    role_list: [{ id: 2001, name: "服务顾问" }]
  }, "fallback-user");

  assert.deepEqual(profile, {
    userId: "ding-user-1",
    name: "李顾问",
    phone: "13800000000",
    active: true,
    departmentIds: ["1001"],
    roles: [{ id: "2001", name: "服务顾问" }]
  });
});

test("role mapping chooses the app role while department mapping chooses the shop", () => {
  const mapping = resolveDingTalkOrganizationMapping(
    {
      userId: "ding-user-1",
      name: "李顾问",
      active: true,
      departmentIds: ["1001"],
      roles: [{ id: "2001", name: "服务顾问" }]
    },
    {
      roleMappings: [{
        dingtalkRoleId: "2001",
        dingtalkRoleName: "服务顾问",
        appRole: "advisor",
        homeRoute: "order-create",
        enabled: true
      }],
      departmentMappings: [{
        dingtalkDepartmentId: "1001",
        dingtalkDepartmentName: "抚顺路店",
        shopId: "shop-hq",
        enabled: true
      }]
    }
  );

  assert.deepEqual(mapping, {
    role: "advisor",
    shopId: "shop-hq",
    homeRoute: "order-create",
    source: { dingtalkRoleId: "2001", dingtalkDepartmentId: "1001" }
  });
});

test("does not resolve an employee when there is no enabled role mapping", () => {
  const mapping = resolveDingTalkOrganizationMapping(
    { userId: "ding-user-1", name: "李顾问", active: true, departmentIds: ["1001"], roles: [] },
    { roleMappings: [], departmentMappings: [] }
  );
  assert.equal(mapping, undefined);
});

test("maps the built-in DingTalk role names without administrator configuration", () => {
  const advisor = resolveDingTalkOrganizationMapping(
    {
      userId: "ding-user-2",
      name: "张三",
      active: true,
      departmentIds: ["1001"],
      roles: [{ id: "role-advisor", name: "服务顾问" }]
    },
    { roleMappings: [], departmentMappings: [] }
  );
  const manager = resolveDingTalkOrganizationMapping(
    {
      userId: "ding-user-3",
      name: "Gary",
      active: true,
      departmentIds: ["1001"],
      roles: [{ id: "role-manager", name: "门店管理员" }]
    },
    { roleMappings: [], departmentMappings: [] }
  );

  assert.deepEqual(advisor, {
    role: "advisor",
    shopId: "shop-hq",
    homeRoute: "order-create",
    source: { dingtalkRoleId: "role-advisor", dingtalkDepartmentId: undefined }
  });
  assert.deepEqual(manager, {
    role: "manager",
    shopId: "shop-hq",
    homeRoute: "workbench",
    source: { dingtalkRoleId: "role-manager", dingtalkDepartmentId: undefined }
  });
});
