import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { HttpError } from "../http/HttpError.mjs";

export function requireAuthenticatedUser(user) {
  if (!user) throw new HttpError(401, "未登录或登录已失效，请重新进入钉钉应用");
  return user;
}

export function requireAnyRole(user, allowedRoles, message = "当前账号没有执行此操作的权限") {
  const authenticatedUser = requireAuthenticatedUser(user);
  if (!hasAnyRole(authenticatedUser, allowedRoles)) throw new HttpError(403, message);
  return authenticatedUser;
}

export function requireTransitionRole(user, targetStatus) {
  const authenticatedUser = requireAuthenticatedUser(user);
  if (hasRole(authenticatedUser, 'manager')) return authenticatedUser;
  if (hasRole(authenticatedUser, 'advisor') && ["待派工", "完成"].includes(targetStatus)) return authenticatedUser;
  throw new HttpError(403, "当前角色不能执行此流程操作");
}
