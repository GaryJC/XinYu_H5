import { pool } from "../database/pool.mjs";
import { HttpError } from "../http/HttpError.mjs";

export async function saveEmployeeBinding(userId, employee, database = pool) {
  const { rows } = await database.query(`
    update users set legacy_employee_code=$2, legacy_employee_name=$3,
      legacy_employee_department=$4, legacy_employee_bound_at=now()
    where id=$1 and active=true and role='technician' and legacy_employee_code is null
    returning legacy_employee_code
  `, [userId, employee.code, employee.name, employee.departmentCode]);
  if (rows.length === 1) return employee.code;
  // A concurrent login may already have saved this binding. Never overwrite it.
  const result = await database.query('select legacy_employee_code from users where id=$1 and active=true and role=\'technician\'', [userId]);
  if (result.rows[0]?.legacy_employee_code === employee.code) return employee.code;
  throw new HttpError(409, "员工绑定已发生变化，请重新进入应用");
}
