import { useState } from "react";
import { RepairItem, WorkOrder, WorkOrderDraft } from "../../../../../shared/types";
import { createEmptyDraft } from "../domain/workOrderDomain";

export function useWorkOrderDraft() {
  const [draft, setDraft] = useState<WorkOrderDraft>(() => createEmptyDraft());

  function resetDraft(order?: WorkOrder) {
    setDraft(order ? orderToDraft(order) : createEmptyDraft());
  }

  function updateDraft(patch: Partial<WorkOrderDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateVehicle(key: keyof WorkOrderDraft["vehicle"], value: string) {
    setDraft((current) => ({ ...current, vehicle: { ...current.vehicle, [key]: value } }));
  }

  function updateCustomer(key: keyof WorkOrderDraft["customer"], value: string) {
    setDraft((current) => ({ ...current, customer: { ...current.customer, [key]: value } }));
  }

  function updateRepairItem(id: number, patch: Partial<RepairItem>) {
    setDraft((current) => ({
      ...current,
      repairItems: current.repairItems.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }));
  }

  function toggleArrayField(field: "belongings" | "exteriorIssues", value: string) {
    setDraft((current) => {
      const list = current.inspection[field];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, inspection: { ...current.inspection, [field]: next } };
    });
  }

  return {
    draft,
    setDraft,
    resetDraft,
    updateDraft,
    updateVehicle,
    updateCustomer,
    updateRepairItem,
    toggleArrayField
  };
}

function orderToDraft(order: WorkOrder): WorkOrderDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, auditLog: _auditLog, ...draft } = order;
  return draft;
}
