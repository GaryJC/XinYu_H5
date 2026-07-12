import { authenticateRequest, loginWithDingTalk } from "../auth.mjs";
import {
  confirmOcrRecord,
  attachFileToOrder,
  createOcrRecord,
  createSignatureTokenForOrder,
  createSettlementForOrder,
  createWorkOrder,
  dashboardSummary,
  findWorkOrderByToken,
  healthCheck,
  listWorkOrders,
  repairItemAction,
  signWorkOrderByToken,
  syncWorkOrderToPlatform,
  transitionWorkOrder,
  updateWorkOrder
} from "../db.mjs";
import { readJson, requestContext, sendJson } from "../http/response.mjs";
import { recognizeVehicleLicense } from "../ocr.mjs";
import { listUsers } from "../repositories/userRepository.mjs";
import { readStoredFile, saveUploadedFile } from "../storage.mjs";

export async function handleApiRequest(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, await healthCheck());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/dingtalk-login") {
    const { authCode } = await readJson(req);
    sendJson(res, 200, await loginWithDingTalk(authCode, requestContext(req)));
    return true;
  }

  if (!url.pathname.startsWith("/api/")) return false;
  const currentUser = await authenticateRequest(req);

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(res, currentUser ? 200 : 401, currentUser || { error: "未登录" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/work-orders") {
    const role = currentUser?.role || url.searchParams.get("role") || "manager";
    sendJson(res, 200, await listWorkOrders(role, currentUser));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, await listUsers());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const role = currentUser?.role || url.searchParams.get("role") || "manager";
    sendJson(res, 200, await dashboardSummary(role, currentUser));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ocr/vehicle-license") {
    const { imageBase64 } = await readJson(req);
    sendJson(res, 200, await recognizeVehicleLicense(imageBase64));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/files") {
    const body = await readJson(req);
    sendJson(res, 201, await saveUploadedFile({ ...body, uploadedBy: currentUser?.id || body.uploadedBy || null }));
    return true;
  }

  const fileContentMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/content$/);
  if (fileContentMatch && req.method === "GET") {
    const { record, body } = await readStoredFile(fileContentMatch[1]);
    res.statusCode = 200;
    res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", body.byteLength);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.originalName || record.id)}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(body);
    return true;
  }

  const fileAttachMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/attach$/);
  if (fileAttachMatch && req.method === "POST") {
    const { orderId } = await readJson(req);
    sendJson(res, 200, await attachFileToOrder(fileAttachMatch[1], orderId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/work-orders") {
    const { draft, actor } = await readJson(req);
    sendJson(res, 201, await createWorkOrder(draft, currentUser?.name || actor));
    return true;
  }

  const workOrderMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)$/);
  if (workOrderMatch && req.method === "PUT") {
    const { order, actor, action } = await readJson(req);
    if (!order || order.id !== workOrderMatch[1]) {
      sendJson(res, 400, { error: "委托单参数不一致" });
      return true;
    }
    sendJson(res, 200, await updateWorkOrder(order, currentUser?.name || actor, action));
    return true;
  }

  const transitionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/transition$/);
  if (transitionMatch && req.method === "POST") {
    const { status, actor, action, patch = {} } = await readJson(req);
    sendJson(res, 200, await transitionWorkOrder(transitionMatch[1], status, currentUser?.name || actor, action, patch));
    return true;
  }

  const tokenMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/signature-token$/);
  if (tokenMatch && req.method === "POST") {
    const { actor } = await readJson(req);
    sendJson(res, 200, await createSignatureTokenForOrder(tokenMatch[1], currentUser?.name || actor));
    return true;
  }

  const ocrMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/ocr-records$/);
  if (ocrMatch && req.method === "POST") {
    const body = await readJson(req);
    sendJson(res, 201, await createOcrRecord({ ...body, orderId: ocrMatch[1] === "draft" ? null : ocrMatch[1] }));
    return true;
  }

  const ocrConfirmMatch = url.pathname.match(/^\/api\/ocr-records\/([^/]+)\/confirm$/);
  if (ocrConfirmMatch && req.method === "POST") {
    const { value, actor } = await readJson(req);
    sendJson(res, 200, await confirmOcrRecord(ocrConfirmMatch[1], value, currentUser?.name || actor));
    return true;
  }

  const platformMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/platform-sync$/);
  if (platformMatch && req.method === "POST") {
    const { actor } = await readJson(req);
    sendJson(res, 200, await syncWorkOrderToPlatform(platformMatch[1], currentUser?.name || actor));
    return true;
  }

  const itemActionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/repair-items\/([^/]+)\/action$/);
  if (itemActionMatch && req.method === "POST") {
    const { action, actor, patch } = await readJson(req);
    sendJson(res, 200, await repairItemAction(itemActionMatch[1], itemActionMatch[2], action, currentUser?.name || actor, patch));
    return true;
  }

  const settlementMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/settlement-statements$/);
  if (settlementMatch && req.method === "POST") {
    const { actor } = await readJson(req);
    sendJson(res, 200, await createSettlementForOrder(settlementMatch[1], currentUser?.name || actor));
    return true;
  }

  const signatureMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)$/);
  if (signatureMatch && req.method === "GET") {
    const order = await findWorkOrderByToken(signatureMatch[1]);
    sendJson(res, order ? 200 : 404, order || { error: "签字链接不存在或已失效" });
    return true;
  }

  const signMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)\/sign$/);
  if (signMatch && req.method === "POST") {
    const { signature, signatureFileId } = await readJson(req);
    sendJson(res, 200, await signWorkOrderByToken(signMatch[1], signature, signatureFileId));
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
