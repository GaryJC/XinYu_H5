import { authenticateRequest, loginForDevelopment, loginWithDingTalk } from "../auth.mjs";
import {
  assertFileAccess,
  assertOcrRecordAccess,
  assertWorkOrderAccess,
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
import { recognizeLicensePlate, recognizeVehicleLicense, recognizeVin } from "../ocr.mjs";
import { lookupVehicleInCompanySystem } from "../integrations/company/vehicleLookup.mjs";
import {
  getDingTalkIdentitySnapshot,
  listDingTalkMappings,
  listUsers,
  upsertDingTalkDepartmentMapping,
  upsertDingTalkRoleMapping
} from "../repositories/userRepository.mjs";
import { validateDepartmentMapping, validateRoleMapping } from "../integrations/dingtalk/organization.mjs";
import { HttpError } from "../http/HttpError.mjs";
import { readStoredFile, saveUploadedFile } from "../storage.mjs";
import { requireAnyRole, requireAuthenticatedUser, requireTransitionRole } from "../domain/accessPolicy.mjs";

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

  if (req.method === "POST" && url.pathname === "/api/auth/dev-login") {
    const { persona } = await readJson(req);
    sendJson(res, 200, await loginForDevelopment(persona, requestContext(req)));
    return true;
  }

  if (!url.pathname.startsWith("/api/")) return false;
  const currentUser = requireAuthenticatedUser(await authenticateRequest(req));

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(res, 200, currentUser);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/work-orders") {
    sendJson(res, 200, await listWorkOrders(currentUser.role, currentUser));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, await listUsers());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/dingtalk-mappings") {
    requireManager(currentUser);
    sendJson(res, 200, await listDingTalkMappings());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/dingtalk-identity") {
    requireManager(currentUser);
    sendJson(res, 200, await getDingTalkIdentitySnapshot(currentUser.dingtalkUserId));
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/dingtalk-role-mappings") {
    requireManager(currentUser);
    sendJson(res, 200, await upsertDingTalkRoleMapping(validateRoleMapping(await readJson(req))));
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/dingtalk-department-mappings") {
    requireManager(currentUser);
    sendJson(res, 200, await upsertDingTalkDepartmentMapping(validateDepartmentMapping(await readJson(req))));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    sendJson(res, 200, await dashboardSummary(currentUser.role, currentUser));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ocr/vehicle-license") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const { imageBase64 } = await readJson(req);
    sendJson(res, 200, await recognizeVehicleLicense(imageBase64));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ocr/license-plate") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const { imageBase64 } = await readJson(req);
    sendJson(res, 200, await recognizeLicensePlate(imageBase64));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/ocr/vin") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const { imageBase64 } = await readJson(req);
    sendJson(res, 200, await recognizeVin(imageBase64));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/company-system/vehicles/lookup") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    sendJson(res, 200, await lookupVehicleInCompanySystem(await readJson(req)));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/files") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const body = await readJson(req);
    sendJson(res, 201, await saveUploadedFile({ ...body, uploadedBy: currentUser.id }));
    return true;
  }

  const fileContentMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/content$/);
  if (fileContentMatch && req.method === "GET") {
    await assertFileAccess(fileContentMatch[1], currentUser);
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
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const { orderId } = await readJson(req);
    await assertFileAccess(fileAttachMatch[1], currentUser);
    await assertWorkOrderAccess(orderId, currentUser);
    sendJson(res, 200, await attachFileToOrder(fileAttachMatch[1], orderId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/work-orders") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const { draft, actor } = await readJson(req);
    sendJson(res, 201, await createWorkOrder({ ...draft, advisor: currentUser.name }, currentUser.name || actor));
    return true;
  }

  const workOrderMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)$/);
  if (workOrderMatch && req.method === "PUT") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const { order, actor, action } = await readJson(req);
    if (!order || order.id !== workOrderMatch[1]) {
      sendJson(res, 400, { error: "委托单参数不一致" });
      return true;
    }
    await assertWorkOrderAccess(workOrderMatch[1], currentUser);
    sendJson(res, 200, await updateWorkOrder(order, currentUser.name || actor, action));
    return true;
  }

  const transitionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/transition$/);
  if (transitionMatch && req.method === "POST") {
    const { status, actor, action, patch = {} } = await readJson(req);
    requireTransitionRole(currentUser, status);
    await assertWorkOrderAccess(transitionMatch[1], currentUser);
    sendJson(res, 200, await transitionWorkOrder(transitionMatch[1], status, currentUser.name || actor, action, patch));
    return true;
  }

  const tokenMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/signature-token$/);
  if (tokenMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    await assertWorkOrderAccess(tokenMatch[1], currentUser);
    const { actor } = await readJson(req);
    sendJson(res, 200, await createSignatureTokenForOrder(tokenMatch[1], currentUser.name || actor));
    return true;
  }

  const ocrMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/ocr-records$/);
  if (ocrMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    if (ocrMatch[1] !== "draft") await assertWorkOrderAccess(ocrMatch[1], currentUser);
    const body = await readJson(req);
    sendJson(res, 201, await createOcrRecord({ ...body, orderId: ocrMatch[1] === "draft" ? null : ocrMatch[1] }));
    return true;
  }

  const ocrConfirmMatch = url.pathname.match(/^\/api\/ocr-records\/([^/]+)\/confirm$/);
  if (ocrConfirmMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    await assertOcrRecordAccess(ocrConfirmMatch[1], currentUser);
    const { value, actor } = await readJson(req);
    sendJson(res, 200, await confirmOcrRecord(ocrConfirmMatch[1], value, currentUser.name || actor));
    return true;
  }

  const platformMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/platform-sync$/);
  if (platformMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    await assertWorkOrderAccess(platformMatch[1], currentUser);
    const { actor } = await readJson(req);
    sendJson(res, 200, await syncWorkOrderToPlatform(platformMatch[1], currentUser.name || actor));
    return true;
  }

  const itemActionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/repair-items\/([^/]+)\/action$/);
  if (itemActionMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["manager"], "MVP1 仅门店管理员可以操作维修项目流程");
    await assertWorkOrderAccess(itemActionMatch[1], currentUser);
    const { action, actor, patch } = await readJson(req);
    sendJson(res, 200, await repairItemAction(itemActionMatch[1], itemActionMatch[2], action, currentUser.name || actor, patch));
    return true;
  }

  const settlementMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/settlement-statements$/);
  if (settlementMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    await assertWorkOrderAccess(settlementMatch[1], currentUser);
    const { actor } = await readJson(req);
    sendJson(res, 200, await createSettlementForOrder(settlementMatch[1], currentUser.name || actor));
    return true;
  }

  const signatureMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)$/);
  if (signatureMatch && req.method === "GET") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const order = await findWorkOrderByToken(signatureMatch[1]);
    if (order) await assertWorkOrderAccess(order.id, currentUser);
    sendJson(res, order ? 200 : 404, order || { error: "签字会话不存在或已失效" });
    return true;
  }

  const signMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)\/sign$/);
  if (signMatch && req.method === "POST") {
    requireAnyRole(currentUser, ["advisor", "manager"]);
    const order = await findWorkOrderByToken(signMatch[1]);
    if (!order) throw new HttpError(404, "签字会话不存在或已失效");
    await assertWorkOrderAccess(order.id, currentUser);
    const { signature, signatureFileId } = await readJson(req);
    sendJson(res, 200, await signWorkOrderByToken(signMatch[1], signature, signatureFileId));
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

function requireManager(user) {
  requireAnyRole(user, ["manager"], "仅门店管理员可以配置钉钉组织映射");
}
