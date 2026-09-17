import { HttpError } from "../../http/HttpError.mjs";
const DINGTALK_ACCESS_TOKEN_TTL_MS = 90 * 1000;
let dingTalkAccessToken = "";
let dingTalkAccessTokenExpiresAt = 0;
export async function getDingTalkAccessToken() {
  const now = Date.now();
  if (dingTalkAccessToken && now < dingTalkAccessTokenExpiresAt) return dingTalkAccessToken;

  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  if (!appKey || !appSecret) throw new HttpError(500, "未配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET");

  const url = new URL("https://oapi.dingtalk.com/gettoken");
  url.searchParams.set("appkey", appKey);
  url.searchParams.set("appsecret", appSecret);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errcode) {
    throw new HttpError(502, `获取钉钉 access_token 失败：${payload?.errmsg || response.status}`);
  }
  if (!payload?.access_token) throw new HttpError(502, "钉钉未返回 access_token");
  dingTalkAccessToken = payload.access_token;
  dingTalkAccessTokenExpiresAt = now + Math.max(Number(payload.expires_in || 7200) * 1000 - DINGTALK_ACCESS_TOKEN_TTL_MS, 60 * 1000);
  return dingTalkAccessToken;
}

