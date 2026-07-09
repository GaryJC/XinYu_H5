import crypto from "node:crypto";
import { HttpError, createAuthSession, findUserByDingTalkUserId, findUserById, isAuthSessionActive, markUserLogin } from "./db.mjs";

const DINGTALK_ACCESS_TOKEN_TTL_MS = 90 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let dingTalkAccessToken = "";
let dingTalkAccessTokenExpiresAt = 0;

export async function loginWithDingTalk(authCode, context = {}) {
  if (!authCode || typeof authCode !== "string") throw new HttpError(400, "缺少钉钉 authCode");
  const dingUserId = await getDingTalkUserId(authCode);
  const user = await findUserByDingTalkUserId(dingUserId);
  if (!user) throw new HttpError(403, "当前钉钉账号未绑定员工，请联系管理员");
  if (!user.active) throw new HttpError(403, "当前员工账号已停用");

  const token = createTokenForUser(user.id);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await createAuthSession({
    token,
    userId: user.id,
    userAgent: context.userAgent || "",
    ipAddress: context.ipAddress || "",
    expiresAt
  });
  await markUserLogin(user.id);
  return { token, user: { ...user, lastLoginAt: new Date().toISOString() }, expiresAt: expiresAt.toISOString() };
}

export async function authenticateRequest(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1].trim();
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) throw new HttpError(401, "登录已失效，请重新进入钉钉应用");
  if (!(await isAuthSessionActive(token))) throw new HttpError(401, "登录会话已失效，请重新进入钉钉应用");

  const user = await findUserById(payload.userId);
  if (!user || !user.active) throw new HttpError(401, "登录用户不存在或已停用");
  return user;
}

async function verifySessionToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.userId || !payload?.sessionId || !payload?.exp) return null;
  if (Date.now() >= Number(payload.exp) * 1000) return null;
  return payload;
}

async function getDingTalkUserId(authCode) {
  const token = await getDingTalkAccessToken();
  const url = new URL("https://oapi.dingtalk.com/topapi/v2/user/getuserinfo");
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: authCode })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errcode) {
    throw new HttpError(502, `钉钉免登失败：${payload?.errmsg || response.status}`);
  }
  const userId = payload?.result?.userid;
  if (!userId) throw new HttpError(502, "钉钉免登未返回 userid");
  return userId;
}

async function getDingTalkAccessToken() {
  const now = Date.now();
  if (dingTalkAccessToken && now < dingTalkAccessTokenExpiresAt) return dingTalkAccessToken;

  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  if (!appKey || !appSecret) throw new HttpError(500, "未配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET");

  const url = new URL("https://oapi.dingtalk.com/gettoken");
  url.searchParams.set("appkey", appKey);
  url.searchParams.set("appsecret", appSecret);
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errcode) {
    throw new HttpError(502, `获取钉钉 access_token 失败：${payload?.errmsg || response.status}`);
  }
  if (!payload?.access_token) throw new HttpError(502, "钉钉未返回 access_token");
  dingTalkAccessToken = payload.access_token;
  dingTalkAccessTokenExpiresAt = now + Math.max(Number(payload.expires_in || 7200) * 1000 - DINGTALK_ACCESS_TOKEN_TTL_MS, 60 * 1000);
  return dingTalkAccessToken;
}

export function createTokenForUser(userId) {
  const sessionId = crypto.randomUUID();
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sessionId,
    userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_TTL_MS) / 1000)
  });
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(500, "未配置 JWT_SECRET");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
