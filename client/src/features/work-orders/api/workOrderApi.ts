import {
  AuthResult,
  DashboardSummary,
  OcrFieldKey,
  OcrRecord,
  RoleKey,
  StoredFile,
  UserProfile,
  VehicleLicenseOcrResult,
  WorkOrder,
  WorkOrderDraft,
  WorkOrderStatus
} from "../../../../../shared/types";
import { request, setAuthToken } from "../../../shared/api/httpClient";

export type WorkOrderApi = {
  loginWithDingTalk(authCode: string): Promise<AuthResult>;
  me(): Promise<UserProfile>;
  list(role: RoleKey): Promise<WorkOrder[]>;
  create(draft: WorkOrderDraft, actor: string): Promise<WorkOrder>;
  update(order: WorkOrder, actor: string, action: string): Promise<WorkOrder>;
  transition(id: string, status: WorkOrderStatus, actor: string, action: string, patch?: Partial<WorkOrder>): Promise<WorkOrder>;
  createSignatureToken(id: string, actor: string): Promise<WorkOrder>;
  signByToken(token: string, signature: string): Promise<WorkOrder>;
  findByToken(token: string): Promise<WorkOrder | undefined>;
  recognizeVehicleLicense(imageBase64: string): Promise<VehicleLicenseOcrResult>;
  uploadFile(file: { orderId?: string; kind: StoredFile["kind"]; fileName: string; mimeType: string; imageBase64: string }): Promise<StoredFile>;
  createOcrRecord(orderId: string | undefined, field: OcrFieldKey, source: string, value: string, confidence: number, fileId?: string): Promise<OcrRecord>;
  confirmOcrRecord(id: string, value: string, actor: string): Promise<OcrRecord>;
  syncPlatform(id: string, actor: string): Promise<WorkOrder>;
  repairItemAction(id: string, itemId: number, action: string, actor: string, patch?: Record<string, unknown>): Promise<WorkOrder>;
  createSettlement(id: string, actor: string): Promise<WorkOrder>;
  dashboard(role: RoleKey): Promise<DashboardSummary>;
  users(): Promise<UserProfile[]>;
};

export const workOrderApi: WorkOrderApi = {
  async loginWithDingTalk(authCode) {
    const result = await request<AuthResult>("/api/auth/dingtalk-login", { method: "POST", body: { authCode }, skipAuth: true });
    setAuthToken(result.token);
    return result;
  },
  me() {
    return request("/api/auth/me");
  },
  list(role) {
    return request(`/api/work-orders?role=${role}`);
  },
  create(draft, actor) {
    return request("/api/work-orders", { method: "POST", body: { draft, actor } });
  },
  update(order, actor, action) {
    return request(`/api/work-orders/${order.id}`, { method: "PUT", body: { order, actor, action } });
  },
  transition(id, status, actor, action, patch = {}) {
    return request(`/api/work-orders/${id}/transition`, { method: "POST", body: { status, actor, action, patch } });
  },
  createSignatureToken(id, actor) {
    return request(`/api/work-orders/${id}/signature-token`, { method: "POST", body: { actor } });
  },
  signByToken(token, signature) {
    return request(`/api/signatures/${token}/sign`, { method: "POST", body: { signature } });
  },
  async findByToken(token) {
    try {
      return await request(`/api/signatures/${token}`);
    } catch {
      return undefined;
    }
  },
  recognizeVehicleLicense(imageBase64) {
    return request("/api/ocr/vehicle-license", { method: "POST", body: { imageBase64 } });
  },
  uploadFile(file) {
    return request("/api/files", { method: "POST", body: file });
  },
  createOcrRecord(orderId, field, source, value, confidence, fileId) {
    return request(`/api/work-orders/${orderId ?? "draft"}/ocr-records`, {
      method: "POST",
      body: { field, source, fileId: fileId || `mock-upload-${Date.now()}`, value, confidence }
    });
  },
  confirmOcrRecord(id, value, actor) {
    return request(`/api/ocr-records/${id}/confirm`, { method: "POST", body: { value, actor } });
  },
  syncPlatform(id, actor) {
    return request(`/api/work-orders/${id}/platform-sync`, { method: "POST", body: { actor } });
  },
  repairItemAction(id, itemId, action, actor, patch = {}) {
    return request(`/api/work-orders/${id}/repair-items/${itemId}/action`, { method: "POST", body: { action, actor, patch } });
  },
  createSettlement(id, actor) {
    return request(`/api/work-orders/${id}/settlement-statements`, { method: "POST", body: { actor } });
  },
  dashboard(role) {
    return request(`/api/dashboard?role=${role}`);
  },
  users() {
    return request("/api/users");
  }
};
