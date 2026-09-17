import { FileSignature, LockKeyhole, ReceiptText } from "lucide-react";
import { Button } from "antd";
import { RoleKey, WorkOrder } from "../../../../../shared/types";
import { canCompleteRepair, canDispatch, canSettle, canSubmitDispatch } from "../domain/permissions";

export function SettlementPanel({ order, role, onCreateSettlement }: { order?: WorkOrder; role: RoleKey; onCreateSettlement: () => void }) {
  return (
    <div className="permission-card">
      <div className="permission-head">
        <ReceiptText size={18} />
        <strong>结算清单</strong>
      </div>
      {!order ? <p>选择委托单后查看结算匹配。</p> : (
        <>
          <Button block disabled={!(order?.status === "待结算" && (role === "advisor" || role === "manager"))} onClick={onCreateSettlement}>同步/生成结算清单</Button>
          <div className="mini-list">
            {order.settlementStatements.length ? order.settlementStatements.map((item) => (
              <span key={item.id}>{item.matchStatus} · {item.dispatchNo} · ¥{item.amount}</span>
            )) : <span>暂无结算清单</span>}
          </div>
        </>
      )}
    </div>
  );
}


export function ActionPanel({
  order,
  role,
  onSubmitDispatch,
  onDispatch,
  technicians,
  onCompleteRepair,
  onSettle
}: {
  order?: WorkOrder;
  role: RoleKey;
  onSubmitDispatch: () => void;
  onDispatch: (technician: string) => void;
  technicians: string[];
  onCompleteRepair: () => void;
  onSettle: () => void;
}) {
  return (
    <div className="permission-card action-card">
      <div className="permission-head">
        <FileSignature size={18} />
        <strong>下一步操作</strong>
      </div>
      {!order ? <p>请先保存或选择一张委托单。</p> : null}
      {canSubmitDispatch(role, order) ? <Button type="primary" block onClick={onSubmitDispatch}>提交派工池</Button> : null}
      {order && ["已委托","待派工","维修中"].includes(order.status) ? <p>客户签字后自动进入派工列表。请从左侧“派工台”“我的维修”或“检验任务”完成后续操作。</p> : null}
      {canSettle(role, order) ? <Button type="primary" block onClick={onSettle}>确认结算归档</Button> : null}
      {order ? (
        <div className="locked-actions">
          {[
            ["提交派工池", canSubmitDispatch(role, order)],
            ["指派维修技师", canDispatch(role, order)],
            [role === "inspector" ? "检验通过" : "维修完成提报", canCompleteRepair(role, order) || (role === "inspector" && order.status === "维修中")],
            ["确认结算归档", canSettle(role, order)]
          ]
            .filter(([, allowed]) => !allowed)
            .map(([label]) => (
              <span key={String(label)}>
                <LockKeyhole size={13} />
                {label}
              </span>
            ))}
        </div>
      ) : null}
      {order ? <p>最近留痕：{order.auditLog[0]?.action ?? "暂无操作记录"}</p> : null}
    </div>
  );
}
