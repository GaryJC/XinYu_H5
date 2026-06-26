import { RoleKey, WorkOrder, WorkOrderDraft, WorkOrderStatus } from "./types";

export type WorkOrderApi = {
  list(role: RoleKey): Promise<WorkOrder[]>;
  create(draft: WorkOrderDraft, actor: string): Promise<WorkOrder>;
  update(order: WorkOrder, actor: string, action: string): Promise<WorkOrder>;
  transition(id: string, status: WorkOrderStatus, actor: string, action: string, patch?: Partial<WorkOrder>): Promise<WorkOrder>;
  createSignatureToken(id: string, actor: string): Promise<WorkOrder>;
  signByToken(token: string, signature: string): Promise<WorkOrder>;
  findByToken(token: string): Promise<WorkOrder | undefined>;
};

export const workOrderApi: WorkOrderApi = {
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
  }
};

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `API request failed: ${response.status}`);
  }
  return payload as T;
}
