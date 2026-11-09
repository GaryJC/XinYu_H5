import { HttpError } from "../../http/HttpError.mjs";
import {pendingDingTalkRead} from './pendingRead.mjs';

import roleDefinitions from "../../../shared/dingtalkRoles.json" with { type: "json" };

export async function getDingTalkUserProfile({ userId, accessToken, coalesce=false, fetcher=fetch }) {
  const body={userid:userId};
  const payload=await pendingDingTalkRead({fetcher,accessToken,endpoint:'v2/user/get',body,coalesce},async()=>{
    const url = new URL("https://oapi.dingtalk.com/topapi/v2/user/get");
    url.searchParams.set("access_token", accessToken);
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.errcode !== 0 || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)
      || String(payload.result.userid || '') !== String(userId)) {
      throw new HttpError(502, `获取钉钉员工详情失败：${payload?.errmsg || response.status}`);
    }
    return payload;
  });
  return normalizeDingTalkUserProfile(payload?.result, userId);
}

export function normalizeDingTalkUserProfile(raw, userId) {
  const departmentIds = Array.isArray(raw?.dept_id_list) ? raw.dept_id_list.map(String) : [];
  const roles = Array.isArray(raw?.role_list)
    ? raw.role_list
      .filter((role) => role?.id !== undefined && role?.id !== null)
      .map((role) => ({ id: String(role.id), name: String(role.name || "").trim() }))
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


// Departments remain in DingTalk. Existing store ownership must survive role changes.
export function resolveDingTalkOrganizationMapping(profile, { shopId = "shop-hq" } = {}) {
  const candidates = profile.roles.flatMap((role) => {
    const definition = roleDefinitions.find((entry) => entry.names.includes(role.name.trim()));
    return definition ? [{ ...definition, dingtalkRoleId: role.id }] : [];
  });
  const selected = candidates.sort((a, b) => b.priority - a.priority
    || a.dingtalkRoleId.localeCompare(b.dingtalkRoleId))[0];
  if (!selected) return { role: "employee", roles: ["employee"], shopId, homeRoute: "vehicle-trips" };
  return {
    role: selected.role,
    roles: [...new Set(candidates.map(candidate => candidate.role))],
    shopId,
    homeRoute: selected.homeRoute,
    source: { dingtalkRoleId: selected.dingtalkRoleId }
  };
}
