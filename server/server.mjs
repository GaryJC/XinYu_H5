import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { authenticateRequest, loginWithDingTalk } from "./auth.mjs";
import { saveUploadedFile } from "./storage.mjs";
import {
  HttpError,
  confirmOcrRecord,
  createOcrRecord,
  createSignatureTokenForOrder,
  createSettlementForOrder,
  createWorkOrder,
  dashboardSummary,
  findWorkOrderByToken,
  healthCheck,
  listUsers,
  listWorkOrders,
  repairItemAction,
  signWorkOrderByToken,
  syncWorkOrderToPlatform,
  transitionWorkOrder,
  updateWorkOrder
} from "./db.mjs";
import { recognizeVehicleLicense } from "./ocr.mjs";

const port = Number(process.env.API_PORT || 8787);
const distDir = path.resolve("dist");

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, null);
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, await healthCheck());
    }

    if (req.method === "POST" && url.pathname === "/api/auth/dingtalk-login") {
      const { authCode } = await readJson(req);
      return send(res, 200, await loginWithDingTalk(authCode, requestContext(req)));
    }

    const currentUser = await authenticateRequest(req);

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      if (!currentUser) return send(res, 401, { error: "未登录" });
      return send(res, 200, currentUser);
    }

    if (req.method === "GET" && url.pathname === "/api/work-orders") {
      const role = currentUser?.role || url.searchParams.get("role") || "manager";
      return send(res, 200, await listWorkOrders(role, currentUser));
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      return send(res, 200, await listUsers());
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      const role = currentUser?.role || url.searchParams.get("role") || "manager";
      return send(res, 200, await dashboardSummary(role, currentUser));
    }

    if (req.method === "POST" && url.pathname === "/api/ocr/vehicle-license") {
      const { imageBase64 } = await readJson(req);
      return send(res, 200, await recognizeVehicleLicense(imageBase64));
    }

    if (req.method === "POST" && url.pathname === "/api/files") {
      const body = await readJson(req);
      return send(res, 201, await saveUploadedFile({ ...body, uploadedBy: currentUser?.id || body.uploadedBy || null }));
    }

    if (req.method === "POST" && url.pathname === "/api/work-orders") {
      const { draft, actor } = await readJson(req);
      return send(res, 201, await createWorkOrder(draft, currentUser?.name || actor));
    }

    const workOrderMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)$/);
    if (workOrderMatch && req.method === "PUT") {
      const { order, actor, action } = await readJson(req);
      if (!order || order.id !== workOrderMatch[1]) return send(res, 400, { error: "委托单参数不一致" });
      return send(res, 200, await updateWorkOrder(order, currentUser?.name || actor, action));
    }

    const transitionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/transition$/);
    if (transitionMatch && req.method === "POST") {
      const { status, actor, action, patch = {} } = await readJson(req);
      return send(res, 200, await transitionWorkOrder(transitionMatch[1], status, currentUser?.name || actor, action, patch));
    }

    const tokenMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/signature-token$/);
    if (tokenMatch && req.method === "POST") {
      const { actor } = await readJson(req);
      return send(res, 200, await createSignatureTokenForOrder(tokenMatch[1], currentUser?.name || actor));
    }

    const ocrMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/ocr-records$/);
    if (ocrMatch && req.method === "POST") {
      const body = await readJson(req);
      return send(res, 201, await createOcrRecord({ ...body, orderId: ocrMatch[1] === "draft" ? null : ocrMatch[1] }));
    }

    const ocrConfirmMatch = url.pathname.match(/^\/api\/ocr-records\/([^/]+)\/confirm$/);
    if (ocrConfirmMatch && req.method === "POST") {
      const { value, actor } = await readJson(req);
      return send(res, 200, await confirmOcrRecord(ocrConfirmMatch[1], value, currentUser?.name || actor));
    }

    const platformMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/platform-sync$/);
    if (platformMatch && req.method === "POST") {
      const { actor } = await readJson(req);
      return send(res, 200, await syncWorkOrderToPlatform(platformMatch[1], currentUser?.name || actor));
    }

    const itemActionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/repair-items\/([^/]+)\/action$/);
    if (itemActionMatch && req.method === "POST") {
      const { action, actor, patch } = await readJson(req);
      return send(res, 200, await repairItemAction(itemActionMatch[1], itemActionMatch[2], action, currentUser?.name || actor, patch));
    }

    const settlementMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/settlement-statements$/);
    if (settlementMatch && req.method === "POST") {
      const { actor } = await readJson(req);
      return send(res, 200, await createSettlementForOrder(settlementMatch[1], currentUser?.name || actor));
    }

    const signatureMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)$/);
    if (signatureMatch && req.method === "GET") {
      const order = await findWorkOrderByToken(signatureMatch[1]);
      if (!order) return send(res, 404, { error: "签字链接不存在或已失效" });
      return send(res, 200, order);
    }

    const signMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)\/sign$/);
    if (signMatch && req.method === "POST") {
      const { signature } = await readJson(req);
      return send(res, 200, await signWorkOrderByToken(signMatch[1], signature));
    }

    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    return serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    send(res, status, { error: error instanceof Error ? error.message : "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Repair API server listening on http://localhost:${port}`);
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = path.normalize(path.join(distDir, requested));
  if (!target.startsWith(distDir)) return send(res, 403, { error: "Forbidden" });

  try {
    const stat = await fs.stat(target);
    if (stat.isFile()) {
      res.statusCode = 200;
      res.setHeader("Content-Type", contentType(target));
      res.end(await fs.readFile(target));
      return;
    }
  } catch {
    // Fall through to SPA fallback.
  }

  try {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(await fs.readFile(path.join(distDir, "index.html")));
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (body == null) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function requestContext(req) {
  return {
    userAgent: req.headers["user-agent"] || "",
    ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim()
  };
}
