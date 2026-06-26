import { AuditLogEntry, RepairItem, RoleKey, WorkOrder, WorkOrderDraft, WorkOrderStatus } from "./types";

export const technicians = ["陈立", "刘峰", "张明"];
export const inspectors = ["黄检", "王检"];

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

export function makeAudit(actor: string, action: string): AuditLogEntry {
  return { at: new Date().toLocaleString("zh-CN", { hour12: false }), actor, action };
}

export function createEmptyDraft(): WorkOrderDraft {
  return {
    status: "草稿",
    advisor: "林佳",
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
    repairItems: [{ id: 1, name: "", laborFee: 0, owner: "待派工" }],
    estimatedFee: 0,
    oldPartsHandling: "环保处理",
    estimatedDeliveryAt: "",
    settlementAmount: 0,
    feeNote: "",
    signatures: {
      advisor: "林佳"
    },
    signatureTokenUsed: false
  };
}

export function createSeedOrders(): WorkOrder[] {
  return [
    createOrderFromDraft(
      {
        ...createEmptyDraft(),
        status: "维修中",
        technician: "陈立",
        vehicle: {
          plate: "沪A·7K92D",
          vin: "LSGPC52U9MF018736",
          mileage: "68240",
          model: "别克 GL8",
          purchaseDate: "2021-08-16"
        },
        customer: {
          name: "周先生",
          phone: "138****2641",
          contact: "周先生",
          address: "上海市闵行区"
        },
        inspection: {
          belongings: ["行驶证", "备胎", "千斤顶"],
          fuelLevel: "1/2",
          exteriorIssues: ["划伤"]
        },
        faultDescription: "刹车异响，发动机舱低速异响。",
        repairItems: [
          { id: 1, name: "更换前刹车片", laborFee: 260, owner: "陈立" },
          { id: 2, name: "发动机舱异响检查", laborFee: 180, owner: "陈立" }
        ],
        estimatedFee: 880,
        estimatedDeliveryAt: "2026-06-27 18:00",
        signatures: {
          customer: "周先生",
          advisor: "林佳"
        }
      },
      "WT-20260626-018",
      [makeAudit("林佳", "客户已签字"), makeAudit("王涛", "已派工给陈立")]
    ),
    createOrderFromDraft(
      {
        ...createEmptyDraft(),
        status: "待派工",
        vehicle: {
          plate: "沪C·N581Q",
          vin: "LGBH52E04NY218456",
          mileage: "45210",
          model: "本田 雅阁",
          purchaseDate: "2020-03-12"
        },
        customer: {
          name: "沈女士",
          phone: "139****8812",
          contact: "沈女士",
          address: "上海市长宁区"
        },
        faultDescription: "空调制冷效果差。",
        repairItems: [{ id: 1, name: "空调系统检测", laborFee: 220, owner: "待派工" }],
        estimatedFee: 520,
        signatures: {
          customer: "沈女士",
          advisor: "林佳"
        }
      },
      "WT-20260626-017",
      [makeAudit("沈女士", "客户已签字"), makeAudit("林佳", "提交派工池")]
    ),
    createOrderFromDraft(
      {
        ...createEmptyDraft(),
        status: "待结算",
        technician: "刘峰",
        vehicle: {
          plate: "苏E·45M8A",
          vin: "LSVNV2189P2184501",
          mileage: "81200",
          model: "大众 途腾",
          purchaseDate: "2019-11-03"
        },
        customer: {
          name: "许先生",
          phone: "136****6032",
          contact: "许先生",
          address: "苏州市工业园区"
        },
        faultDescription: "保养并更换机油滤芯。",
        repairItems: [
          { id: 1, name: "小保养", laborFee: 180, owner: "刘峰" },
          { id: 2, name: "底盘检查", laborFee: 120, owner: "刘峰" }
        ],
        estimatedFee: 980,
        settlementAmount: 980,
        signatures: {
          customer: "许先生",
          advisor: "王涛",
          inspector: "黄检"
        }
      },
      "WT-20260626-016",
      [makeAudit("刘峰", "维修完成提报"), makeAudit("黄检", "检验通过")]
    )
  ];
}

export function createOrderFromDraft(draft: WorkOrderDraft, id = createOrderId(), auditLog: AuditLogEntry[] = []): WorkOrder {
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  return {
    ...draft,
    id,
    createdAt: now,
    updatedAt: now,
    auditLog
  };
}

export function createOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `WT-${stamp}-${Math.floor(100 + Math.random() * 900)}`;
}

export function createSignatureToken(orderId: string) {
  return `sig_${orderId}_${Math.random().toString(36).slice(2, 9)}`;
}

export function sumLabor(items: RepairItem[]) {
  return items.reduce((sum, item) => sum + Number(item.laborFee || 0), 0);
}

export function validateWorkOrderDraft(draft: WorkOrderDraft) {
  const errors: string[] = [];
  if (!draft.vehicle.plate.trim()) errors.push("车牌号码必填");
  if (!/^[A-Z0-9]{17}$/i.test(draft.vehicle.vin.trim())) errors.push("VIN 必须为 17 位字母数字");
  if (!/^\d+(\.\d+)?$/.test(draft.vehicle.mileage.trim())) errors.push("进厂里程必须为数字");
  if (!draft.customer.name.trim()) errors.push("车主名称必填");
  if (!draft.customer.phone.trim()) errors.push("联系电话必填");
  if (!draft.faultDescription.trim()) errors.push("故障描述必填");
  if (!draft.repairItems.length || draft.repairItems.some((item) => !item.name.trim())) errors.push("维修项目不能为空");
  return errors;
}
