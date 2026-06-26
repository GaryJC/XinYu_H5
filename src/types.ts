export type RoleKey = "advisor" | "dispatcher" | "technician" | "inspector" | "manager";

export type WorkOrderStatus =
  | "草稿"
  | "待客户签字"
  | "已委托"
  | "待派工"
  | "维修中"
  | "待结算"
  | "完成";

export type OcrFieldKey = "plate" | "vin" | "mileage";

export type OcrFieldState = {
  source: "车牌照片" | "行驶证照片" | "仪表盘照片";
  status: "未识别" | "识别中" | "待确认" | "已确认";
  value: string;
};

export type RepairItem = {
  id: number;
  name: string;
  laborFee: number;
  owner: string;
};

export type WorkOrder = {
  id: string;
  status: WorkOrderStatus;
  createdAt: string;
  updatedAt: string;
  advisor: string;
  technician: string;
  inspector: string;
  vehicle: {
    plate: string;
    vin: string;
    mileage: string;
    model: string;
    purchaseDate: string;
  };
  customer: {
    name: string;
    phone: string;
    contact: string;
    address: string;
  };
  inspection: {
    belongings: string[];
    fuelLevel: "空" | "1/4" | "1/2" | "3/4" | "满";
    exteriorIssues: string[];
  };
  faultDescription: string;
  repairItems: RepairItem[];
  estimatedFee: number;
  oldPartsHandling: "客户带走" | "门店回收" | "环保处理";
  estimatedDeliveryAt: string;
  settlementAmount: number;
  feeNote: string;
  signatures: {
    customer?: string;
    advisor?: string;
    inspector?: string;
    reception?: string;
  };
  signatureToken?: string;
  signatureTokenUsed?: boolean;
  platformOrderNo?: string;
  auditLog: AuditLogEntry[];
};

export type AuditLogEntry = {
  at: string;
  actor: string;
  action: string;
};

export type WorkOrderDraft = Omit<WorkOrder, "id" | "createdAt" | "updatedAt" | "auditLog">;
