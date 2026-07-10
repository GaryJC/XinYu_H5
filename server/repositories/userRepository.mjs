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
