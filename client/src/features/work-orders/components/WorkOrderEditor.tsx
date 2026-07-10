import { Copy, Link, LockKeyhole, Plus, Save, Send, Trash2 } from "lucide-react";
import { WorkOrderDraft } from "../../../../../shared/types";
import { canCreateOrder, canDispatch, canSendSignature } from "../domain/permissions";
import { Checklist, Field, TextArea } from "../../../shared/ui/FormControls";
import { VehicleLicenseOcrControl } from "../../vehicle-license-ocr/VehicleLicenseOcrControl";
import { WorkbenchController } from "../../workbench/useWorkbenchController";
import { belongings, exteriorIssues } from "../../workbench/workbenchConfig";

export function WorkOrderEditor({ controller }: { controller: WorkbenchController }) {
  const {
    selectedOrder, startNewOrder, canEditForm, saveDraft, role, sendSignature,
    formErrors, vehicleLicenseOcr, ocrState, scanVehicleLicense,
    confirmVehicleLicenseOcr, draft, updateDraft, updateVehicle, updateCustomer,
    toggleArrayField, setDraft, totalLabor, updateRepairItem, technicianOptions,
    inspectorOptions, updateRepairAction, actor, signatureLink
  } = controller;

  return (
<div className="panel form-panel">
            <div className="panel-header">
              <div>
                <h2>{selectedOrder ? `委托单 ${selectedOrder.id}` : "新建委托开单"}</h2>
                <p>先保存草稿，再生成客户签字链接；OCR 结果必须人工确认。</p>
              </div>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={startNewOrder} disabled={!canEditForm}>
                  <Plus size={16} />
                  新建
                </button>
                <button className="secondary-button" type="button" onClick={saveDraft} disabled={!canCreateOrder(role)}>
                  <Save size={16} />
                  保存草稿
                </button>
                <button className="primary-button" type="button" onClick={sendSignature} disabled={!canEditForm || (Boolean(selectedOrder) && !canSendSignature(role, selectedOrder))}>
                  <Send size={16} />
                  发起签字
                </button>
              </div>
            </div>

            {formErrors.length ? (
              <div className="error-box">
                {formErrors.map((error) => (
                  <span key={error}>{error}</span>
                ))}
              </div>
            ) : null}

            {!canEditForm ? (
              <div className="readonly-banner">
                <LockKeyhole size={16} />
                当前角色只能查看此委托单，字段编辑、OCR 和签字发起已锁定。
              </div>
            ) : null}

            <div className="ocr-grid">
              <VehicleLicenseOcrControl
                disabled={!canEditForm}
                result={vehicleLicenseOcr}
                state={ocrState.vehicleLicense}
                onScan={scanVehicleLicense}
                onConfirm={confirmVehicleLicenseOcr}
              />
            </div>

            <div className="field-grid">
              <Field disabled={!canEditForm} label="派工号" value={draft.dispatchNo} onChange={(value) => updateDraft({ dispatchNo: value })} />
              <Field disabled={!canEditForm} label="进厂日期" value={draft.arrivalDate} onChange={(value) => updateDraft({ arrivalDate: value })} />
              <Field disabled label="门店地址" value={draft.shop.address} onChange={() => undefined} />
              <Field disabled label="门店联系电话" value={draft.shop.phone} onChange={() => undefined} />
              <Field disabled={!canEditForm} label="车牌号码" value={draft.vehicle.plate} onChange={(value) => updateVehicle("plate", value)} />
              <Field disabled={!canEditForm} label="VIN/底盘号" value={draft.vehicle.vin} onChange={(value) => updateVehicle("vin", value)} />
              <Field disabled={!canEditForm} label="进厂里程" value={draft.vehicle.mileage} suffix="km" onChange={(value) => updateVehicle("mileage", value)} />
              <Field disabled={!canEditForm} label="车型" value={draft.vehicle.model} onChange={(value) => updateVehicle("model", value)} />
              <Field disabled={!canEditForm} label="购车日期" value={draft.vehicle.purchaseDate} onChange={(value) => updateVehicle("purchaseDate", value)} />
              <Field disabled={!canEditForm} label="预计交车时间" value={draft.estimatedDeliveryAt} onChange={(value) => updateDraft({ estimatedDeliveryAt: value })} />
              <Field disabled={!canEditForm} label="车主名称" value={draft.customer.name} onChange={(value) => updateCustomer("name", value)} />
              <Field disabled={!canEditForm} label="联系人" value={draft.customer.contact} onChange={(value) => updateCustomer("contact", value)} />
              <Field disabled={!canEditForm} label="联系电话" value={draft.customer.phone} onChange={(value) => updateCustomer("phone", value)} />
            </div>

            <Field disabled={!canEditForm} label="车辆地址" value={draft.customer.address} onChange={(value) => updateCustomer("address", value)} />
            <TextArea disabled={!canEditForm} label="故障描述 / 客户诉求" value={draft.faultDescription} onChange={(value) => updateDraft({ faultDescription: value })} />

            <div className="check-section">
              <Checklist disabled={!canEditForm} title="随车物品" items={belongings} selected={draft.inspection.belongings} onToggle={(value) => toggleArrayField("belongings", value)} />
              <Checklist disabled={!canEditForm} title="车辆外观状况" items={exteriorIssues} selected={draft.inspection.exteriorIssues} onToggle={(value) => toggleArrayField("exteriorIssues", value)} />
              <label className="field">
                <span>燃油存量</span>
                <select
                  className="select-control"
                  disabled={!canEditForm}
                  value={draft.inspection.fuelLevel}
                  onChange={(event) => setDraft((current) => ({ ...current, inspection: { ...current.inspection, fuelLevel: event.target.value as WorkOrderDraft["inspection"]["fuelLevel"] } }))}
                >
                  {["空", "1/4", "1/2", "3/4", "满"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="section-title-row">
              <div>
                <h3>维修项目明细</h3>
                <span>工时预估合计：¥{totalLabor}</span>
              </div>
              <button
                className="text-button"
                type="button"
                disabled={!canEditForm}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    repairItems: [...current.repairItems, { id: Date.now(), name: "", laborFee: 0, owner: "待派工", startAt: "", finishAt: "", inspector: "待检验", status: "待派工" }]
                  }))
                }
              >
                <Plus size={15} />
                新增项目
              </button>
            </div>

            <div className="repair-table" role="table" aria-label="维修项目明细">
              <div className="repair-row repair-head" role="row">
                <span>项目</span>
                <span>工费</span>
                <span>主修人</span>
                <span>开工</span>
                <span>完工</span>
                <span>过程检查</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {draft.repairItems.map((item) => (
                <div className="repair-row" role="row" key={item.id}>
                  <input disabled={!canEditForm} aria-label="项目名称" value={item.name} onChange={(event) => updateRepairItem(item.id, { name: event.target.value })} />
                  <input disabled={!canEditForm} aria-label="工费" type="number" value={item.laborFee} onChange={(event) => updateRepairItem(item.id, { laborFee: Number(event.target.value) })} />
                  <select disabled={!canEditForm} aria-label="主修人" value={item.owner} onChange={(event) => updateRepairItem(item.id, { owner: event.target.value })}>
                    <option>待派工</option>
                    {technicianOptions.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <input disabled={!canEditForm} aria-label="开工时间" value={item.startAt} onChange={(event) => updateRepairItem(item.id, { startAt: event.target.value })} />
                  <input disabled={!canEditForm} aria-label="完工时间" value={item.finishAt} onChange={(event) => updateRepairItem(item.id, { finishAt: event.target.value })} />
                  <select disabled={!canEditForm} aria-label="过程检查人" value={item.inspector} onChange={(event) => updateRepairItem(item.id, { inspector: event.target.value })}>
                    <option>待检验</option>
                    {inspectorOptions.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <span>{item.status}</span>
                  <button
                    className="icon-inline"
                    type="button"
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
                  </button>
                </div>
              ))}
            </div>

            {selectedOrder ? (
              <div className="item-action-grid">
                {selectedOrder.repairItems.map((item) => (
                  <div className="mini-card" key={item.id}>
                    <strong>{item.name || `项目 ${item.id}`}</strong>
                    <span>{item.owner} · {item.status}</span>
                    <div className="button-row">
                      <button className="text-button" type="button" disabled={!canDispatch(role, selectedOrder) || technicianOptions.length === 0} onClick={() => updateRepairAction(item.id, "assign", { technician: draft.technician || technicianOptions[0] || item.owner })}>指派</button>
                      <button className="text-button" type="button" disabled={!(role === "technician" || role === "manager")} onClick={() => updateRepairAction(item.id, "pick")}>领料</button>
                      <button className="text-button" type="button" disabled={!(role === "technician" || role === "manager")} onClick={() => updateRepairAction(item.id, "start")}>开工</button>
                      <button className="text-button" type="button" disabled={!(role === "technician" || role === "manager")} onClick={() => updateRepairAction(item.id, "finish")}>完工</button>
                      <button className="text-button" type="button" disabled={!(role === "inspector" || role === "manager")} onClick={() => updateRepairAction(item.id, "inspect", { inspector: actor })}>检验</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="field-grid settlement-grid">
              <Field disabled={!canEditForm} label="预计修理费" value={String(draft.estimatedFee)} suffix="元" onChange={(value) => updateDraft({ estimatedFee: Number(value) })} />
              <label className="field">
                <span>旧件处置方式</span>
                <select disabled={!canEditForm} className="select-control" value={draft.oldPartsHandling} onChange={(event) => updateDraft({ oldPartsHandling: event.target.value as WorkOrderDraft["oldPartsHandling"] })}>
                  <option>客户带走</option>
                  <option>门店回收</option>
                  <option>环保处理</option>
                </select>
              </label>
              <Field disabled={!(role === "advisor" || role === "manager")} label="结算金额占位" value={String(draft.settlementAmount || draft.estimatedFee || totalLabor)} suffix="元" onChange={(value) => updateDraft({ settlementAmount: Number(value) })} />
            </div>
            <TextArea disabled={!(role === "advisor" || role === "manager")} label="费用备注" value={draft.feeNote} onChange={(value) => updateDraft({ feeNote: value })} />

            {signatureLink ? (
              <div className="signature-link">
                <Link size={16} />
                <span>{signatureLink}</span>
                <button className="text-button" type="button" onClick={() => window.navigator.clipboard?.writeText(signatureLink)}>
                  <Copy size={15} />
                  复制
                </button>
              </div>
            ) : null}
          </div>
  );
}
