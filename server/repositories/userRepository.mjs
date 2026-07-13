import crypto from "node:crypto";
import { pool } from "../database/pool.mjs";

export async function listUsers() {
  const { rows } = await pool.query(
    "select id, name, role, dingtalk_user_id, active, shop_id, phone, last_login_at from users order by role, name"
  );
  return rows.map(rowToUser);
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    "select id, name, role, dingtalk_user_id, active, shop_id, phone, last_login_at from users where id = $1",
    [id]
  );
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

export async function findUserByDingTalkUserId(dingTalkUserId) {
  const { rows } = await pool.query(
    "select id, name, role, dingtalk_user_id, active, shop_id, phone, last_login_at from users where dingtalk_user_id = $1",
    [dingTalkUserId]
  );
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

export async function markUserLogin(id) {
  await pool.query("update users set last_login_at = now() where id = $1", [id]);
}

export async function upsertUserFromDingTalk({ profile, mapping, existingUser }) {
  const id = existingUser?.id || `u_dingtalk_${profile.userId}`;
  const role = mapping?.role || existingUser?.role;
  const shopId = mapping?.shopId || existingUser?.shopId;
  if (!role || !shopId) return undefined;

  const { rows } = await pool.query(
    `
      insert into users (id, name, role, dingtalk_user_id, active, shop_id, phone)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (dingtalk_user_id) do update set
        name = excluded.name,
        role = excluded.role,
        active = excluded.active,
        shop_id = excluded.shop_id,
        phone = excluded.phone
      returning id, name, role, dingtalk_user_id, active, shop_id, phone, last_login_at
    `,
    [
      id,
      profile.name || existingUser?.name || "钉钉员工",
      role,
      profile.userId,
      profile.active && existingUser?.active !== false,
      shopId,
      profile.phone || existingUser?.phone || null
    ]
  );
  return rowToUser(rows[0]);
}

export async function saveDingTalkUserSnapshot(profile) {
  await pool.query(
    `
      insert into dingtalk_user_snapshots (dingtalk_user_id, name, phone, department_ids, role_list, active, synced_at)
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, now())
      on conflict (dingtalk_user_id) do update set
        name = excluded.name,
        phone = excluded.phone,
        department_ids = excluded.department_ids,
        role_list = excluded.role_list,
        active = excluded.active,
        synced_at = now()
    `,
    [profile.userId, profile.name || "", profile.phone || null, JSON.stringify(profile.departmentIds), JSON.stringify(profile.roles), profile.active]
  );
}

export async function getDingTalkIdentitySnapshot(dingtalkUserId) {
  const { rows } = await pool.query(
    `
      select dingtalk_user_id, name, phone, department_ids, role_list, active, synced_at
      from dingtalk_user_snapshots
      where dingtalk_user_id = $1
    `,
    [dingtalkUserId]
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    dingtalkUserId: row.dingtalk_user_id,
    name: row.name,
    phone: row.phone || undefined,
    departmentIds: Array.isArray(row.department_ids) ? row.department_ids.map(String) : [],
    roles: Array.isArray(row.role_list) ? row.role_list : [],
    active: row.active,
    syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : undefined
  };
}

export async function listDingTalkMappings() {
  const [roleResult, departmentResult] = await Promise.all([
    pool.query(
      `
        select dingtalk_role_id, dingtalk_role_name, app_role, shop_id, home_route, enabled
        from dingtalk_role_mappings
        order by dingtalk_role_name
      `
    ),
    pool.query(
      `
        select dingtalk_department_id, dingtalk_department_name, shop_id, enabled
        from dingtalk_department_mappings
        order by dingtalk_department_name
      `
    )
  ]);
  return {
    roleMappings: roleResult.rows.map((row) => ({
      dingtalkRoleId: row.dingtalk_role_id,
      dingtalkRoleName: row.dingtalk_role_name,
      appRole: row.app_role,
      shopId: row.shop_id || undefined,
      homeRoute: row.home_route,
      enabled: row.enabled
    })),
    departmentMappings: departmentResult.rows.map((row) => ({
      dingtalkDepartmentId: row.dingtalk_department_id,
      dingtalkDepartmentName: row.dingtalk_department_name,
      shopId: row.shop_id,
      enabled: row.enabled
    }))
  };
}

export async function upsertDingTalkRoleMapping(mapping) {
  const { rows } = await pool.query(
    `
      insert into dingtalk_role_mappings (dingtalk_role_id, dingtalk_role_name, app_role, shop_id, home_route, enabled, updated_at)
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (dingtalk_role_id) do update set
        dingtalk_role_name = excluded.dingtalk_role_name,
        app_role = excluded.app_role,
        shop_id = excluded.shop_id,
        home_route = excluded.home_route,
        enabled = excluded.enabled,
        updated_at = now()
      returning dingtalk_role_id, dingtalk_role_name, app_role, shop_id, home_route, enabled
    `,
    [mapping.dingtalkRoleId, mapping.dingtalkRoleName, mapping.appRole, mapping.shopId || null, mapping.homeRoute, mapping.enabled]
  );
  const row = rows[0];
  return {
    dingtalkRoleId: row.dingtalk_role_id,
    dingtalkRoleName: row.dingtalk_role_name,
    appRole: row.app_role,
    shopId: row.shop_id || undefined,
    homeRoute: row.home_route,
    enabled: row.enabled
  };
}

export async function upsertDingTalkDepartmentMapping(mapping) {
  const { rows } = await pool.query(
    `
      insert into dingtalk_department_mappings (dingtalk_department_id, dingtalk_department_name, shop_id, enabled, updated_at)
      values ($1, $2, $3, $4, now())
      on conflict (dingtalk_department_id) do update set
        dingtalk_department_name = excluded.dingtalk_department_name,
        shop_id = excluded.shop_id,
        enabled = excluded.enabled,
        updated_at = now()
      returning dingtalk_department_id, dingtalk_department_name, shop_id, enabled
    `,
    [mapping.dingtalkDepartmentId, mapping.dingtalkDepartmentName, mapping.shopId, mapping.enabled]
  );
  const row = rows[0];
  return {
    dingtalkDepartmentId: row.dingtalk_department_id,
    dingtalkDepartmentName: row.dingtalk_department_name,
    shopId: row.shop_id,
    enabled: row.enabled
  };
}

export async function createAuthSession({ token, userId, userAgent, ipAddress, expiresAt }) {
  const id = createSessionId();
  await pool.query(
    `
      insert into auth_sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
      values ($1, $2, $3, $4, $5, $6)
    `,
    [id, userId, hashToken(token), userAgent || "", ipAddress || "", expiresAt]
  );
  return id;
}

export async function isAuthSessionActive(token) {
  const { rows } = await pool.query(
    `
      select 1
      from auth_sessions
      where token_hash = $1
        and revoked_at is null
        and expires_at > now()
      limit 1
    `,
    [hashToken(token)]
  );
  return Boolean(rows[0]);
}

function rowToUser(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    dingtalkUserId: row.dingtalk_user_id || undefined,
    active: row.active,
    shopId: row.shop_id || "shop-hq",
    phone: row.phone || undefined,
    lastLoginAt: row.last_login_at ? formatDate(row.last_login_at) : undefined
  };
}

function createSessionId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `sess_${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
