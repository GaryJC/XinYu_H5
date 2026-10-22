import { hasRole } from "../../shared/roles.mjs";
import { HttpError } from "../http/HttpError.mjs";

export function requiresEmployeeBinding(user) {
  return hasRole(user, 'technician') && !user.legacyEmployeeCode;
}

export function assertEmployeeBound(user) {
  if (requiresEmployeeBinding(user)) throw new HttpError(403, "请先匹配润丰员工编码后再使用维修工功能");
}

export function createEmployeeBindingService({ findEmployees, saveBinding }) {
  async function candidates(user) {
    const name = String(user.name || "").trim();
    if (!name) return [];
    let employees;
    try { employees = await findEmployees(name); }
    catch { throw new HttpError(503, "润丰员工档案暂时无法查询，请重试"); }
    const valid = employees.filter(e => e.code && e.name === name && e.status === "在职");
    if (new Set(valid.map(e => e.code)).size !== valid.length) {
      throw new HttpError(409, "润丰存在重复员工编码，请联系管理员核对");
    }
    return valid;
  }
  async function bind(user, employee) {
    const code = await saveBinding(user.id, employee);
    return { required: false, employeeCode: code, candidates: [] };
  }
  return {
    async status(user) {
      if (!requiresEmployeeBinding(user)) return { required: false, employeeCode: user.legacyEmployeeCode, candidates: [] };
      const found = await candidates(user);
      if (found.length === 1) return bind(user, found[0]);
      return { required: true, candidates: found };
    },
    async confirm(user, code) {
      if (!hasRole(user, 'technician')) throw new HttpError(403, "仅维修工需要匹配员工编码");
      if (user.legacyEmployeeCode) {
        if (code !== user.legacyEmployeeCode) throw new HttpError(409, "员工编码已绑定，不能自行更换");
        return { required: false, employeeCode: user.legacyEmployeeCode, candidates: [] };
      }
      const found = await candidates(user);
      const employee = found.find(e => e.code === code);
      if (!employee) throw new HttpError(400, "请选择本人同名、在职且具有维修工标记的员工档案");
      return bind(user, employee);
    }
  };
}
