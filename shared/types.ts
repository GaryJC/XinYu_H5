export type RoleKey = "advisor" | "dispatcher" | "technician" | "inspector" | "manager";
export type DevelopmentPersonaKey = "advisor" | "manager" | "unassigned" | "disabled";

export type WorkOrderStatus =
  | "草稿"
  | "待客户签字"
  | "已委托"
  | "待派工"
  | "维修中"
  | "待结算"
  | "完成";

export type OcrFieldKey = "vehicleLicense";
export type RepairItemStatus = "待派工" | "待领料" | "待开工" | "维修中" | "待检验" | "已完工";

export type OcrFieldState = {
  source: "行驶证照片";
  status: "未识别" | "识别中" | "待确认" | "已确认";
  value: string;
  error?: string;
};

export type VehicleLicenseOcrResult = {
  plate: string;
  vehicleType: string;
  owner: string;
  address: string;
  useCharacter: string;
  model: string;
  vin: string;
  engineNo: string;
  registerDate: string;
  issueDate: string;
  confidence: number;
};

export type VehicleIdentifierOcrResult = {
  value: string;
  confidence: number;
};

export type VehicleHistoryLookupResult = {
  found: boolean;
  vehicle?: {
    plate: string;
    vin: string;
    model: string;
  };
  message: string;
};

export type RepairItem = {
  id: number;
  name: string;
  laborFee: number;
  owner: string;
  startAt: string;
  finishAt: string;
  inspector: string;
  status: RepairItemStatus;
};

export type ShopProfile = {
  id: string;
  name: string;
  address: string;
  phone: string;
};

export type UserProfile = {
  id: string;
  name: string;
  role: RoleKey;
  dingtalkUserId?: string;
  active: boolean;
  shopId?: string;
  phone?: string;
  lastLoginAt?: string;
  homeRoute?: "workbench" | "order-create";
};

export type DingTalkRoleMapping = {
  dingtalkRoleId: string;
  dingtalkRoleName: string;
  appRole: RoleKey;
  shopId?: string;
  homeRoute: "workbench" | "order-create";
  enabled: boolean;
};

export type DingTalkDepartmentMapping = {
  dingtalkDepartmentId: string;
  dingtalkDepartmentName: string;
  shopId: string;
  enabled: boolean;
};

export type DingTalkMappings = {
  roleMappings: DingTalkRoleMapping[];
  departmentMappings: DingTalkDepartmentMapping[];
};

export type DingTalkIdentitySnapshot = {
  dingtalkUserId: string;
  name: string;
  phone?: string;
  departmentIds: string[];
  roles: Array<{ id: string; name: string }>;
  active: boolean;
  syncedAt?: string;
};

export type AuthResult = {
  token: string;
  user: UserProfile;
  expiresAt: string;
};

export type OcrRecord = {
  id: string;
  orderId?: string;
  field: OcrFieldKey;
  source: string;
  fileId: string;
  status: "识别中" | "待确认" | "已确认" | "识别失败";
  value: string;
  confidence: number;
  error?: string;
  createdAt: string;
  confirmedAt?: string;
};

export type StoredFile = {
  id: string;
  orderId?: string;
  kind: "vehicle_license" | "repair_order_photo" | "damage_photo" | "signature_image" | "other";
  storageProvider: "oss" | "local";
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy?: string;
  createdAt: string;
};

export type PlatformSyncRecord = {
  id: string;
  orderId: string;
  platformOrderNo: string;
  status: "未同步" | "同步中" | "已同步" | "同步失败";
  message: string;
  syncedAt: string;
};

export type OutboundOrderItem = {
  id: string;
  repairItemId: number;
  name: string;
  quantity: number;
  picked: boolean;
};

export type OutboundOrder = {
  id: string;
  orderId: string;
  dispatchNo: string;
  platformOrderNo: string;
  technician: string;
  status: "待领料" | "已领料" | "部分领料";
  items: OutboundOrderItem[];
  createdAt: string;
};

export type SettlementStatement = {
  id: string;
  orderId: string;
  dispatchNo: string;
  plate: string;
  technician: string;
  amount: number;
  source: "维修业务平台" | "手动录入";
  matchStatus: "待匹配" | "已匹配" | "异常";
  syncedAt: string;
};

export type DashboardSummary = {
  total: number;
  statusCounts: Record<string, number>;
  trend: Array<{ label: string; value: number }>;
  repairItemCounts: Record<string, number>;
  mileageBuckets: Record<string, number>;
  employeeRanking: Record<string, number>;
};

export type WorkOrder = {
  id: string;
  dispatchNo: string;
  arrivalDate: string;
  status: WorkOrderStatus;
  createdAt: string;
  updatedAt: string;
  shop: ShopProfile;
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
    technician?: string;
  };
  signatureToken?: string;
  signatureTokenUsed?: boolean;
  platformOrderNo?: string;
  ocrRecords: OcrRecord[];
  platformSyncRecords: PlatformSyncRecord[];
  outboundOrders: OutboundOrder[];
  settlementStatements: SettlementStatement[];
  auditLog: AuditLogEntry[];
  files?: StoredFile[];
};

export type AuditLogEntry = {
  at: string;
  actor: string;
  action: string;
};

export type WorkOrderDraft = Omit<WorkOrder, "id" | "createdAt" | "updatedAt" | "auditLog">;
