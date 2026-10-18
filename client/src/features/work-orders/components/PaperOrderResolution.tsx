import { usePaperOrderResolution } from "../hooks/usePaperOrderResolution";
import { Alert, Button, Input, Radio, Space, Tag } from "antd";
import type { WorkOrder, UserProfile } from "../../../../../shared/types";
import "../paper-order.css";

export function PaperOrderResolution({order,user,onUpdated,onEdit}:{order:WorkOrder;user?:UserProfile;onUpdated:(order:WorkOrder)=>void;onEdit:(order:WorkOrder)=>void}) {
  const { mode, setMode, dispatchNo, setDispatchNo, busy, error, canProcess, canChoose, isDingTalkDraft, resolve } =
    usePaperOrderResolution(order, user, onUpdated, onEdit);
  if (!order.paperOrder) return null;
  return <section className="paper-order-resolution" style={{marginBottom:16}}>
    <Tag className="paper-order-resolution-tag" color="orange">纸质委托书</Tag>
    {canChoose ? <>
      <Alert type="info" showIcon title={isDingTalkDraft ? "尚未提交，可重新选择开单方式" : "请选择纸质委托书的开单方式"}
        description={isDingTalkDraft ? "可继续补全钉钉委托单，或改为关联润丰派工单。关联后将以润丰资料替换草稿信息，保留纸质照片。" : "关联润丰已有派工单，或在钉钉补全开单信息。委托书照片已保存，无需电子签字。"} style={{marginBottom:12}}/>
      {!canProcess && <p>{isDingTalkDraft ? "请由本单负责顾问或所属门店管理员处理。" : "请由委托单所属门店的服务顾问或管理员处理。"}</p>}
      {canProcess && <Space orientation="vertical" style={{width:"100%"}}>
        <Radio.Group aria-label="纸质委托书开单方式" value={mode} disabled={busy} onChange={event=>setMode(event.target.value)}>
          <Radio value="runfeng">已在润丰创建</Radio><Radio value="dingtalk">在钉钉创建</Radio>
        </Radio.Group>
        {mode==="runfeng" && <Input aria-label="润丰派工号" placeholder="输入润丰派工号" value={dispatchNo} disabled={busy} onChange={event=>setDispatchNo(event.target.value)}/>}
        <Button type="primary" loading={busy} disabled={mode==="runfeng" && !dispatchNo.trim()} onClick={()=>void resolve()}>{mode==="runfeng" ? "拉取并关联润丰派工单" : isDingTalkDraft ? "继续补全钉钉委托单" : "补全钉钉委托单"}</Button>
      </Space>}
    </> : <>
      <Alert type={order.status === "草稿" ? "info" : "success"} showIcon
        title={order.paperOrder.mode === "runfeng" ? `已关联润丰派工号：${order.dispatchNo}` : order.status === "草稿" ? "已选择在钉钉创建，请补全并提交" : "凭纸质委托书开单，无需电子签字"} />
      {order.status === "草稿" && canProcess && (user?.role === "manager" || user?.name === order.advisor) &&
        <Button type="primary" style={{ marginTop: 12 }} onClick={() => onEdit(order)}>继续补全钉钉委托单</Button>}
    </>}
    {error && <Alert type="error" showIcon title={error} style={{marginTop:12}}/>}
  </section>;
}
