import { FileSignature, LockKeyhole, Plus, RefreshCcw, Save, Send, Trash2 } from "lucide-react";
import { Alert, Button, Card, Form, Grid, Input, Modal, Select, Tooltip } from "antd";
import { useState } from "react";
import { WorkOrder, WorkOrderDraft } from "../../../../../shared/types";
import { canCreateOrder, canSendSignature } from "../domain/permissions";
import { Checklist, Field, TextArea } from "../../../shared/ui/FormControls";
import { VehicleLicenseOcrControl } from "../../vehicle-license-ocr/VehicleLicenseOcrControl";
import { VehicleIdentityRecognition } from "../../vehicle-identity/VehicleIdentityRecognition";
import { WorkbenchController } from "../../workbench/useWorkbenchController";
import { belongings, exteriorIssues } from "../../workbench/workbenchConfig";
import { SignaturePad } from "../../signature/SignaturePad";
import { Summary } from "../../../shared/ui/FormControls";
import { sumLabor } from "../domain/workOrderDomain";

export function WorkOrderEditor({ controller }: { controller: WorkbenchController }) {
  const [signatureSession, setSignatureSession] = useState<{ token: string; order: WorkOrder }>();
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureSubmitting, setSignatureSubmitting] = useState(false);
  const [signatureResult, setSignatureResult] = useState("");
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const {
    selectedOrder, startNewOrder, canEditForm, saveDraft, role, sendSignature,
    formErrors, vehicleLicenseOcr, ocrState, scanVehicleLicense,
    confirmVehicleLicenseOcr, draft, updateDraft, updateVehicle, updateCustomer,
    toggleArrayField, setDraft, totalLabor, updateRepairItem,
    syncPlatform, actionLoading, completeSignature, identifierRecognition,
    vehicleHistory, vehicleHistoryLoading, vehicleHistoryError, scanVehicleIdentifier
  } = controller;
  const canSyncPlatform = Boolean(selectedOrder && !selectedOrder.platformOrderNo && !["草稿", "待客户签字"].includes(selectedOrder.status) && (role === "advisor" || role === "manager"));
  const fieldError = (...phrases: string[]) => formErrors.find((error) => phrases.some((phrase) => error.includes(phrase)));
  const hasValidationError = formErrors.some((error) => ["必填", "VIN", "里程", "维修项目", "行驶证", "故障描述"].some((phrase) => error.includes(phrase)));
  const canResumeSignature = Boolean(selectedOrder?.status === "待客户签字" && selectedOrder.signatureToken && !selectedOrder.signatureTokenUsed);
  const signatureDisabled = !canResumeSignature && (!canEditForm || (Boolean(selectedOrder) && !canSendSignature(role, selectedOrder)));
  const signatureDisabledReason = selectedOrder && !["草稿", "待客户签字"].includes(selectedOrder.status) ? `当前状态“${selectedOrder.status}”不能再次发起签字` : "";
  const signatureCompleted = signatureResult.includes("已保存");

  async function handleSendSignature() {
    if (canResumeSignature && selectedOrder?.signatureToken) {
      setSignatureImage("");
      setSignatureResult("");
      setSignatureSession({ token: selectedOrder.signatureToken, order: selectedOrder });
      return;
    }
    const session = await sendSignature();
    if (session) {
      setSignatureImage("");
      setSignatureResult("");
      setSignatureSession(session);
    }
  }

  async function handleCompleteSignature() {
    if (!signatureSession || !signatureImage) return;
    setSignatureSubmitting(true);
    try {
      await completeSignature(signatureSession.order, signatureSession.token, signatureImage);
      setSignatureResult("客户签字已保存，委托单已进入“已委托”。");
    } catch (error) {
      setSignatureResult(error instanceof Error ? error.message : "签字保存失败");
    } finally {
      setSignatureSubmitting(false);
    }
  }

  function closeSignatureModal() {
    if (signatureSubmitting) return;
    setSignatureSession(undefined);
    setSignatureImage("");
    setSignatureResult("");
  }

  return (
<Card className="panel form-panel">
          <Form layout="vertical" requiredMark>
            <div className="panel-header">
              <div>
                <h2>{selectedOrder ? `委托单 ${selectedOrder.id}` : "新建委托开单"}</h2>
                <p>先保存草稿，再由客户在弹窗内核对并签字；OCR 结果必须人工确认。</p>
              </div>
              <div className="button-row">
                <Button icon={<Plus size={16} />} onClick={startNewOrder} disabled={!canCreateOrder(role)}>新建</Button>
                <Button icon={<Save size={16} />} onClick={saveDraft} loading={actionLoading === "save"} disabled={!canEditForm}>保存草稿</Button>
              </div>
            </div>

            {selectedOrder?.platformOrderNo ? (
              <Alert className="platform-sync-state" type="success" showIcon title={`已同步平台工单：${selectedOrder.platformOrderNo}`} />
            ) : null}

            {formErrors.length ? (
              <Alert className="error-box" type="error" showIcon title={hasValidationError ? "请完善委托单信息" : "操作失败"} description={formErrors.join("；")} />
            ) : null}

            {!canEditForm ? (
              <div className="readonly-banner">
                <LockKeyhole size={16} />
                {canResumeSignature ? "当前委托单内容已锁定，但可以继续完成已发起的客户签字。" : "当前角色只能查看此委托单，字段编辑、OCR 和签字发起已锁定。"}
              </div>
            ) : null}

            <Form.Item
              className="ocr-form-item"
              label="行驶证照片"
              required
              validateStatus={fieldError("行驶证") ? "error" : undefined}
              help={fieldError("行驶证")}
            >
              <div className="ocr-grid">
                <VehicleLicenseOcrControl
                  disabled={!canEditForm}
                  result={vehicleLicenseOcr}
                  state={ocrState.vehicleLicense}
                  onScan={scanVehicleLicense}
                  onConfirm={confirmVehicleLicenseOcr}
                />
              </div>
            </Form.Item>

            <VehicleIdentityRecognition
              disabled={!canEditForm}
              recognition={identifierRecognition}
              history={vehicleHistory}
              historyLoading={vehicleHistoryLoading}
              historyError={vehicleHistoryError}
              onScan={scanVehicleIdentifier}
            />

            <div className="field-grid">
              <Field disabled={!canEditForm} label="派工号" value={draft.dispatchNo} onChange={(value) => updateDraft({ dispatchNo: value })} />
              <Field disabled={!canEditForm} label="进厂日期" value={draft.arrivalDate} onChange={(value) => updateDraft({ arrivalDate: value })} />
              <Field disabled label="门店地址" value={draft.shop.address} onChange={() => undefined} />
              <Field disabled label="门店联系电话" value={draft.shop.phone} onChange={() => undefined} />
              <Field required error={fieldError("车牌号码")} disabled={!canEditForm} label="车牌号码" value={draft.vehicle.plate} onChange={(value) => updateVehicle("plate", value)} />
              <Field required error={fieldError("VIN")} disabled={!canEditForm} label="VIN/底盘号" value={draft.vehicle.vin} onChange={(value) => updateVehicle("vin", value)} />
              <Field required error={fieldError("进厂里程")} disabled={!canEditForm} label="进厂里程" value={draft.vehicle.mileage} suffix="km" onChange={(value) => updateVehicle("mileage", value)} />
              <Field disabled={!canEditForm} label="车型" value={draft.vehicle.model} onChange={(value) => updateVehicle("model", value)} />
              <Field disabled={!canEditForm} label="购车日期" value={draft.vehicle.purchaseDate} onChange={(value) => updateVehicle("purchaseDate", value)} />
              <Field disabled={!canEditForm} label="预计交车时间" value={draft.estimatedDeliveryAt} onChange={(value) => updateDraft({ estimatedDeliveryAt: value })} />
              <Field required error={fieldError("车主名称")} disabled={!canEditForm} label="车主名称" value={draft.customer.name} onChange={(value) => updateCustomer("name", value)} />
              <Field disabled={!canEditForm} label="联系人" value={draft.customer.contact} onChange={(value) => updateCustomer("contact", value)} />
              <Field required error={fieldError("联系电话")} disabled={!canEditForm} label="联系电话" value={draft.customer.phone} onChange={(value) => updateCustomer("phone", value)} />
            </div>

            <Field disabled={!canEditForm} label="车辆地址" value={draft.customer.address} onChange={(value) => updateCustomer("address", value)} />
            <TextArea required error={fieldError("故障描述")} disabled={!canEditForm} label="故障描述 / 客户诉求" value={draft.faultDescription} onChange={(value) => updateDraft({ faultDescription: value })} />

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

            <div className="section-title-row">
              <Form.Item className="section-title-form-item" label="维修项目明细" required validateStatus={fieldError("维修项目") ? "error" : undefined} help={fieldError("维修项目")}>
                <span>工时预估合计：¥{totalLabor}</span>
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

            <div className="repair-table" role="table" aria-label="维修项目明细">
              <div className="repair-row repair-head" role="row">
                <span>项目</span>
                <span>操作</span>
              </div>
              {draft.repairItems.map((item) => (
                <div className="repair-row" role="row" key={item.id}>
                  <div data-label="项目"><Input required aria-required="true" status={fieldError("维修项目") && !item.name.trim() ? "error" : undefined} disabled={!canEditForm} aria-label="项目名称" value={item.name} onChange={(event) => updateRepairItem(item.id, { name: event.target.value })} /></div>
                  <div data-label="操作"><Button
                    type="text"
                    danger
                    disabled={!canEditForm}
                    aria-label="删除维修项目"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        repairItems: current.repairItems.filter((row) => row.id !== item.id)
                      }))
                    }
                  >
                    <Trash2 size={15} />
                  </Button></div>
                </div>
              ))}
            </div>

            <div className="field-grid settlement-grid">
              <Field disabled={!canEditForm} label="预计修理费" value={String(draft.estimatedFee)} suffix="元" onChange={(value) => updateDraft({ estimatedFee: Number(value) })} />
              <Form.Item className="field" label="旧件处置方式"><Select aria-label="旧件处置方式" disabled={!canEditForm} value={draft.oldPartsHandling} onChange={(value) => updateDraft({ oldPartsHandling: value as WorkOrderDraft["oldPartsHandling"] })} options={["客户带走", "门店回收", "环保处理"].map((value) => ({ value }))} /></Form.Item>
              <Field disabled={!(role === "advisor" || role === "manager")} label="结算金额占位" value={String(draft.settlementAmount || draft.estimatedFee || totalLabor)} suffix="元" onChange={(value) => updateDraft({ settlementAmount: Number(value) })} />
            </div>
            <TextArea disabled={!(role === "advisor" || role === "manager")} label="费用备注" value={draft.feeNote} onChange={(value) => updateDraft({ feeNote: value })} />

            <div className="workflow-actions">
              <div>
                <strong>完成开单流程</strong>
                <span>{canSyncPlatform ? "客户已签字，可以同步维修平台。" : "请先完成客户签字，再同步维修平台。"}</span>
              </div>
              <div className="workflow-action-buttons">
                <Tooltip title={signatureDisabledReason}>
                  <span><Button size="large" color="blue" variant="solid" icon={<Send size={17} />} onClick={handleSendSignature} loading={actionLoading === "signature"} disabled={signatureDisabled}>{canResumeSignature ? "继续签字" : "发起签字"}</Button></span>
                </Tooltip>
                <Button size="large" color="green" variant="solid" icon={<RefreshCcw size={17} />} onClick={syncPlatform} loading={actionLoading === "sync"} disabled={!canSyncPlatform}>同步维修平台</Button>
              </div>
            </div>

          </Form>
          <Modal
            rootClassName="signature-confirm-modal"
            open={Boolean(signatureSession)}
            title="机动车维修委托确认"
            width={isMobile ? "calc(100vw - 16px)" : 760}
            style={isMobile ? { top: 8, paddingBottom: 8 } : undefined}
            closable={!signatureSubmitting}
            mask={{ closable: false }}
            onCancel={closeSignatureModal}
            footer={[
              <Button key="close" disabled={signatureSubmitting} onClick={closeSignatureModal}>{signatureCompleted ? "完成" : "取消"}</Button>,
              <Button key="sign" type="primary" icon={<FileSignature size={16} />} loading={signatureSubmitting} disabled={!signatureImage || signatureCompleted} onClick={handleCompleteSignature}>
                {signatureCompleted ? "已签字" : "确认签字"}
              </Button>
            ]}
            styles={{ body: { maxHeight: isMobile ? "calc(100vh - 148px)" : "72vh", overflowY: "auto" } }}
          >
            {signatureSession ? (
              <Form layout="vertical" requiredMark>
                {signatureResult ? <Alert className="signature-message" type={signatureCompleted ? "success" : "error"} showIcon title={signatureResult} /> : <Alert className="signature-message" type="info" showIcon title="请客户核对委托信息并在下方手写签名。" />}
                <div className="summary-grid">
                  <Summary label="委托单号" value={signatureSession.order.id} />
                  <Summary label="车牌号码" value={signatureSession.order.vehicle.plate} />
                  <Summary label="车主" value={signatureSession.order.customer.name} />
                  <Summary label="车型" value={signatureSession.order.vehicle.model || "-"} />
                  <Summary label="预计费用" value={`¥${signatureSession.order.estimatedFee || sumLabor(signatureSession.order.repairItems)}`} />
                  <Summary label="旧件处置" value={signatureSession.order.oldPartsHandling} />
                </div>
                <div className="public-items">
                  {signatureSession.order.repairItems.map((item) => <div key={item.id}><span>{item.name}</span><strong>¥{item.laborFee}</strong></div>)}
                </div>
                <Form.Item className="field" label="电子签名" required>
                  <SignaturePad disabled={signatureSubmitting || signatureCompleted} onChange={setSignatureImage} />
                </Form.Item>
              </Form>
            ) : null}
          </Modal>
          </Card>
  );
}
