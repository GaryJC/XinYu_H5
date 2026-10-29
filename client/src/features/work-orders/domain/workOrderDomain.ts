import {repairStatusLabel} from '../../../../../shared/repairCompletion.mjs';
import { RepairItem, RoleKey, WorkOrder, WorkOrderDraft, WorkOrderStatus } from "../../../../../shared/types";
import { dispatchEnabled } from "../../dispatch/dispatchAvailability";
import { filterEmptyRepairItems } from "./repairItems";

const shopProfile = {
  id: "shop-hq",
  name: "抚顺路店",
  address: "抚顺路店",
  phone: "021-6000-8618"
};

export const workflow: WorkOrderStatus[] = ["草稿", "待客户签字", "已委托", "待派工", "维修中", "待结算", "完成"];

export const roles: Record<RoleKey, { name: string; scope: string; permissions: string[] }> = {
  employee: { name: "普通员工", scope: "本人的出车申请", permissions: ["出车申请"] },
  outsourcing: {name:"外包",scope:"分配给本人的外包维修任务",permissions:["接单","领料确认","开工","完工提报"]},
  warehouse: {name:"仓管",scope:"本店配件申请",permissions:["查看申请","确认留痕"]},
  advisor: {
    name: "服务顾问",
    scope: "可创建委托单、发起客户签字、查看本店工单并安排维修",
    permissions: ["开单", "客户签字", "指派/改派", "维修工负荷"]
  },
  technician: {
    name: "维修技师",
    scope: "仅可查看派给自己的工单，提交维修完成",
    permissions: ["我的维修单", "领料确认", "完工提报"]
  },
  inspector: {
    name: "检验员",
    scope: "可执行完工检验、总检签字、退回返修",
    permissions: ["待检验", "检验签字", "退回维修"]
  },
  manager: {
    name: "门店管理员",
    scope: "可查看全量数据、看板、权限说明与审计日志",
    permissions: ["全量数据", "结算确认", "权限说明"]
  }
};

export function createEmptyDraft(advisor = ""): WorkOrderDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    dispatchNo: "",
    arrivalDate: today,
    status: "草稿",
    shop: shopProfile,
    department: { code: "", name: "" },
    advisor,
    technician: "待派工",
    inspector: "待检验",
    vehicle: {
      isMilitary: false,
      plate: "",
      vin: "",
      mileage: "",
      model: "",
      modelLegacyCode: "",
      purchaseDate: ""
    },
    customer: {
      name: "",
      legacyCode: "",
      phone: "",
      contact: "",
      address: ""
    },
    inspection: {
      belongings: ["行驶证"],
      fuelLevel: "1/2",
      exteriorIssues: []
    },
    faultDescription: "",
    repairItems: [{ id: 1, name: "", laborFee: 0, owner: "待派工", startAt: "", finishAt: "", inspector: "待检验", status: "待派工" }],
    estimatedFee: 0,
    oldPartsHandling: "环保处理",
    estimatedDeliveryAt: "",
    settlementAmount: 0,
    feeNote: "",
    signatures: {},
    signatureTokenUsed: false,
    ocrRecords: [],
    platformSyncRecords: [],
    outboundOrders: [],
    settlementStatements: []
  };
}

export function sumLabor(items: RepairItem[]) {
  return items.reduce((sum, item) => sum + Number(item.laborFee || 0), 0);
}

export function validateWorkOrderDraft(draft: WorkOrderDraft) {
  const errors: string[] = [];
  if (!draft.department.code.trim() || !draft.department.name.trim()) errors.push("部门必填");
  if (!draft.vehicle.plate.trim()) errors.push("车牌号码必填");
  if (!/^[A-Z0-9]{17}$/i.test(draft.vehicle.vin.trim())) errors.push("VIN 必须为 17 位字母数字");
  if (!/^\d+(\.\d+)?$/.test(draft.vehicle.mileage.trim())) errors.push("进厂里程必须为数字");
  if (!draft.vehicle.model.trim()) errors.push("车型必填");
  if (!draft.customer.name.trim()) errors.push("车主名称/所属单位必填");
  if (!draft.customer.phone.trim()) errors.push("联系电话必填");
  const repairItems = [...filterEmptyRepairItems(draft.repairItems), ...(draft.pendingRepairs||[]).filter(p=>p.state!=='declined'&&!p.scheduled)];
  if (!repairItems.length || repairItems.some((item) => !item.name.trim())) errors.push("维修项目不能为空");
  if (repairItems.some((item) => item.name.length > 200)) errors.push("维修项目每项不能超过 200 个字符");
  return errors;
}

export function workOrderDisplayStatus(order: WorkOrder) {
  if (order.customerSignatureReview?.state === "pending" && !order.customerSignatureReview.supplemental) return "需确认用户签字";
  if (!dispatchEnabled) return repairStatusLabel(undefined,order.status);
  if (["草稿", "待客户签字", "待处理纸质委托书"].includes(order.status)) return order.status;
  return repairStatusLabel(order.dispatchStage,order.status === "已委托" ? "待派工" : order.status);
}
