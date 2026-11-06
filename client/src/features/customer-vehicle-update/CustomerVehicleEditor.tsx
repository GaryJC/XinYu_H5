import { Alert, Button, Form, Input, Tooltip } from "antd";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { FormDialog } from "../../shared/ui/BusinessForm";
import { useCustomerVehicleEditor } from "./useCustomerVehicleEditor";


export function CustomerVehicleEditor({ order, user, onUpdated, disabled }: {
  order: WorkOrder; user?: UserProfile; onUpdated: (order: WorkOrder) => void; disabled?: boolean;
}) {
  const editor = useCustomerVehicleEditor(order, user, onUpdated);
  const { change, setChange } = editor;
  if (!editor.canSee && !change) return null;
  const busy = editor.saving || disabled;
  return <>
    <Tooltip title={editor.disabledReason} trigger={["hover", "click"]}><span style={{ minWidth: 0 }}>
      <Button style={{ whiteSpace: "normal", height: "auto", minHeight: 36 }} disabled={!editor.canEdit || busy} onClick={editor.open}>修改联系人和电话{!editor.hasPermission ? "（仅负责人/管理员）" : !order.customerVehicleEditEnabled ? "（待启用）" : ""}</Button>
    </span></Tooltip>
    <FormDialog open={Boolean(change)} title="修改联系人和电话" okText="保存并提交润丰更新" cancelText="取消"
      confirmLoading={editor.saving} okButtonProps={{ disabled: !editor.canEdit || disabled }}
      cancelButtonProps={{ disabled: editor.saving }} closable={!editor.saving} mask={{ closable: !editor.saving }}
      onCancel={editor.close} onOk={() => void editor.save()} destroyOnHidden>
      <Alert type="info" showIcon title={order.dispatchNo ? `更新派工号：${order.dispatchNo}` : "首次同步后自动关联润丰派工号"}
        description="保存后，联系人和电话会排队同步至润丰。" style={{ marginBottom: 16 }} />
      {editor.error && <Alert role="alert" type="error" showIcon title={editor.error} style={{ marginBottom: 12 }} />}
      {change && <Form layout="vertical">
        <Form.Item label="联系人" required><Input aria-label="更正联系人" maxLength={50} value={change.contact} disabled={busy}
          onChange={event => setChange({ ...change, contact: event.target.value })} /></Form.Item>
        <Form.Item label="联系电话" required><Input aria-label="更正联系电话" type="tel" maxLength={50} value={change.phone} disabled={busy}
          onChange={event => setChange({ ...change, phone: event.target.value })} /></Form.Item>
      </Form>}
    </FormDialog>
  </>;
}

export function CustomerVehicleUpdateNotice({ order }: { order: WorkOrder }) {
  if (!order.customerVehicleUpdatedAt) return null;
  const status = order.legacySyncStatus;
  const title = status === "synced" ? "联系及车辆信息已同步至润丰" : status === "failed" ? "联系及车辆信息更新失败"
    : status === "processing" ? "润丰正在更新联系及车辆信息" : "联系及车辆信息已保存，待更新";
  return <Alert showIcon type={status === "failed" ? "error" : status === "synced" ? "success" : "info"} title={title}
    description={`${order.customerVehicleUpdatedBy || ""} · ${order.customerVehicleUpdatedAt}${order.legacySyncError ? `；${order.legacySyncError}` : ""}。可点击“刷新列表”查看最新同步结果。`}
    style={{ marginBottom: 12 }} />;
}
