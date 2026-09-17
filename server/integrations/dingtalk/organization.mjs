import { HttpError } from "../../http/HttpError.mjs";

const MVP_ROLES = new Set(["advisor", "manager", "technician", "inspector"]);
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
  const enabledDepartmentMappings = departmentMappings.filter((mapping) => mapping.enabled);
  const departmentMapping = profile.departmentIds
    .map((departmentId) => enabledDepartmentMappings.find((mapping) => mapping.dingtalkDepartmentId === departmentId))
    .find(Boolean);
  const candidates = profile.roles.flatMap((role) => {
    const explicit = roleMappings.find((mapping) => mapping.dingtalkRoleId === role.id);
    if (explicit) return explicit.enabled && MVP_ROLES.has(explicit.appRole) ? [explicit] : [];
    const builtIn = BUILT_IN_ROLE_MAPPINGS.get(role.name.trim());
    return builtIn ? [{ dingtalkRoleId: role.id, ...builtIn }] : [];
  });
  const resolvedRole = candidates.sort((left, right) => rolePriority(right.appRole) - rolePriority(left.appRole)
    || left.dingtalkRoleId.localeCompare(right.dingtalkRoleId))[0];

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
  return { manager: 100, advisor: 80, inspector: 40, technician: 20 }[role] || 0;
}

export function validateRoleMapping(input) {
  const dingtalkRoleId = String(input?.dingtalkRoleId || "").trim();
  const dingtalkRoleName = String(input?.dingtalkRoleName || "").trim();
  const appRole = String(input?.appRole || "").trim();
  const shopId = input?.shopId ? String(input.shopId).trim() : undefined;
  const homeRoute = String(input?.homeRoute || "").trim();
  if (!dingtalkRoleId || !dingtalkRoleName || !MVP_ROLES.has(appRole) || !VALID_HOME_ROUTES.has(homeRoute)) {
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
