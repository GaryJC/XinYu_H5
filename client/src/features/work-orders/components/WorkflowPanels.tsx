import { FileSignature, LockKeyhole, ReceiptText, RefreshCcw } from "lucide-react";
import { RoleKey, WorkOrder } from "../../../../../shared/types";
import { canCompleteRepair, canDispatch, canSettle, canSubmitDispatch } from "../domain/permissions";

export function PlatformPanel({ order, role, onSync }: { order?: WorkOrder; role: RoleKey; onSync: () => void }) {
  const canSync = Boolean(order && (role === "advisor" || role === "manager") && order.status !== "草稿");
  return (
    <div className="permission-card">
      <div className="permission-head">
        <RefreshCcw size={18} />
        <strong>平台同步 / 出库单</strong>
      </div>
      {!order ? <p>选择委托单后可同步维修业务平台。</p> : (
        <>
          <p>平台工单：{order.platformOrderNo || "未同步"}；派工号：{order.dispatchNo || "待生成"}</p>
          <button className="secondary-button full-width" type="button" disabled={!canSync} onClick={onSync}>同步并生成出库单</button>
          <div className="mini-list">
            {order.platformSyncRecords.map((item) => (
              <span key={item.id}>{item.status} · {item.platformOrderNo} · {item.message}</span>
            ))}
            {order.outboundOrders.map((outbound) => (
              <span key={outbound.id}>出库单 {outbound.id} · {outbound.status} · {outbound.items.length} 项</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function SettlementPanel({ order, role, onCreateSettlement }: { order?: WorkOrder; role: RoleKey; onCreateSettlement: () => void }) {
  return (
    <div className="permission-card">
      <div className="permission-head">
        <ReceiptText size={18} />
        <strong>结算清单</strong>
      </div>
      {!order ? <p>选择委托单后查看结算匹配。</p> : (
        <>
          <button className="secondary-button full-width" type="button" disabled={!(role === "advisor" || role === "manager")} onClick={onCreateSettlement}>同步/生成结算清单</button>
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
      {canSubmitDispatch(role, order) ? <button className="primary-button" type="button" onClick={onSubmitDispatch}>提交派工池</button> : null}
      {canDispatch(role, order) ? (
        <div className="stacked-actions">
          {technicians.length ? (
            technicians.map((name) => (
              <button className="secondary-button" type="button" key={name} onClick={() => onDispatch(name)}>
                指派给{name}
              </button>
            ))
          ) : (
            <p>暂无可派技师，请先在权限设置中维护维修技师角色。</p>
          )}
        </div>
      ) : null}
      {(canCompleteRepair(role, order) || (role === "inspector" && order?.status === "维修中")) ? (
        <button className="primary-button" type="button" onClick={onCompleteRepair}>
          {role === "inspector" ? "检验通过" : "维修完成提报"}
        </button>
      ) : null}
      {canSettle(role, order) ? <button className="primary-button" type="button" onClick={onSettle}>确认结算归档</button> : null}
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
