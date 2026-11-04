import { HttpError } from "./HttpError.mjs";
import { measureStage, writeTimingHeaders } from "./requestTiming.mjs";

const maxBodyBytes = Number(process.env.MAX_REQUEST_BODY_BYTES || 16 * 1024 * 1024);

export async function readJson(req) {
  return measureStage("body_read", () => parseJson(req));
}

async function parseJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new HttpError(413, "请求内容过大");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求 JSON 格式错误");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "请求内容必须是 JSON 对象");
  }
  return input;
}

export function sendError(res, error) {
  const expected = error instanceof HttpError;
  sendJson(res, expected ? error.status : 500, {
    error: expected ? error.message : "服务器处理失败，请稍后重试"
  });
}

export function sendJson(res, status, body) {
  writeTimingHeaders(res);
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (body == null) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function requestContext(req) {
  return {
    userAgent: req.headers["user-agent"] || "",
    ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim()
  };
}
