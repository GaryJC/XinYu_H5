import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDingTalkUserProfile,
  resolveDingTalkOrganizationMapping,
  validateRoleMapping
} from "../server/integrations/dingtalk/organization.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

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

test("does not grant access for a job title or an unknown DingTalk role name", () => {
  const mapping = resolveDingTalkOrganizationMapping(
    {
      userId: "ding-user-unknown",
      name: "未授权员工",
      active: true,
      departmentIds: ["1001"],
      roles: [{ id: "role-other", name: "维修技师" }]
    },
    { roleMappings: [], departmentMappings: [] }
  );
  assert.equal(mapping, undefined);
});

test("explicit workflow role mappings are available after configuration", () => {
  for (const appRole of ["advisor", "technician", "inspector"]) {
    const mapping = validateRoleMapping({dingtalkRoleId:"role-1",dingtalkRoleName:"业务岗位",appRole,homeRoute:"workbench"});
    assert.equal(resolveDingTalkOrganizationMapping({departmentIds:[],roles:[{id:"role-1",name:"业务岗位"}]},{roleMappings:[mapping]}).role,appRole);
  }
  assert.throws(()=>validateRoleMapping({dingtalkRoleId:"x",dingtalkRoleName:"x",appRole:"root",homeRoute:"workbench"}),error=>error.status===400);
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

test("manager wins deterministically when an employee has both MVP roles", () => {
  const mapping = resolveDingTalkOrganizationMapping(
    {
      userId: "ding-user-both",
      name: "双角色员工",
      active: true,
      departmentIds: ["1001"],
      roles: [
        { id: "role-advisor", name: "服务顾问" },
        { id: "role-manager", name: "门店管理员" }
      ]
    },
    { roleMappings: [], departmentMappings: [] }
  );
  assert.equal(mapping?.role, "manager");
  assert.equal(mapping?.homeRoute, "workbench");
});

test('role priority includes all workflow roles and a disabled explicit mapping cannot use name fallback',()=>{
  const roles=['technician','inspector','advisor','manager'];
  for(let end=1;end<=roles.length;end++) {
    const selected=roles.slice(0,end);
    const mapping=resolveDingTalkOrganizationMapping({departmentIds:[],roles:selected.map(id=>({id,name:id}))},{roleMappings:selected.map(appRole=>({dingtalkRoleId:appRole,appRole,enabled:true,homeRoute:'workbench'}))});
    assert.equal(mapping.role,selected.at(-1));
  }
  assert.equal(resolveDingTalkOrganizationMapping({departmentIds:[],roles:[{id:'manager',name:'门店管理员'}]},{roleMappings:[{dingtalkRoleId:'manager',appRole:'manager',enabled:false}]}),undefined);
});
