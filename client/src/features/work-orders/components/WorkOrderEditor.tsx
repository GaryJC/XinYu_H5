import {useDirectDispatch} from '../hooks/useDirectDispatch';
import {VehicleLicenseHistoryPrompt} from '../../vehicle-license-history/VehicleLicenseHistoryPrompt';
import { useRepairConfirmationRows } from "../hooks/useRepairConfirmationRows";
import { CustomerSignatureSection } from "../../signature/CustomerSignatureSection";
import { SignatureReview } from "../../signature/SignatureReview";
import { PaperOrderPhotos } from "./PaperOrderPhotos";
import { CustomerVehicleUpdateTag } from "../../customer-vehicle-update/CustomerVehicleUpdateTag";
import { PaperOrderResolution } from "./PaperOrderResolution";
import { SubmittedOrderPhotos } from "../../work-order-photos/SubmittedOrderPhotos";
import { VehicleScanIllustration } from "../../vehicle-identity/VehicleScanIllustration";
import {VehicleLicenseExceptionNotice,VehicleLicenseAvailability} from './VehicleLicenseException';
import {isCurrentVehicleLicenseException} from '../domain/vehicleLicenseException';
import "../work-order-form.css";
import { PreRepairPhotos } from "../../pre-repair-photos/PreRepairPhotos";
import { LockKeyhole, Plus, Save, Send, Trash2 } from "lucide-react";
import { Alert, Button, Checkbox, DatePicker, Form, Grid, Input, Radio, Select, Tooltip } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { WorkOrder, WorkOrderDraft } from "../../../../../shared/types";
import { canCreateOrder, canSendSignature } from "../domain/permissions";
import { Checklist, Field, TextArea } from "../../../shared/ui/FormControls";
import { ImageSourcePicker } from "../../../shared/ui/ImageSourcePicker";
import { VehicleLicenseOcrControl } from "../../vehicle-license-ocr/VehicleLicenseOcrControl";
import { VehicleIdentityRecognition } from "../../vehicle-identity/VehicleIdentityRecognition";
import { VehicleReferenceAutocomplete } from "../../vehicle-identity/VehicleReferenceAutocomplete";
import { VehicleReferenceTags } from "../../vehicle-identity/VehicleReferenceTags";
import { CreateVehicleReferenceButton } from "../../vehicle-identity/CreateVehicleReferenceButton";
import { WorkbenchController } from "../../workbench/useWorkbenchController";
import { belongings, exteriorIssues } from "../../workbench/workbenchConfig";
import { WorkOrderSignatureDialog } from "../../signature/WorkOrderSignatureDialog";
import { FormActionBar, FormSection, FormSurface } from "../../../shared/ui/BusinessForm";

export function WorkOrderEditor({ controller }: { controller: WorkbenchController }) {
  const [signatureSession, setSignatureSession] = useState<{ token: string; order: WorkOrder }>();
  const [showSignatureValidation, setShowSignatureValidation] = useState(false);
  const [modelCreateRequest, setModelCreateRequest] = useState<{ key: number; name: string }>();
  const [organizationCreateRequest, setOrganizationCreateRequest] = useState<{ key: number; name: string }>();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const {
    selectedOrder, startNewOrder, canEditForm, saveDraft, role, sendSignature,
    formErrors, vehicleLicenseOcr, ocrState, scanVehicleLicense,
    confirmVehicleLicenseOcr, draft, updateDraft, updateVehicle, updateCustomer,
    toggleArrayField, setDraft,
    actionLoading, completeSignature, identifierRecognition,
    vehicleHistory, vehicleHistoryLoading, vehicleHistoryError, scanVehicleIdentifier,
    lookupVehicleLicenseForDevelopment, selectVehicleReference, departments, departmentError
  } = controller;
  const confirmationRows=useRepairConfirmationRows(draft,setDraft);
  const directDispatch=useDirectDispatch(draft,setDraft,controller.users,selectedOrder?.id);
  const paperOnly = draft.paperOrder?.mode === "pending";
  const paperDingTalk = draft.paperOrder?.mode === "dingtalk";
  const showLegacySyncStatus = Boolean(selectedOrder && !["草稿","待客户签字"].includes(selectedOrder.status));
  const fieldError = (...phrases: string[]) => formErrors.find((error) => phrases.some((phrase) => error.includes(phrase)));
  const hasValidationError = formErrors.some((error) => ["必填", "VIN", "里程", "维修项目", "编码", "选择已有"].some((phrase) => error.includes(phrase)));
  const canResumeSignature = Boolean(selectedOrder?.status === "待客户签字" && !selectedOrder.signatures.customer);
  const signatureDisabled = Boolean(actionLoading) || Boolean(controller.preRepairPhotos.uploading) || !canResumeSignature && (!canEditForm || (Boolean(selectedOrder) && !canSendSignature(role, selectedOrder)));
  const signatureDisabledReason = selectedOrder && !["草稿", "待客户签字"].includes(selectedOrder.status) ? `当前状态“${selectedOrder.status}”不能再次发起签字` : "";
  const signatureUploaded = Boolean(selectedOrder?.signatures.customer);
  const signatureUploadDescription = selectedOrder?.status === "待客户签字" ? "客户签名已保存，等待服务顾问确认；确认后才进入润丰拉取队列。" : selectedOrder?.legacySyncStatus === "synced"
    ? `委托单已同步至润丰${selectedOrder.dispatchNo ? `，派工号：${selectedOrder.dispatchNo}` : ""}。`
    : selectedOrder?.legacySyncStatus === "failed"
      ? `签字已保存，但润丰同步失败：${selectedOrder.legacySyncError || "请联系管理员处理"}`
      : selectedOrder?.legacySyncStatus === "processing"
        ? "签字和委托单已上传，润丰正在处理。"
        : "签字和委托单已上传，正在等待润丰系统拉取。";
  const licenseExceptionCurrent=isCurrentVehicleLicenseException(draft.vehicleLicenseException,draft.vehicle);
  const hasVehicleLicense = !canEditForm && selectedOrder && selectedOrder.status !== "草稿"
    ? Boolean(selectedOrder.files?.some(file => file.kind === "vehicle_license" && !selectedOrder.inspection.replacedPhotoIds?.includes(file.id)))
    : Boolean(controller.vehicleLicenseFileId || draft.inspection.vehicleLicenseFileId || selectedOrder?.files?.some(file => file.kind === "vehicle_license" && !selectedOrder.inspection.replacedPhotoIds?.includes(file.id)));

  async function handleSendSignature() {
    const session = await sendSignature();
    if (session) {
      setShowSignatureValidation(false);
      setSignatureSession(session);
      return;
    }
    setShowSignatureValidation(true);
    scrollToFirstFormError();
  }

  return (
<FormSurface className="panel form-panel">
          <Form layout="vertical" requiredMark disabled={Boolean(actionLoading)}>
            <div className="panel-header">
              <div>
                <h2>{selectedOrder ? "委托开单" : "新建委托开单"}</h2>
                <p>{paperOnly ? "上传纸质委托书照片，创建后选择开单方式。" : "先识别车辆，再完善接车与维修信息。"}</p>
              </div>
              <div className="button-row">
                <Button className="new-order-button" color="primary" variant="outlined" icon={<Plus size={16} />} onClick={startNewOrder} disabled={!canCreateOrder(role) || Boolean(actionLoading)}>新建委托</Button>
              </div>
            </div>

            <Form.Item label="委托书形式">
              <Radio.Group aria-label="使用纸质委托书" value={Boolean(draft.paperOrder)} disabled={Boolean(selectedOrder) || !canEditForm || controller.paperPhotos.uploading}
                onChange={event=>updateDraft({paperOrder:event.target.value ? {mode:"pending",photoIds:[]} : undefined})}>
                <Radio value={false}>电子委托书</Radio><Radio value={true}>使用纸质委托书</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item>
              <Checkbox checked={draft.isBaiyuanOrder === true} disabled={!canEditForm || Boolean(actionLoading)} onChange={event=>updateDraft({isBaiyuanOrder:event.target.checked})}>百援门店单</Checkbox>
            </Form.Item>

            <dl className="order-form-summary" aria-label="委托单摘要">
              <div><dt>委托单号</dt><dd>{selectedOrder?.id || "新建草稿"}</dd></div>
              <div><dt>服务顾问</dt><dd>{draft.advisor || "根据钉钉账号自动填写"}</dd></div>
              <div><dt>派工号</dt><dd>{draft.dispatchNo || (paperOnly ? "待选择开单方式" : "同步成功后自动回填")}</dd></div>
            </dl>

            {selectedOrder && <CustomerVehicleUpdateTag order={selectedOrder} />}

            {selectedOrder?.platformOrderNo ? (
              <Alert className="platform-sync-state" type="success" showIcon title={`已同步平台工单：${selectedOrder.platformOrderNo}`} />
            ) : null}

            {showLegacySyncStatus && selectedOrder?.legacySyncStatus === "pending" ? (
              <Alert className="platform-sync-state" type="info" showIcon title={selectedOrder.customerVehicleUpdatedAt ? "修改已保存，等待润丰更新" : draft.paperOrder ? "纸质委托单已提交，等待润丰系统拉取" : "委托单已完成签字，等待润丰系统拉取"} />
            ) : null}

            {showLegacySyncStatus && selectedOrder?.legacySyncStatus === "processing" ? (
              <Alert className="platform-sync-state" type="info" showIcon title="润丰系统正在处理当前委托单" />
            ) : null}

            {showLegacySyncStatus && selectedOrder?.legacySyncStatus === "synced" ? (
              <Alert className="platform-sync-state" type="success" showIcon title={`润丰同步成功${selectedOrder.dispatchNo ? `：${selectedOrder.dispatchNo}` : ""}`} />
            ) : null}

            {showLegacySyncStatus && selectedOrder?.legacySyncStatus === "failed" ? (
              <Alert className="platform-sync-state" type="error" showIcon title="润丰同步失败" description={selectedOrder.legacySyncError || "请联系管理员重试同步"} />
            ) : null}

            {formErrors.length ? (
              <Alert className="error-box" type="error" showIcon title={hasValidationError ? "请完善委托单信息" : "操作失败"} description={formErrors.join("；")} />
            ) : null}

            {canEditForm&&selectedOrder?.status==="待客户签字"?<Alert type="info" showIcon title="客户尚未签字，可以修改委托单" description="保存修改后旧签字链接失效，请重新发送签字链接。"/>:null}
            {!canEditForm ? (
              <div className="readonly-banner">
                <LockKeyhole size={16} />
                {paperOnly ? "纸质委托书已创建，请在下方选择开单方式。" : canResumeSignature ? "当前委托单内容已锁定，但可以继续完成已发起的客户签字。" : "当前角色只能查看此委托单，字段编辑、OCR 和签字发起已锁定。"}
              </div>
            ) : null}

            {draft.paperOrder && <FormSection title="纸质委托书照片">
              <PaperOrderPhotos ids={draft.paperOrder.photoIds} disabled={!canEditForm || Boolean(selectedOrder)} controls={controller.paperPhotos}/>
              {paperOnly && <p className="paper-order-help">只需上传委托书照片。创建后可在详情中选择关联润丰派工单，或在钉钉补全开单。</p>}
              {selectedOrder?.paperOrder?.mode==="pending" && <PaperOrderResolution order={selectedOrder} user={controller.currentUser}
                onUpdated={order=>{controller.acceptRefreshedOrder(order);controller.selectOrder(order);}} onEdit={controller.selectOrder}/>}
            </FormSection>}
            {!paperOnly && <>
            <VehicleLicenseHistoryPrompt controller={controller.licenseHistory}/>
            <FormSection title="车辆识别与资料" description="请上传行驶证照片；本次无法提供时须填写理由，后续可在委托单详情补传。OCR 确认选填。">
            <VehicleIdentityRecognition
              disabled={!canEditForm}
              recognition={identifierRecognition}
              history={vehicleHistory}
              historyLoading={vehicleHistoryLoading}
              historyError={vehicleHistoryError}
              onScan={scanVehicleIdentifier}
              onManualLicenseLookup={lookupVehicleLicenseForDevelopment}
            />

            <Form.Item label="是否军车">
              <Radio.Group aria-label="是否军车" disabled={!canEditForm} value={draft.vehicle.isMilitary === true}
                onChange={event => setDraft(current => ({...current, vehicle:{...current.vehicle, isMilitary:event.target.value === true}}))}>
                <Radio value={false}>否</Radio><Radio value={true}>是</Radio>
              </Radio.Group>
            </Form.Item>
            {draft.vehicle.isMilitary ? <Alert type="info" showIcon title="军车无需上传行驶证" style={{marginBottom:16}}/> : <>
            <VehicleLicenseAvailability key={`${draft.vehicle.plate}-${draft.vehicle.vin}-${licenseExceptionCurrent}-${hasVehicleLicense}`} disabled={!canEditForm||Boolean(actionLoading)} missing={licenseExceptionCurrent} hasPhoto={hasVehicleLicense} onConfirm={controller.reportMissingVehicleLicense}/>
            <Form.Item
              className="ocr-form-item"
              label="行驶证照片"
              required={!licenseExceptionCurrent}
              validateStatus={fieldError("行驶证") ? "error" : undefined}
              help={fieldError("行驶证")}
            >
              {selectedOrder && selectedOrder.status !== "草稿" && !canEditForm ? <SubmittedOrderPhotos key={selectedOrder.id} section="license" order={selectedOrder}
                user={controller.currentUser} onUpdated={controller.acceptRefreshedOrder}/> : <div className="ocr-grid">
                <VehicleLicenseOcrControl
                  disabled={!canEditForm}
                  result={vehicleLicenseOcr}
                  fileId={controller.vehicleLicenseFileId}
                  state={ocrState.vehicleLicense}
                  onScan={scanVehicleLicense}
                  onConfirm={confirmVehicleLicenseOcr}
                />
              </div>}
              {draft.vehicleLicenseException?<div style={{marginTop:12}}><VehicleLicenseExceptionNotice exception={draft.vehicleLicenseException} current={licenseExceptionCurrent}/></div>:null}
            </Form.Item>
            </>}

            <div className="field-grid">
              <Field required error={fieldError("车牌号码")} disabled={!canEditForm} label="车牌号码" value={draft.vehicle.plate} onChange={(value) => updateVehicle("plate", value)} />
              <div style={{ marginBottom: 16 }}>
                <Field required error={fieldError("VIN")} disabled={!canEditForm} label="VIN/底盘号" value={draft.vehicle.vin} onChange={(value) => updateVehicle("vin", value)} />
                <ImageSourcePicker
                  disabled={!canEditForm || vehicleHistoryLoading}
                  loading={identifierRecognition.vin.status === "识别中"}
                  label="VIN 码识别"
                  cameraArtwork={<VehicleScanIllustration kind="vin" />}
                  primaryActionLabel="拍照识别 VIN"
                  onSelect={(file) => scanVehicleIdentifier("vin", file)}
                />
                <div role="status" style={{ marginTop: 8, color: "rgba(0, 0, 0, .65)", fontSize: 12 }}>
                  {identifierRecognition.vin.status === "识别中"
                    ? "正在识别 VIN 码…"
                    : identifierRecognition.vin.error || "对准完整的 17 位 VIN 码拍照，识别后自动填写。"}
                </div>
              </div>
              <Field required error={fieldError("进厂里程")} disabled={!canEditForm} label="进厂里程" value={draft.vehicle.mileage} suffix="km" onChange={(value) => updateVehicle("mileage", value)} />
              <Form.Item className="field" label="车型" required validateStatus={fieldError("车型") ? "error" : undefined} help={fieldError("车型")}>
                <VehicleReferenceAutocomplete
                  kind="model"
                  ariaLabel="车型"
                  disabled={!canEditForm}
                  placeholder="输入至少两个字符查询已有车型"
                  value={draft.vehicle.model}
                  code={draft.vehicle.modelLegacyCode}
                  onChange={(value) => updateVehicle("model", value)}
                  onClear={() => updateVehicle("model", "")}
                  onRequestCreate={(name) => setModelCreateRequest({ key: Date.now(), name })}
                  onSelect={(candidate) => selectVehicleReference("model", candidate)}
                />
                <VehicleReferenceTags
                  label="车型"
                  disabled={!canEditForm}
                  resolution={vehicleHistory?.references?.model}
                  onSelect={(candidate) => selectVehicleReference("model", candidate)}
                />
                <CreateVehicleReferenceButton
                  kind="model"
                  currentName={draft.vehicle.model}
                  currentCode={draft.vehicle.modelLegacyCode}
                  disabled={!canEditForm}
                  openRequest={modelCreateRequest}
                  onCreate={(candidate) => selectVehicleReference("model", candidate)}
                />
              </Form.Item>
            </div>
            </FormSection>
            <FormSection title="客户联系信息">
            <div className="field-grid">
              <Form.Item className="field" label="车主名称/所属单位" required validateStatus={fieldError("车主名称/所属单位") ? "error" : undefined} help={fieldError("车主名称/所属单位")}>
                <VehicleReferenceAutocomplete
                  kind="organization"
                  ariaLabel="车主名称/所属单位"
                  disabled={!canEditForm}
                  placeholder="输入至少两个字符查询已有单位"
                  value={draft.customer.name}
                  code={draft.customer.legacyCode}
                  onChange={(value) => updateCustomer("name", value)}
                  onClear={() => updateCustomer("name", "")}
                  onRequestCreate={(name) => setOrganizationCreateRequest({ key: Date.now(), name })}
                  onSelect={(candidate) => {
                    setDraft((current) => ({
                      ...current,
                      customer: {
                        ...current.customer,
                        name: candidate.value,
                        legacyCode: candidate.code || "",
                        contact: candidate.value
                      }
                    }));
                  }}
                />
                <VehicleReferenceTags
                  label="车主名称/所属单位"
                  disabled={!canEditForm}
                  resolution={vehicleHistory?.references?.organization}
                  onSelect={(candidate) => selectVehicleReference("organization", candidate)}
                />
                <CreateVehicleReferenceButton
                  kind="organization"
                  currentName={draft.customer.name}
                  currentCode={draft.customer.legacyCode}
                  disabled={!canEditForm}
                  openRequest={organizationCreateRequest}
                  onCreate={(candidate) => selectVehicleReference("organization", candidate)}
                />
              </Form.Item>
              <Field disabled={!canEditForm} label="联系人" value={draft.customer.contact} onChange={(value) => updateCustomer("contact", value)} />
              <Field required error={fieldError("联系电话")} disabled={!canEditForm} label="联系电话" value={draft.customer.phone} onChange={(value) => updateCustomer("phone", value)} />
            </div>

            <Field disabled={!canEditForm} label="车辆地址" value={draft.customer.address} onChange={(value) => updateCustomer("address", value)} />
            </FormSection>
            <FormSection title="接车检查与照片">
            <div className="field-grid">
              <Form.Item className="field" label="进厂日期">
                <DatePicker
                  aria-label="进厂日期"
                  allowClear={false}
                  disabled={!canEditForm}
                  format="YYYY-MM-DD"
                  inputReadOnly={isMobile}
                  value={draft.arrivalDate ? dayjs(draft.arrivalDate) : null}
                  onChange={(date) => updateDraft({ arrivalDate: date?.format("YYYY-MM-DD") || "" })}
                />
              </Form.Item>
              <Form.Item
                className="field"
                label="部门"
                required
                validateStatus={fieldError("部门") || departmentError ? "error" : undefined}
                help={fieldError("部门") || departmentError}
              >
                <Select
                  aria-label="部门"
                  disabled={!canEditForm}
                  placeholder="请选择部门"
                  value={draft.department.code || undefined}
                  options={departments.map((item) => ({
                    value: item.code,
                    label: `${item.code} ${item.name}`
                  }))}
                  onChange={(code) => {
                    const department = departments.find((item) => item.code === code);
                    updateDraft({
                      department: {
                        code,
                        name: department?.name || ""
                      }
                    });
                  }}
                />
              </Form.Item>
            </div>
            <TextArea disabled={!canEditForm} label="故障描述 / 客户诉求" value={draft.faultDescription} onChange={(value) => updateDraft({ faultDescription: value })} />

            {selectedOrder && selectedOrder.status !== "草稿" && !canEditForm ? <SubmittedOrderPhotos key={selectedOrder.id} section="repair" order={selectedOrder}
              user={controller.currentUser} onUpdated={controller.acceptRefreshedOrder}/> : !draft.paperOrder && <PreRepairPhotos key={`${controller.currentUser?.id}-${controller.preRepairPhotos.sessionId}`} photos={draft.inspection.preRepairPhotos} disabled={!canEditForm || Boolean(actionLoading)} controls={controller.preRepairPhotos} errors={formErrors} />}

            <div className="check-section">
              <Checklist disabled={!canEditForm} title="随车物品" items={belongings} selected={draft.inspection.belongings} onToggle={(value) => toggleArrayField("belongings", value)} />
              <Checklist disabled={!canEditForm} title="车辆外观状况" items={exteriorIssues} selected={draft.inspection.exteriorIssues} onToggle={(value) => toggleArrayField("exteriorIssues", value)} />
              <Form.Item className="field" label="燃油存量">
                <Select
                  aria-label="燃油存量"
                  disabled={!canEditForm}
                  value={draft.inspection.fuelLevel}
                  onChange={(value) => setDraft((current) => ({ ...current, inspection: { ...current.inspection, fuelLevel: value as WorkOrderDraft["inspection"]["fuelLevel"] } }))}
                  options={["空", "1/4", "1/2", "3/4", "满"].map((item) => ({ value: item }))}
                />
              </Form.Item>
            </div>

            </FormSection>
            <FormSection title="维修项目">
            <Form.Item>
              <Checkbox checked={Boolean(draft.dispatchPlan)} disabled={!canEditForm} onChange={event=>directDispatch.enable(event.target.checked)}>直接派工</Checkbox>
              {draft.dispatchPlan && <p>勾选多个项目可批量设置或更换负责人，每项仍由一名维修工负责。现场签字完成后自动进入待接单；远程签字需经服务顾问确认。</p>}
            </Form.Item>
            {draft.dispatchPlan && <Form.Item label="派工预计完工时间" required>
              <DatePicker showTime disabled={!canEditForm} aria-label="派工预计完工时间" value={draft.dispatchPlan.dueAt?dayjs(draft.dispatchPlan.dueAt):null} onChange={value=>directDispatch.due(value?.toISOString()||'')} />
            </Form.Item>}
            <div className="section-title-row">
              <Form.Item className="section-title-form-item" label="维修项目明细" required validateStatus={fieldError("维修项目") ? "error" : undefined} help={fieldError("维修项目")}>
                <span>每项单独填写；需客户确认的项目可勾选“待定”</span>
              </Form.Item>
              <Button
                type="link"
                icon={<Plus size={15} />}
                disabled={!canEditForm}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    repairItems: [...current.repairItems, { id: Date.now(), name: "", laborFee: 0, owner: "待派工", startAt: "", finishAt: "", inspector: "待检验", status: "待派工" }]
                  }))
                }
              >
                新增项目
              </Button>
            </div>

            {draft.dispatchPlan && <div className="direct-dispatch-batch" aria-label="批量设置项目负责人">
              <Checkbox aria-label="全选可派工项目" disabled={!canEditForm || !draft.repairItems.length} checked={directDispatch.allSelected} indeterminate={directDispatch.selected.length>0&&!directDispatch.allSelected} onChange={event=>directDispatch.selectAll(event.target.checked)}>全选可派工项目</Checkbox>
              <span>已选 {directDispatch.selected.length} 项</span>
              <Select aria-label="批量设置负责人" showSearch optionFilterProp="label" disabled={!canEditForm || !directDispatch.selected.length} placeholder="选择负责人，应用到已选项目" options={directDispatch.options} value={directDispatch.bulkValue} onChange={directDispatch.assignSelected} />
            </div>}
            <div className="repair-table repair-items-editor" role="table" aria-label="维修项目明细">
              <div className="repair-row repair-head" role="row">
                <span>项目</span>
                <span>操作</span>
              </div>
              {confirmationRows.rows.map((item,index) => (
                <div className="repair-row" role="row" key={item.key}>
                  <div className="repair-item-content" data-label={`项目 ${index + 1}`}>
                    {draft.dispatchPlan && <Checkbox className="direct-dispatch-select" aria-label={`选择项目 ${index+1}`} disabled={!canEditForm || item.pending} checked={!!item.repair&&directDispatch.selected.includes(item.repair.id)} onChange={event=>item.repair&&directDispatch.select(item.repair.id,event.target.checked)}>选择项目 {index+1}{item.pending?'（待定，暂不派工）':''}</Checkbox>}
                    <Input.TextArea className="repair-item-name" autoSize={{ minRows: 2 }} placeholder="例如：检查发动机异响，更换磨损皮带" required aria-required="true" maxLength={200} showCount status={fieldError("维修项目") && (!item.name.trim() || item.name.length > 200) ? "error" : undefined} disabled={!canEditForm} aria-label="项目名称" value={item.name} onChange={event=>confirmationRows.changeName(item,event.target.value)} />
                    {draft.dispatchPlan && (item.pending ? <p className="dispatch-muted">待定项目确认后再安排派工</p> : <Form.Item label="负责人" required style={{marginTop:12}}>
                      <Select aria-label={`项目 ${index+1} 负责人`} showSearch optionFilterProp="label" disabled={!canEditForm} placeholder="请选择维修工" options={directDispatch.options} value={draft.dispatchPlan.itemAssignments?.find(row=>row.itemId===item.repair?.id)?.technicianId || draft.dispatchPlan.technicianId} onChange={value=>directDispatch.assign(item.repair!.id,value)} />
                    </Form.Item>)}
                    <div className="repair-pending-choice"><Checkbox aria-label={`项目 ${index+1} 待定`} disabled={!canEditForm} checked={item.pending} onChange={event=>confirmationRows.toggle(item,event.target.checked)}>待定</Checkbox></div>
                  </div>
                  <div data-label="操作"><Button type="text" danger disabled={!canEditForm} aria-label="删除维修项目" onClick={()=>confirmationRows.remove(item)}><Trash2 size={15}/></Button></div>
                </div>
              ))}
            </div>

            <div className="field-grid settlement-grid">
              <Form.Item className="field" label="旧件处置方式"><Select aria-label="旧件处置方式" disabled={!canEditForm} value={draft.oldPartsHandling} onChange={(value) => updateDraft({ oldPartsHandling: value as WorkOrderDraft["oldPartsHandling"] })} options={["客户带走", "门店回收", "环保处理"].map((value) => ({ value }))} /></Form.Item>
            </div>

            </FormSection>

            </>}
            {selectedOrder && <SignatureReview order={selectedOrder} user={controller.currentUser} onUpdated={controller.acceptRefreshedOrder} />}
            {selectedOrder && (draft.paperOrder || !["草稿","待客户签字"].includes(selectedOrder.status)) && <CustomerSignatureSection order={selectedOrder} user={controller.currentUser} onUpdated={controller.acceptRefreshedOrder}/> }
            {!draft.paperOrder && <div className="workflow-actions">
              <div>
                <strong>完成开单流程</strong>
                {signatureUploaded ? (
                  <Alert
                    className="workflow-upload-success"
                    type={selectedOrder?.legacySyncStatus === "failed" ? "warning" : "success"}
                    showIcon
                    title="签字已上传成功"
                    description={selectedOrder?.customerSignatureReview?.state === "pending" ? "需确认用户签字，确认前不会同步润丰或派工。" : signatureUploadDescription}
                  />
                ) : <span>现场签字完成后，委托单会进入润丰待拉取队列；远程链接签字需经服务顾问或管理员确认。</span>}
                {showSignatureValidation && formErrors.length ? (
                  <Alert
                    className="signature-validation-summary"
                    type="error"
                    showIcon
                    title="暂时无法发起签字"
                    description={formErrors.join("；")}
                  />
                ) : null}
              </div>
            </div>}
              <FormActionBar label="委托开单操作">
                {(!paperOnly || !draft.paperOrder) && <Button size="large" icon={<Save size={16} />} onClick={saveDraft} loading={actionLoading === "save"} disabled={!canEditForm || Boolean(actionLoading) || Boolean(controller.preRepairPhotos.uploading)}>{selectedOrder?.status==="待客户签字"?"保存修改":"保存草稿"}</Button>}
                {draft.paperOrder ? <Button className={paperOnly ? "paper-order-create-action" : undefined} size="large" type="primary" loading={actionLoading==="save"}
                  disabled={!canEditForm || Boolean(actionLoading) || controller.paperPhotos.uploading || Boolean(controller.preRepairPhotos.uploading)} onClick={()=>void controller.submitPaperOrder()}>
                  {paperDingTalk ? "提交委托单（免签字）" : "创建纸质委托书"}</Button> : <Tooltip title={signatureDisabledReason}>
                  <span><Button size="large" color="blue" variant="solid" icon={<Send size={17} />} onClick={handleSendSignature} loading={actionLoading === "signature"} disabled={signatureDisabled}>{canResumeSignature ? "继续签字" : "发起签字"}</Button></span>
                </Tooltip>}
              </FormActionBar>

          </Form>
          {signatureSession && <WorkOrderSignatureDialog key={signatureSession.token} session={signatureSession}
            completeSignature={completeSignature} onOrderUpdated={controller.acceptRefreshedOrder} onClose={() => setSignatureSession(undefined)} />}
          </FormSurface>
  );
}

function scrollToFirstFormError() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const firstError = document.querySelector<HTMLElement>(
      ".form-panel .ant-form-item-has-error, .form-panel .ant-input-status-error, .form-panel .pre-repair-photo-card.has-error"
    );
    if (!firstError) return;
    firstError.scrollIntoView({ behavior: "smooth", block: "center" });
    firstError.querySelector<HTMLElement>("input, textarea, [role='combobox']")?.focus({ preventScroll: true });
  }));
}
