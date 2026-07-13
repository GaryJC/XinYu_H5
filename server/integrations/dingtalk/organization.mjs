import { HttpError } from "../../http/HttpError.mjs";

const VALID_ROLES = new Set(["advisor", "dispatcher", "technician", "inspector", "manager"]);
const VALID_HOME_ROUTES = new Set(["workbench", "order-create"]);
const BUILT_IN_ROLE_MAPPINGS = new Map([
  ["服务顾问", { appRole: "advisor", homeRoute: "order-create" }],
  ["门店管理员", { appRole: "manager", homeRoute: "workbench" }]
]);

export async function getDingTalkUserProfile({ userId, accessToken }) {
  const url = new URL("https://oapi.dingtalk.com/topapi/v2/user/get");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid: userId })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errcode) {
    throw new HttpError(502, `获取钉钉员工详情失败：${payload?.errmsg || response.status}`);
  }
  return normalizeDingTalkUserProfile(payload?.result, userId);
}

export function normalizeDingTalkUserProfile(raw, userId) {
  const departmentIds = Array.isArray(raw?.dept_id_list) ? raw.dept_id_list.map(String) : [];
  const roles = Array.isArray(raw?.role_list)
    ? raw.role_list
      .filter((role) => role?.id !== undefined && role?.id !== null)
      .map((role) => ({ id: String(role.id), name: String(role.name || role.group_name || role.id).trim() }))
    : [];

  return {
    userId: String(raw?.userid || userId),
    name: String(raw?.name || ""),
    phone: raw?.mobile ? String(raw.mobile) : undefined,
    active: raw?.active !== false,
    departmentIds,
    roles
  };
}

export function resolveDingTalkOrganizationMapping(profile, { roleMappings = [], departmentMappings = [] }) {
  const enabledRoleMappings = roleMappings.filter((mapping) => mapping.enabled);
  const enabledDepartmentMappings = departmentMappings.filter((mapping) => mapping.enabled);
  const profileRoleIds = new Set(profile.roles.map((role) => role.id));
  const roleMapping = enabledRoleMappings
    .filter((mapping) => profileRoleIds.has(mapping.dingtalkRoleId))
    .sort((left, right) => rolePriority(right.appRole) - rolePriority(left.appRole))[0];
  const departmentMapping = profile.departmentIds
    .map((departmentId) => enabledDepartmentMappings.find((mapping) => mapping.dingtalkDepartmentId === departmentId))
    .find(Boolean);

  const builtInRole = profile.roles
    .map((role) => ({ role, mapping: BUILT_IN_ROLE_MAPPINGS.get(role.name.trim()) }))
    .filter((item) => item.mapping)
    .sort((left, right) => rolePriority(right.mapping.appRole) - rolePriority(left.mapping.appRole))[0];
  const resolvedRole = roleMapping || (builtInRole ? {
    dingtalkRoleId: builtInRole.role.id,
    appRole: builtInRole.mapping.appRole,
    homeRoute: builtInRole.mapping.homeRoute,
    shopId: "shop-hq"
  } : undefined);

  if (!resolvedRole) return undefined;
  return {
    role: resolvedRole.appRole,
    shopId: resolvedRole.shopId || departmentMapping?.shopId || "shop-hq",
    homeRoute: resolvedRole.homeRoute,
    source: {
      dingtalkRoleId: resolvedRole.dingtalkRoleId,
      dingtalkDepartmentId: departmentMapping?.dingtalkDepartmentId
    }
  };
}

function rolePriority(role) {
  return role === "manager" ? 100 : role === "advisor" ? 50 : 10;
}

export function validateRoleMapping(input) {
  const dingtalkRoleId = String(input?.dingtalkRoleId || "").trim();
  const dingtalkRoleName = String(input?.dingtalkRoleName || "").trim();
  const appRole = String(input?.appRole || "").trim();
  const shopId = input?.shopId ? String(input.shopId).trim() : undefined;
  const homeRoute = String(input?.homeRoute || "").trim();
  if (!dingtalkRoleId || !dingtalkRoleName || !VALID_ROLES.has(appRole) || !VALID_HOME_ROUTES.has(homeRoute)) {
    throw new HttpError(400, "钉钉角色映射参数无效");
  }
  return { dingtalkRoleId, dingtalkRoleName, appRole, shopId, homeRoute, enabled: input?.enabled !== false };
}

export function validateDepartmentMapping(input) {
  const dingtalkDepartmentId = String(input?.dingtalkDepartmentId || "").trim();
  const dingtalkDepartmentName = String(input?.dingtalkDepartmentName || "").trim();
  const shopId = String(input?.shopId || "").trim();
  if (!dingtalkDepartmentId || !dingtalkDepartmentName || !shopId) {
    throw new HttpError(400, "钉钉部门映射参数无效");
  }
  return { dingtalkDepartmentId, dingtalkDepartmentName, shopId, enabled: input?.enabled !== false };
}
