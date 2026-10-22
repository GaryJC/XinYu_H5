import { hasRole, hasAnyRole } from "../../../../shared/roles.mjs";
import { useRef, useState } from "react";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import type { SignatureSession } from "./WorkOrderSignatureDialog";

export function useArchiveSignature(user: UserProfile | undefined, onUpdated: (order: WorkOrder) => void, onSigned: () => void) {
  const [session, setSession] = useState<SignatureSession>();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const running = useRef(false);
  function canSign(order: WorkOrder) {
    return Boolean(user?.active && user.shopId === order.shop.id && hasAnyRole(user, ["advisor", "manager"])
      && (hasRole(user, 'manager') || order.advisor === user.name)
      && !order.customerSignatureFileId);
  }
  async function start(order: WorkOrder) {
    if (running.current || !canSign(order)) return;
    running.current = true;
    setStarting(true);
    setError("");
    try {
      const updated = await workOrderApi.createSignatureToken(order.id, user!.name);
      if (!updated || updated.id !== order.id || (updated.signaturePurpose !== "supplement" && !["草稿", "待客户签字"].includes(updated.status)) || !updated.signatureToken || updated.signatureTokenUsed) {
        throw new Error("签字会话不存在、已失效或已完成，请刷新委托单后重试。");
      }
      onUpdated(updated);
      setSession({ order: updated, token: updated.signatureToken });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发起签字失败");
    } finally {
      running.current = false;
      setStarting(false);
    }
  }
  async function completeSignature(order: WorkOrder, token: string, imageBase64: string) {
    const file = await workOrderApi.uploadFile({ orderId: order.id, kind: "signature_image",
      fileName: `signature-${order.id}.png`, mimeType: "image/png", imageBase64 });
    const signed = await workOrderApi.signByToken(token, order.customer.name || "客户签名", file.id);
    onUpdated(signed);
    onSigned();
    return signed;
  }
  return { session, error, starting, canSign, start, completeSignature,
    close: () => setSession(undefined), clearError: () => setError("") };
}
