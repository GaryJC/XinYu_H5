import { FileSignature } from "lucide-react";
import { useEffect, useState } from "react";
import { WorkOrder } from "../../../../shared/types";
import { sumLabor } from "../work-orders/domain/workOrderDomain";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { Summary } from "../../shared/ui/FormControls";

export function SignaturePage({ token, onBack }: { token: string; onBack: () => void }) {
  const [order, setOrder] = useState<WorkOrder | undefined>();
  const [signature, setSignature] = useState("");
  const [message, setMessage] = useState("正在读取签字链接...");

  useEffect(() => {
    void workOrderApi.findByToken(token).then((found) => {
      setOrder(found);
      setMessage(found ? "请核对委托信息并签字确认。" : "签字链接不存在或已失效。");
      setSignature(found?.customer.name ?? "");
    });
  }, [token]);

  async function sign() {
    if (!signature.trim()) {
      setMessage("请填写签名。");
      return;
    }
    try {
      const signed = await workOrderApi.signByToken(token, signature.trim());
      setOrder(signed);
      setMessage("签字完成，委托单已进入“已委托”。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "签字失败");
    }
  }

  return (
    <main className="signature-page">
      <section className="panel signature-panel">
        <div className="panel-header">
          <div>
            <h1>机动车维修委托确认</h1>
            <p>{message}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onBack}>返回工作台</button>
        </div>
        {order ? (
          <>
            <div className="summary-grid">
              <Summary label="委托单号" value={order.id} />
              <Summary label="车牌号码" value={order.vehicle.plate} />
              <Summary label="车主" value={order.customer.name} />
              <Summary label="车型" value={order.vehicle.model || "-"} />
              <Summary label="预计费用" value={`¥${order.estimatedFee || sumLabor(order.repairItems)}`} />
              <Summary label="旧件处置" value={order.oldPartsHandling} />
            </div>
            <div className="public-items">
              {order.repairItems.map((item) => (
                <div key={item.id}>
                  <span>{item.name}</span>
                  <strong>¥{item.laborFee}</strong>
                </div>
              ))}
            </div>
            <label className="field">
              <span>电子签名</span>
              <div className="signature-pad">
                <input value={signature} onChange={(event) => setSignature(event.target.value)} disabled={order.signatureTokenUsed} />
              </div>
            </label>
            <button className="primary-button full-width" type="button" onClick={sign} disabled={order.signatureTokenUsed}>
              <FileSignature size={16} />
              {order.signatureTokenUsed ? "已签字" : "确认签字"}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}
