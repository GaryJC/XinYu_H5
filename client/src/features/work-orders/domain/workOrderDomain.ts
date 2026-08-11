import { RepairItem, RoleKey, WorkOrderDraft, WorkOrderStatus } from "../../../../../shared/types";

const shopProfile = {
  id: "shop-hq",
  name: "抚顺路店",
  address: "抚顺路店",
  phone: "021-6000-8618"
};

export const workflow: WorkOrderStatus[] = ["草稿", "待客户签字", "已委托", "待派工", "维修中", "待结算", "完成"];

export const roles: Record<RoleKey, { name: string; scope: string; permissions: string[] }> = {
  advisor: {
    name: "服务顾问",
    scope: "可创建委托单、发起客户签字、查看本人开单",
    permissions: ["开单", "客户签字", "提交派工"]
  },
  dispatcher: {
    name: "派单员",
    scope: "可查看待派工单、指派技师、改派维修任务",
    permissions: ["待派工池", "指派/改派", "出库单占位"]
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
    scope: "可查看全量数据、看板、权限配置与审计日志",
    permissions: ["全量数据", "结算确认", "权限配置"]
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
      plate: "",
      vin: "",
      mileage: "",
      model: "",
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
  if (!draft.customer.name.trim()) errors.push("车主名称必填");
  if (!draft.customer.phone.trim()) errors.push("联系电话必填");
  if (!draft.faultDescription.trim()) errors.push("故障描述必填");
  if (!draft.repairItems.length || draft.repairItems.some((item) => !item.name.trim())) errors.push("维修项目不能为空");
  return errors;
}
