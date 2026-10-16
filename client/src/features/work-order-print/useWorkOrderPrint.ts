import { useEffect, useState } from "react";
import type { WorkOrder } from "../../../../shared/types";
import { requestBlob } from "../../shared/api/httpClient";

export function useWorkOrderPrint(order: WorkOrder, printSignature = true) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSource("");
    setError("");
    setLoading(true);
    async function load() {
      if (!printSignature || !order.signatures.customer) return;
      const files = (order.files || []).filter(file => file.kind === "signature_image");
      const fileId = order.customerSignatureFileId || (files.length === 1 ? files[0].id : undefined);
      if (!fileId) throw new Error("未找到可确认的客户签名图片，请刷新委托单后重试。");
      const blob = await requestBlob(`/api/files/${encodeURIComponent(fileId)}/content`);
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (active) setSource(objectUrl);
    }
    void load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "签名加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [order, attempt, printSignature]);
  return { source, loading, error, retry: () => setAttempt(value => value + 1) };
}
