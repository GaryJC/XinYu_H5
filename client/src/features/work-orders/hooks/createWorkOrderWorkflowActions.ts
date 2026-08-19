import { type Dispatch, type SetStateAction } from "react";
import { RoleKey, WorkOrder, WorkOrderDraft } from "../../../../../shared/types";
import { workOrderApi } from "../api/workOrderApi";

type ActionLoading = "save" | "signature" | "delete" | "";

type Options = {
  selectedOrder?: WorkOrder;
  draft: WorkOrderDraft;
  role: RoleKey;
  actor: string;
  totalLabor: number;
  setFormErrors: Dispatch<SetStateAction<string[]>>;
  setActionLoading: Dispatch<SetStateAction<ActionLoading>>;
  loadOrders: (role?: RoleKey, keepId?: string) => Promise<void>;
  loadDashboard: (role?: RoleKey) => Promise<void>;
};

export function createWorkOrderWorkflowActions({
  selectedOrder,
  draft,
  role,
  actor,
  totalLabor,
  setFormErrors,
  setActionLoading,
  loadOrders,
  loadDashboard
}: Options) {
  async function runOrderAction(action: () => Promise<void>, fallback: string) {
    setFormErrors([]);
    try {
      await action();
    } catch (error) {
      setFormErrors([actionError(error, fallback)]);
    }
  }

  async function submitDispatch() {
    if (!selectedOrder) return;
    await runOrderAction(async () => {
      const updated = await workOrderApi.transition(selectedOrder.id, "待派工", actor, "提交派工池");
      await loadOrders(role, updated.id);
    }, "提交派工池失败");
  }

  async function dispatchToTechnician(technician: string) {
    if (!selectedOrder) return;
    await runOrderAction(async () => {
      const updated = await workOrderApi.transition(selectedOrder.id, "维修中", actor, `指派维修技师：${technician}`, {
        technician
      });
      await loadOrders(role, updated.id);
    }, "指派维修技师失败");
  }

  async function completeRepair() {
    if (!selectedOrder) return;
    await runOrderAction(async () => {
      const updated = await workOrderApi.transition(selectedOrder.id, "待结算", actor, role === "inspector" ? "检验通过" : "维修完成提报", {
        inspector: role === "inspector" ? actor : selectedOrder.inspector,
        signatures: role === "inspector" ? { ...selectedOrder.signatures, inspector: actor } : selectedOrder.signatures
      });
      await loadOrders(role, updated.id);
    }, "维修完成提报失败");
  }

  async function settleOrder() {
    if (!selectedOrder) return;
    await runOrderAction(async () => {
      if (!selectedOrder.settlementStatements.length) {
        await workOrderApi.createSettlement(selectedOrder.id, actor);
      }
      const updated = await workOrderApi.transition(selectedOrder.id, "完成", actor, "确认结算并归档", {
        settlementAmount: Number(draft.settlementAmount || draft.estimatedFee || totalLabor),
        feeNote: draft.feeNote
      });
      await loadOrders(role, updated.id);
    }, "确认结算归档失败");
  }

  async function completeSignature(order: WorkOrder, token: string, signatureImage: string) {
    const signatureFile = await workOrderApi.uploadFile({
      orderId: order.id,
      kind: "signature_image",
      fileName: `signature-${order.id}.png`,
      mimeType: "image/png",
      imageBase64: signatureImage
    });
    const signed = await workOrderApi.signByToken(token, order.customer.name || "客户签名", signatureFile.id);
    await loadOrders(role, signed.id);
    return signed;
  }

  async function updateRepairAction(itemId: number, action: string, patch: Record<string, unknown> = {}) {
    if (!selectedOrder) return;
    await runOrderAction(async () => {
      const updated = await workOrderApi.repairItemAction(selectedOrder.id, itemId, action, actor, patch);
      await loadOrders(role, updated.id);
      await loadDashboard(role);
    }, "维修项目操作失败");
  }

  async function createSettlement() {
    if (!selectedOrder) return;
    await runOrderAction(async () => {
      const updated = await workOrderApi.createSettlement(selectedOrder.id, actor);
      await loadOrders(role, updated.id);
      await loadDashboard(role);
    }, "生成结算清单失败");
  }

  return {
    submitDispatch,
    dispatchToTechnician,
    completeRepair,
    settleOrder,
    completeSignature,
    updateRepairAction,
    createSettlement
  };
}

function actionError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
