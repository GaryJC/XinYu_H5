import { CheckCircle2, Gauge, ShieldCheck } from "lucide-react";
import { Card, Tag } from "antd";
import { roles, workflow } from "../domain/workOrderDomain";
import { WorkbenchController } from "../../workbench/useWorkbenchController";
import { ActionPanel, PlatformPanel, SettlementPanel } from "./WorkflowPanels";

export function WorkflowSidebar({ controller }: { controller: WorkbenchController }) {
  const {
    selectedOrder, submitDispatch, dispatchToTechnician, technicianOptions, role,
    completeRepair, settleOrder, syncPlatform, createSettlement
  } = controller;

  return (
<Card className="panel side-panel">
            <div className="panel-header compact">
              <div>
                <h2>流程状态</h2>
                <p>当前：{selectedOrder?.status ?? "新建草稿"}</p>
              </div>
              <Gauge size={20} />
            </div>
            <div className="timeline">
              {workflow.map((step) => {
                const activeIndex = workflow.indexOf(selectedOrder?.status ?? "草稿");
                const index = workflow.indexOf(step);
                return (
                  <div className={index <= activeIndex ? "timeline-step done" : "timeline-step"} key={step}>
                    <span>{index < activeIndex ? <CheckCircle2 size={14} /> : index + 1}</span>
                    <strong>{step}</strong>
                  </div>
                );
              })}
            </div>

            <ActionPanel
              order={selectedOrder}
              role={role}
              onSubmitDispatch={submitDispatch}
              onDispatch={dispatchToTechnician}
              technicians={technicianOptions}
              onCompleteRepair={completeRepair}
              onSettle={settleOrder}
            />

            <PlatformPanel order={selectedOrder} role={role} onSync={syncPlatform} />
            <SettlementPanel order={selectedOrder} role={role} onCreateSettlement={createSettlement} />

            <div className="permission-card">
              <div className="permission-head">
                <ShieldCheck size={18} />
                <strong>{roles[role].name}</strong>
              </div>
              <p>{roles[role].scope}</p>
              <div className="permission-tags">
                {roles[role].permissions.map((permission) => (
                  <Tag key={permission}>{permission}</Tag>
                ))}
              </div>
            </div>
          </Card>
  );
}
