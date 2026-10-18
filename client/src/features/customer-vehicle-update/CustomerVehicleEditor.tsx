import { Alert, Button, Form, Input, Tooltip } from "antd";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { FormDialog } from "../../shared/ui/BusinessForm";
import { VehicleReferenceAutocomplete } from "../vehicle-identity/VehicleReferenceAutocomplete";
import { CreateVehicleReferenceButton } from "../vehicle-identity/CreateVehicleReferenceButton";
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
      <Button style={{ whiteSpace: "normal", height: "auto", minHeight: 36 }} disabled={!editor.canEdit || busy} onClick={editor.open}>修改联系及车辆信息{!editor.hasPermission ? "（仅负责人/管理员）" : !order.customerVehicleEditEnabled ? "（待启用）" : ""}</Button>
    </span></Tooltip>
    <FormDialog open={Boolean(change)} title="修改联系及车辆信息" okText="保存并提交润丰更新" cancelText="取消"
      confirmLoading={editor.saving} okButtonProps={{ disabled: !editor.canEdit || disabled }}
      cancelButtonProps={{ disabled: editor.saving }} closable={!editor.saving} mask={{ closable: !editor.saving }}
      onCancel={editor.close} onOk={() => void editor.save()} destroyOnHidden>
      <Alert type="info" showIcon title={order.dispatchNo ? `更新派工号：${order.dispatchNo}` : "首次同步后自动关联润丰派工号"}
        description="保存后由润丰按顺序更新当前单及车辆档案。待拉取、拉取中均可继续修改，新修改会排队补发；不会批量更改同车其他历史单。" style={{ marginBottom: 16 }} />
      {editor.error && <Alert role="alert" type="error" showIcon title={editor.error} style={{ marginBottom: 12 }} />}
      {change && <Form layout="vertical">
        <Form.Item label="联系人" required><Input aria-label="更正联系人" maxLength={50} value={change.contact} disabled={busy}
          onChange={event => setChange({ ...change, contact: event.target.value })} /></Form.Item>
        <Form.Item label="联系方式" required><Input aria-label="更正联系方式" type="tel" maxLength={50} value={change.phone} disabled={busy}
          onChange={event => setChange({ ...change, phone: event.target.value })} /></Form.Item>
        {(["model", "organization"] as const).map(kind => {
          const model = kind === "model";
          const name = model ? change.model : change.organization;
          const code = model ? change.modelLegacyCode : change.organizationLegacyCode;
          const label = model ? "车型" : "所属单位";
          const select = (candidate: { value: string; code?: string }) => setChange(current => current ? {
            ...current, ...(model ? { model: candidate.value, modelLegacyCode: candidate.code || "" }
              : { organization: candidate.value, organizationLegacyCode: candidate.code || "" })
          } : current);
          return <Form.Item key={kind} label={label} required>
            <VehicleReferenceAutocomplete kind={kind} value={name} code={code} ariaLabel={`更正${label}`} disabled={busy}
              placeholder={`查询已有${label}，或使用下方新增`} onSelect={select}
              onChange={value => setChange(current => current ? { ...current, ...(model
                ? { model: value, modelLegacyCode: "" } : { organization: value, organizationLegacyCode: "" }) } : current)} />
            <CreateVehicleReferenceButton kind={kind} currentName={name} currentCode={code} disabled={busy} onCreate={select} />
          </Form.Item>;
        })}
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
