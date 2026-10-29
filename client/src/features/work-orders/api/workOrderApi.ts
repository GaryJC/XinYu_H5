import {
  AuthResult,
  CustomerSignatureMode,
  DispatchTask,
  DashboardSummary,
  DevelopmentPersonaKey,
  DingTalkIdentitySnapshot,
  LegacyDepartment,
  OcrFieldKey,
  OcrRecord,
  RoleKey,
  StoredFile,
  UserProfile,
  VehicleHistoryLookupResult,
  VehicleIdentifierOcrResult,
  VehicleLicenseOcrResult,
  VehicleLicenseOcrInput,
  VehicleLookupInput,
  VehicleReferenceKind,
  VehicleReferenceCodeCheckResult,
  VehicleReferenceCreateResult,
  VehicleReferenceSearchResult,
  VehicleLicenseException,
  WorkOrder,
  WorkOrderDraft,
  PaperOrderResolution,
  WorkOrderPhotoUpdate,
  WorkOrderPhotoDelete,
  WorkOrderCustomerVehicleUpdate,
  WorkOrderStatus
} from "../../../../../shared/types";
import { request, setAuthToken } from "../../../shared/api/httpClient";
import { dispatchEnabled } from "../../dispatch/dispatchAvailability";
import { roles } from "../domain/workOrderDomain";

function validateAuthenticatedUser(user: UserProfile) {
  if (!user || !Object.hasOwn(roles, user.role)) {
    throw new Error("当前账号的岗位尚未在此版本开放，请切换受支持的账号或联系管理员。");
  }
  return user;
}

export type WorkOrderApi = {
  loginWithDingTalk(authCode: string): Promise<AuthResult>;
  loginForDevelopment(persona: DevelopmentPersonaKey): Promise<AuthResult>;
  me(): Promise<UserProfile>;
  list(role: RoleKey): Promise<WorkOrder[]>;
  get(id:string):Promise<WorkOrder>;
  reportLicenseException(id:string,input:{reason:string;requestId:string;vehiclePlate:string;vehicleVin:string}):Promise<VehicleLicenseException>;
  create(draft: WorkOrderDraft, actor: string): Promise<WorkOrder>;
  update(order: WorkOrder, actor: string, action: string): Promise<WorkOrder>;
  resolvePaperOrder(id: string, change: PaperOrderResolution): Promise<WorkOrder>;
  submitPaperOrder(id: string): Promise<WorkOrder>;
  refreshFromRunfeng(id: string): Promise<WorkOrder>;
  deletePhotos(id: string, input: WorkOrderPhotoDelete): Promise<WorkOrder>;
  updatePhoto(id: string, photo: WorkOrderPhotoUpdate): Promise<WorkOrder>;
  updateCustomerVehicle(id: string, change: WorkOrderCustomerVehicleUpdate): Promise<WorkOrder>;
  deleteDraft(id: string): Promise<{ id: string }>;
  transition(id: string, status: WorkOrderStatus, actor: string, action: string, patch?: Partial<WorkOrder>): Promise<WorkOrder>;
  createSignatureToken(id: string, actor: string, renew?: boolean, signatureMode?: CustomerSignatureMode): Promise<WorkOrder>;
  confirmCustomerSignature(id: string): Promise<WorkOrder>;
  signByToken(token: string, signature: string, signatureFileId: string): Promise<WorkOrder>;
  findByToken(token: string): Promise<WorkOrder | undefined>;
  recognizeVehicleLicense(input: VehicleLicenseOcrInput | string): Promise<VehicleLicenseOcrResult>;
  recognizeLicensePlate(imageBase64: string): Promise<VehicleIdentifierOcrResult>;
  recognizeVin(imageBase64: string): Promise<VehicleIdentifierOcrResult>;
  lookupVehicle(identifier: VehicleLookupInput): Promise<VehicleHistoryLookupResult>;
  searchVehicleReferences(kind: VehicleReferenceKind, query: string): Promise<VehicleReferenceSearchResult>;
  checkVehicleReferenceCode(kind: VehicleReferenceKind, code: string): Promise<VehicleReferenceCodeCheckResult>;
  createVehicleReference(kind: VehicleReferenceKind, name: string, code: string): Promise<VehicleReferenceCreateResult>;
  uploadFile(file: { orderId?: string; kind: StoredFile["kind"]; fileName: string; mimeType: string; imageBase64: string }): Promise<StoredFile>;
  attachFile(fileId: string, orderId: string): Promise<StoredFile>;
  createOcrRecord(orderId: string | undefined, field: OcrFieldKey, source: string, value: string, confidence: number, fileId: string): Promise<OcrRecord>;
  confirmOcrRecord(id: string, value: string, actor: string): Promise<OcrRecord>;
  repairItemAction(id: string, itemId: number, action: string, actor: string, patch?: Record<string, unknown>): Promise<WorkOrder>;
  createSettlement(id: string, actor: string): Promise<WorkOrder>;
  dashboard(role: RoleKey): Promise<DashboardSummary>;
  users(): Promise<UserProfile[]>;
  departments(): Promise<LegacyDepartment[]>;
  dingTalkIdentity(): Promise<DingTalkIdentitySnapshot | undefined>;
};

export const workOrderApi: WorkOrderApi = {
  async loginWithDingTalk(authCode) {
    const result = await request<AuthResult>("/api/auth/dingtalk-login", { method: "POST", body: { authCode }, skipAuth: true });
    validateAuthenticatedUser(result.user);
    setAuthToken(result.token);
    return result;
  },
  async loginForDevelopment(persona) {
    const result = await request<AuthResult>("/api/auth/dev-login", { method: "POST", body: { persona }, skipAuth: true });
    validateAuthenticatedUser(result.user);
    setAuthToken(result.token);
    return result;
  },
  async me() {
    return validateAuthenticatedUser(await request<UserProfile>("/api/auth/me"));
  },
  async list(_role) {
    if (!dispatchEnabled) return request<WorkOrder[]>("/api/work-orders");
    const [orders, tasks] = await Promise.all([
      request<WorkOrder[]>("/api/work-orders"),
      request<DispatchTask[]>("/api/dispatch/tasks?includeCompleted=true")
    ]);
    const stages = new Map(tasks.map(task => [task.orderId, task.stage]));
    return orders.map(order => ({ ...order, dispatchStage: stages.get(order.id) }));
  },
  deletePhotos(id, input) {
    return request(`/api/work-orders/${encodeURIComponent(id)}/photos`, {method:"DELETE", body:input});
  },
  updatePhoto(id, photo) {
    return request(`/api/work-orders/${encodeURIComponent(id)}/photos`, {method:"POST", body:photo});
  },
  updateCustomerVehicle(id, change) {
    return request(`/api/work-orders/${encodeURIComponent(id)}/customer-vehicle`, { method: "PATCH", body: change });
  },
  resolvePaperOrder(id, change) {
    return request(`/api/work-orders/${encodeURIComponent(id)}/paper-order/resolve`, {method:"POST",body:change});
  },
  submitPaperOrder(id) {
    return request(`/api/work-orders/${encodeURIComponent(id)}/paper-order/submit`, {method:"POST"});
  },
  refreshFromRunfeng(id) {
    return request(`/api/work-orders/${encodeURIComponent(id)}/refresh-from-runfeng`, { method: "POST" });
  },
  get(id) {return request(`/api/work-orders/${encodeURIComponent(id)}`);},
  reportLicenseException(id,input) {return request(`/api/work-orders/${encodeURIComponent(id)}/license-exception`,{method:'POST',body:input});},
  create(draft, actor) {
    return request("/api/work-orders", { method: "POST", body: { draft, actor } });
  },
  update(order, actor, action) {
    return request(`/api/work-orders/${order.id}`, { method: "PUT", body: { order, actor, action } });
  },
  deleteDraft(id) {
    return request(`/api/work-orders/${id}`, { method: "DELETE" });
  },
  transition(id, status, actor, action, patch = {}) {
    return request(`/api/work-orders/${id}/transition`, { method: "POST", body: { status, actor, action, patch } });
  },
  confirmCustomerSignature(id) { return request(`/api/work-orders/${encodeURIComponent(id)}/confirm-customer-signature`, { method: "POST" }); },
  createSignatureToken(id, actor, renew = false, signatureMode) {
    return request(`/api/work-orders/${id}/signature-token`, { method: "POST", body: { actor, renew, signatureMode } });
  },
  signByToken(token, signature, signatureFileId) {
    return request(`/api/signatures/${token}/sign`, { method: "POST", body: { signature, signatureFileId } });
  },
  async findByToken(token) {
    try {
      return await request(`/api/signatures/${token}`);
    } catch {
      return undefined;
    }
  },
  recognizeVehicleLicense(input) {
    return request("/api/ocr/vehicle-license", { method: "POST", body: typeof input === "string" ? { imageBase64: input } : input });
  },
  recognizeLicensePlate(imageBase64) {
    return request("/api/ocr/license-plate", { method: "POST", body: { imageBase64 } });
  },
  recognizeVin(imageBase64) {
    return request("/api/ocr/vin", { method: "POST", body: { imageBase64 } });
  },
  lookupVehicle(identifier) {
    return request("/api/company-system/vehicles/lookup", { method: "POST", body: identifier });
  },
  searchVehicleReferences(kind, query) {
    return request("/api/company-system/vehicle-references/search", { method: "POST", body: { kind, query } });
  },
  checkVehicleReferenceCode(kind, code) {
    return request("/api/company-system/vehicle-references/code-check", { method: "POST", body: { kind, code } });
  },
  createVehicleReference(kind, name, code) {
    return request("/api/company-system/vehicle-references", { method: "POST", body: { kind, name, code } });
  },
  uploadFile(file) {
    return request("/api/files", { method: "POST", body: file });
  },
  attachFile(fileId, orderId) {
    return request(`/api/files/${fileId}/attach`, { method: "POST", body: { orderId } });
  },
  createOcrRecord(orderId, field, source, value, confidence, fileId) {
    return request(`/api/work-orders/${orderId ?? "draft"}/ocr-records`, {
      method: "POST",
      body: { field, source, fileId, value, confidence }
    });
  },
  confirmOcrRecord(id, value, actor) {
    return request(`/api/ocr-records/${id}/confirm`, { method: "POST", body: { value, actor } });
  },
  repairItemAction(id, itemId, action, actor, patch = {}) {
    return request(`/api/work-orders/${id}/repair-items/${itemId}/action`, { method: "POST", body: { action, actor, patch } });
  },
  createSettlement(id, actor) {
    return request(`/api/work-orders/${id}/settlement-statements`, { method: "POST", body: { actor } });
  },
  dashboard(_role) {
    return request("/api/dashboard");
  },
  users() {
    return request("/api/users");
  },
  departments() {
    return request("/api/company-system/departments");
  },
  dingTalkIdentity() {
    return request("/api/admin/dingtalk-identity");
  },
};
