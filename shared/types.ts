import type { DispatchNumberSort } from './dispatchNumberSort.mjs';
export type RoleKey = "employee" | "outsourcing" | "warehouse" | "advisor" | "technician" | "inspector" | "manager";
export type DevelopmentPersonaKey = RoleKey | "technician-peer" | "unassigned" | "disabled";

export type WorkOrderStatus =
  | "待处理纸质委托书"
  | "草稿"
  | "待客户签字"
  | "已委托"
  | "待派工"
  | "维修中"
  | "待结算"
  | "完成";

export type LegacySyncStatus = "not_applicable" | "pending" | "processing" | "synced" | "failed";

export type OcrFieldKey = "vehicleLicense";
export type RepairItemStatus = "待派工" | "待领料" | "待开工" | "维修中" | "待检验" | "已完工";

export type OcrFieldState = {
  source: "行驶证照片";
  status: "未识别" | "识别中" | "待确认" | "已确认";
  value: string;
  error?: string;
};

export type VehicleLicenseOcrInput = { imageBase64: string; fileId?: never } | { fileId: string; imageBase64?: never };

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

export type VehicleReferenceCandidate = {
  value: string;
  code?: string;
  usageCount: number;
};

export type VehicleReferenceKind = "model" | "organization";

export type VehicleReferenceSearchResult = {
  kind: VehicleReferenceKind;
  query: string;
  candidates: VehicleReferenceCandidate[];
};

export type VehicleReferenceCodeCheckResult = {
  kind: VehicleReferenceKind;
  code: string;
  available: boolean;
  existing?: VehicleReferenceCandidate;
};

export type VehicleReferenceCreateResult = VehicleReferenceCandidate & {
  kind: VehicleReferenceKind;
  created: boolean;
};

export type VehicleReferenceResolution = {
  input: string;
  status: "matched" | "ambiguous" | "not_found";
  selected?: VehicleReferenceCandidate;
  candidates: VehicleReferenceCandidate[];
};

export type VehicleLookupInput = {
  confirmedPlate?: string;
  plate?: string;
  vin?: string;
  model?: string;
  owner?: string;
};

export type VehicleHistoryLookupResult = {
  plateChoices?: string[];
  models?: Array<{ code: string; name: string }>;
  organizations?: Array<{ code: string; name: string }>;
  found: boolean;
  status: "found" | "new" | "conflict";
  vehicle?: {
    plate: string;
    vin: string;
    model: string;
    modelLegacyCode: string;
    organization?: {
      code: string;
      name: string;
    };
  };
  references?: {
    model?: VehicleReferenceResolution;
    organization?: VehicleReferenceResolution;
  };
  conflicts?: Array<{
    identifier: "plate" | "vin";
    plate: string;
    vin: string;
  }>;
  message: string;
};

export type PendingRepair = {
 sourceInspectorId?: string; sourceInspectorName?: string; lastReminderAt?: string;
 source?: "inspection" | "customer"; inspectionState?: "pending" | "scheduled" | "completed" | "cancelled"; sourceRound?:number; sourceRequestId?:string; lastOperationRequestId?:string; originalItem?:DispatchItem; cancelledItem?:DispatchItem;
 id: string; itemId: number; draftItemId?: number; name: string; reason: string;
 state: 'pending' | 'approved' | 'declined'; scheduled: boolean;
 /** Read-only projection of current/latest repair round; never a customer decision. */
 progress?: '已撤销' | '待派工' | '待接单' | '待开工' | '维修中' | '暂停' | '待检验' | '检验通过' | '进度待核对';
 repairRound?: number;
 history: Array<{action: string; actorId?:string; actor: string; at: string; note: string; respondent?: string}>;
};
export type PendingRepairList = { items: PendingRepair[]; version: number };
export type PendingRepairCommand = DispatchExecution & {
 action: 'add' | 'approve' | 'decline' | 'schedule' | 'approve-and-schedule' | 'cancel' | 'remind-inspector';
 id?: string; name?: string; reason?: string; respondent?: string; note?: string;
 technicianId?: string; dueAt?: string; expectedVersion: number; requestId: string;
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

export type LegacyDepartment = {
  code: string;
  name: string;
  isDefault: boolean;
};

export type LegacyEmployeeCandidate = {
  code: string;
  name: string;
  departmentCode: string;
  departmentName: string;
  status: string;
};

export type EmployeeBindingStatus = {
  required: boolean;
  employeeCode?: string;
  candidates: LegacyEmployeeCandidate[];
};

export type UserProfile = {
  legacyEmployeeCode?: string;
  inspectorRoleMember?: boolean | null;
  outsourcingRoleMember?: boolean;
  id: string;
  name: string;
  role: RoleKey;
  roles?: RoleKey[];
  dingtalkUserId?: string;
  active: boolean;
  shopId?: string;
  phone?: string;
  lastLoginAt?: string;
  homeRoute?: "workbench" | "order-create" | "vehicle-trips";
};

export type DingTalkRoleMapping = {
  dingtalkRoleId: string;
  dingtalkRoleName: string;
  appRole: RoleKey;
  shopId?: string;
  homeRoute: "workbench" | "order-create" | "vehicle-trips";
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

export type PreRepairPhotos = {
  front45?: string;
  rear45?: string;
  mileage?: string;
  extra?: string[];
};

export type StoredFile = {
  repairRound?: number;
  nameplateSourceFileId?: string;
  id: string;
  orderId?: string;
  kind: "vehicle_nameplate_photo" | "repair_completed_photo" | "repair_parts_photo" | "repair_progress_photo" | "vehicle_license" | "repair_order_photo" | "damage_photo" | "signature_image" | "other";
  storageProvider: "oss" | "local";
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy?: string;
  uploadedName?: string;
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

export type WorkOrderDispatchPlan = DispatchExecution & {
  itemAssignments?: Array<{ itemId: number; technicianId: string }>;
  technicianIds?: string[];
  technicianId?: string;
  technicianName?: string;
  dueAt: string;
  urgent: boolean;
  note: string;
  activationError?: string;
  activatedAt?: string;
};

export type CustomerSignatureMode = "onsite" | "remote";

export type PaperOrder = { mode: "pending" | "dingtalk" | "runfeng"; photoIds: string[] };
export type PaperOrderResolution = { mode: "dingtalk" } | { mode: "runfeng"; dispatchNo: string };
export type VehicleLicenseException = {
  id:string; reason:string; vehiclePlate:string; vehicleVin:string;
  reportedBy:string; reportedName:string; reportedAt:string;
  notificationStatus:'pending'|'queued'|'accepted'|'failed'|'sent'|'unknown'|'suppressed'; notificationError:string;
};
export type WorkOrder = {
  isBaiyuanOrder?: boolean;
  paperOrder?: PaperOrder;
  customerVehicleEditEnabled?: boolean;
  customerVehicleLinkComplete?: boolean;
  customerVehicleUpdatedAt?: string;
  customerVehicleUpdatedBy?: string;
  vehicleLicenseException?: VehicleLicenseException;
  dispatchStage?: DispatchStage;
  dispatchPlan?: WorkOrderDispatchPlan | null;
  id: string;
  dispatchNo: string;
  arrivalDate: string;
  status: WorkOrderStatus;
  createdAt: string;
  updatedAt: string;
  createdAtIso?: string;
  updatedAtIso?: string;
  shop: ShopProfile;
  department: {
    code: string;
    name: string;
  };
  advisor: string;
  technician: string;
  inspector: string;
  vehicle: {
    isMilitary?: boolean;
    plate: string;
    vin: string;
    mileage: string;
    model: string;
    modelLegacyCode: string;
    purchaseDate: string;
  };
  customer: {
    name: string;
    legacyCode: string;
    phone: string;
    contact: string;
    address: string;
  };
  inspection: {
    belongings: string[];
    fuelLevel: "空" | "1/4" | "1/2" | "3/4" | "满";
    exteriorIssues: string[];
    preRepairPhotos?: PreRepairPhotos;
    replacedPhotoIds?: string[];
    vehicleLicenseFileId?: string;
  };
  faultDescription: string;
  pendingRepairs?: PendingRepair[];
  pendingRepairsVersion?: number;
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
  customerSignatureReview?: { mode?: CustomerSignatureMode; supplemental?: boolean; state: "pending" | "confirmed"; signedAt: string; confirmedAt?: string; confirmedBy?: string };
  customerSignatureFileId?: string;
  signaturePurpose?: "authorization" | "supplement";
  signatureToken?: string;
  signatureTokenUsed?: boolean;
  platformOrderNo?: string;
  /** Latest approval flag fetched from Runfeng (shbz=1). */
  legacyApproved?: boolean;
  legacySyncStatus?: LegacySyncStatus;
  legacySyncRevision?: number;
  legacySyncedAt?: string;
  legacySyncError?: string;
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

export type DispatchExecution = {
  executionMode?: "internal" | "field" | "outsourced";
  serviceUnit?: string;
  serviceAddress?: string;
  serviceContact?: string;
  departureAt?: string;
  expectedReturnAt?: string;
  returnedAt?: string;
  contractor?: string;
  contractorId?: string;
  outsourcingMode?: "onsite" | "offsite";
  agreedFee?: number | null;
  handedOverAt?: string;
  receivedAt?: string;
};
export type DispatchStage = "回审" | "草稿" | "待客户签字" | "待派工" | "待接单" | "待开工" | "维修中" | "暂停" | "待检验" | "维修完成";
export type DispatchItem = {
  id: number; name: string; status: RepairItemStatus;
  responsibleId?: string; responsibleName?: string;
  startAt?: string; finishAt?: string; startedBy?: string; finishedBy?: string;
  inspectorName?: string; inspectedBy?: string; inspectedAt?: string; completionRecordedAt?: string; pickedAt?: string; rejectionReason?: string;
};
export type RepairPhotoDeleteRequest = { fileIds: string[] };
export type RepairPhotoDeleteResponse = { ids: string[] };
export type RepairPhotoUploadRequest = {requestId:string;fileName:string;mimeType:string;imageBase64:string;repairRound?:number;purpose?:"progress"|"parts"|"completed"|"nameplate"};
export type VehicleNameplateEnsureRequest = {requestId:string;repairRound:number};
export type PartsRequirement = { referencePhotoIds?:string[]; preparationOnly?:boolean; applicantId?:string; applicantName?:string; ownerId?:string; ownerName?:string; sourcePhotoIds?:string[]; revision?:number; batch?:number; preparedBy?:string; preparedName?:string; preparedAt?:string; issuedBy?:string; issuedName?:string; issuedAt?:string; recipientIds?:string[]; recipientName?:string; confirmedBy?:string; confirmedName?:string; confirmedAt?:string; mode:"none"|"list"|"photo"; items:Array<{name:string;quantity:number;unit:string;recipientId?:string;recipientName?:string;issuedAt?:string;issuedBy?:string;issuedName?:string;preparedAt?:string;preparedBy?:string;preparedName?:string}>; photoIds:string[]; recordedBy?:string; recordedName?:string; recordedAt?:string };
export type RepairPhotoWaiver = {id:string;applicantId:string;applicantName:string;reason:string;requestedAt:string;repairRound:number;scope:string;status:"pending"|"approved"|"rejected";decidedBy?:string;decidedName?:string;decidedAt?:string;decisionReason?:string};
export type DispatchTask = DispatchExecution & {
  repairPhotoWaivers?:RepairPhotoWaiver[];
  createdAt?: string;
  vehicleNameplateFileId?: string;
  settlementAssignment?: boolean;
  hasPartsHistory?:boolean;
  pendingRepairCount?:number;
  inspectionDeferredCount?:number;
  deferredItems?:DispatchItem[];
  partsRequirement?:PartsRequirement;
  partsRequests?:PartsRequirement[];
  workerPauses?:Record<string,{pauseReason?:string;pauseNote?:string;pausedAt?:string;resumeStage?:DispatchStage}>;
  workerSubmissions?:Record<string,{at:string;note:string}>;
  vehicleVin?:string; vehicleModel?:string; vehicleMileage?:string; customerName?:string; advisor?:string;
  roundKind?: 'additional' | 'rework'; repairRound?: number; roundReason?: string; roundOpenedAt?: string; roundOpenedBy?: string; roundOpenedName?: string;
  repairCatalog?: Array<{id:number;name:string}>;
  repairItemIdFloor?: number;
  reworkReason?: string; rejectedItemIds?: number[]; inspectionClaimedAt?: string;
  workHours?: number; workHoursRecordedBy?: string; workHoursRecordedName?: string; workHoursRecordedAt?: string;
  technicianIds?: string[]; participantIds?: string[];
  orderId: string; shopId: string; version: number; stage: DispatchStage;
  technicianId?: string; technicianName?: string; inspectorId?: string; inspectorName?: string;
  assignedBy?: string; assignedAt?: string; acceptedAt?: string; firstStartedAt?: string;
  submittedAt?: string; completedAt?: string; completedBy?: string;
  dueAt?: string; urgent?: boolean; note?: string; feedback?: string;
  pauseReason?: string; pauseNote?: string; pausedAt?: string; resumeStage?: DispatchStage;
  submissionNote?: string; rework?: boolean; reworkCount?: number; needsReview?: boolean; legacy?: boolean; startHistoryUnknown?: boolean;
  items: DispatchItem[];
  plate: string; dispatchNo: string; arrivalDate: string; orderStatus: WorkOrderStatus;
  faultDescription: string; overdue: boolean;
};
export type RepairItemEdit = {id?:number;name:string;responsibleId?:string;responsibleName?:string};
export type PartsPreparationGroup = {partsOwnerId?:string;items:Array<{index:number;recipientId:string}>};
export type DispatchActionName = "request-photo-waiver" | "approve-photo-waiver" | "reject-photo-waiver" | "complete-outsourced" | "update-technicians" | "update-due" | "send-review" | "submit-review" | "edit-repair-items" | "edit-parts" | "issue-parts" | "confirm-parts" | "record-parts" | "reopen-repair" | "retry-scheduler-notifications" | "start-order" | "submit-order" | "claim-inspection" | "reassign-inspection" | "retry-inspection-notifications" | "record-hours" | "assign" | "reassign" | "reoffer" | "cancel" | "accept" | "decline" | "start" | "finish" | "pick" | "pause" | "resume" | "submit" | "inspect" | "update" | "remind" | "retry-notification" | "reconcile";
export type DispatchActionRequest = DispatchExecution & {
  waiverId?:string;
  deferredItemIds?:number[]; deferredReason?:string;
  preparationGroups?:PartsPreparationGroup[];
  partsOwnerId?:string;
  partsIssue?:Array<{index:number;recipientId:string}>; partsPreparation?:Array<{index:number;recipientId:string}>;
  reassignItemIds?: number[];
  repairItems?:RepairItemEdit[];
  partsRequirement?:PartsRequirement;
  reworkItemIds?: number[]; additionalItems?: string[];
  workHours?: number;
  technicianIds?: string[];
  action: DispatchActionName; expectedVersion: number; requestId: string;
  technicianId?: string; inspectorId?: string; itemId?: number; rejectedItemIds?: number[];
  dueAt?: string; urgent?: boolean; note?: string; reason?: string; pauseReason?: string;
  notificationId?: string; notificationJobId?: string;
};
export type DispatchMetric = "pendingAccept" | "unstarted" | "working" | "paused" | "inspection" | "completed" | "overdue" | "rework";
export type TechnicianSummary = {
  id: string; name: string; active: boolean; current: number;
  returnedItemCount: number; returnedItemOccurrences: number;
} & Record<DispatchMetric, number>;
export type DispatchNotification = {
  id: string; recipientName: string; kind: string;
  status: "pending" | "accepted" | "sent" | "failed" | "unknown" | "suppressed";
  error: string; createdAt: string; attempts: number; taskId?: string;
};
export type NotificationSource = 'dispatch' | 'procurement' | 'vehicle-trip' | 'license-exception' | 'vehicle-insurance';
export type NotificationUsage = {
 trackingSince: string | null; date:string; page:number; pageSize:number; budget:number; completeDays:number; average:number|null;
 daily:Array<{date:string;total:number;sends:number;queries:number;unresolved:number;coverage:'none'|'partial'|'full'}>;
 groups:Array<{kind:string;total:number;sends:number;queries:number}>;
 recipients:Array<{id:string;name:string;total:number}>;
 rows:Array<{id:string;startedAt:string;operation:'send'|'query';source:NotificationSource;notificationId:string;resourceId:string;eventKey:string;recipientName:string;kind:string;outcome:string;httpStatus:number|null;apiCode:string|null;durationMs:number|null;batchId?:string|null;recipientCount?:number;platformTaskId:string|null}>;
};
export type NotificationDelivery = {
  id: string; kind: string; recipientName: string;
  status: 'pending' | 'accepted' | 'sent' | 'failed' | 'unknown' | 'suppressed';
  error: string; createdAt: string; canQuery: boolean;
  attempts?: number; queryUnavailableReason?: string; simulated?: boolean; canRetry?: boolean;
};
export type NotificationQueryResult = Pick<NotificationDelivery, 'status' | 'error'>;
export type DispatchEvent = {
  id: string; actorName: string; action: string; at: string;
  detail: { photoWaiver?:RepairPhotoWaiver; deferredItemIds?:number[]; deferredReason?:string; roundKind?: 'additional' | 'rework'; preparationGroups?:Array<PartsPreparationGroup & {partsRequirement:PartsRequirement}>; partsIssue?:Array<{index:number;recipientId:string}>; partsPreparation?:Array<{index:number;recipientId:string}>; reassignItemIds?:number[]; previousItems?:DispatchItem[]; partsRequirement?:PartsRequirement; repairRound?:number; items?:DispatchItem[]; reworkItemIds?:number[]; additionalItems?:string[]; workHours?: number; previousWorkHours?: number; note?: string; reason?: string; technicianName?: string; previousTechnicianName?: string; dueAt?: string; previousDueAt?: string; urgent?: boolean; stage: DispatchStage; itemId?: number; rejectedItemIds?: number[]; pauseReason?: string };
};
export type RepairRound = { round:number; task:DispatchTask; reason:string; openedBy?:string; openedName:string; openedAt?:string; completedAt?:string; closed:boolean };
export type RepairWriteback = {simulated?:boolean;id:string;repairRound?:number;status:"pending"|"synced"|"failed"|"manual";error:string;attempts:number;createdAt:string;syncedAt?:string;enabled:boolean};
export type DispatchDetail = {
  repairWriteback?: RepairWriteback;
  repairRounds?: RepairRound[];
  schedulerNotifications?: Array<{eventId:string;kind:string;status:string;error:string}>;
  inspectionNotification?: {status: string; error: string};
  task: DispatchTask; events: DispatchEvent[]; notifications: DispatchNotification[];
  files: Array<Pick<StoredFile,"id"|"orderId"|"kind"|"originalName"|"mimeType"|"sizeBytes"|"createdAt"|"uploadedBy"|"uploadedName"|"repairRound"|"nameplateSourceFileId">>;
};
export type DispatchPeople = { dispatchers?: UserProfile[]; technicians: UserProfile[]; inspectors: UserProfile[]; contractors: UserProfile[] };


export type WorkOrderPhotoDelete = { fileIds: string[] };

export type WorkOrderPhotoUpdate = {
  fileId: string;
  replaceFileId?: string;
  slot: "vehicleLicense" | "front45" | "rear45" | "mileage" | "extra" | "other";
};

export type WorkOrderCustomerVehicleUpdate = {
  expectedRevision: number;
  contact: string;
  phone: string;
};
export type RepairTaskCounts = { pendingAccept: number; inProgress: number; inspection: number; review: number; completed: number };

export type RunfengWarehouse = {id:number;departmentCode:string;departmentName:string;name:string};
export type RunfengStock = {departmentCode:string;departmentName:string;warehouse:string;location:string;quantity:number|null};
export type RunfengPart = {code:string;name:string;specification:string;manufacturer:string;models:string;unit:string;referenceCode:string;stocks:RunfengStock[]};
export type RunfengStockSearchResult = {items:RunfengPart[];hasMore:boolean;query:string;warehouseId?:number;inStockOnly:boolean;source:"润丰";queriedAt:string};

export type VehicleHistoricalPart = {code:string;name:string;specification:string;unit:string;manufacturer:string;quantity:number;lastUsedAt:string;dispatchNo:string;repairOrderId:string;vehicleModel:string};
export type VehiclePartsHistory = {status:"found"|"no_history"|"no_parts";items:VehicleHistoricalPart[];hasMore:boolean;plate:string;source:"润丰";queriedAt:string};

export type ResolveRepairWritebackRequest = {jobId:string;reason:string};

// Procurement: money is transported as integer fen; dates as ISO 8601 instants.
export type ProcurementSupplier = {
  id: string; name: string; contactName: string; phone: string; categories: string; note: string; active: boolean;
};
export type ProcurementSupplierInput = Omit<ProcurementSupplier, 'id'>;
export type ProcurementTerms = {
  vehicleModel?: string; vin?: string; nameplatePhotoIds?: string[]; otherPhotoIds?: string[]; partName: string; category: string; specification: string; brand: string; quantity: number; unit: string;
  deliveryBy: string; paymentTerms: string; qualityRequirements: string; imageUrls: string[];
};
type ProcurementTermsInput = Omit<ProcurementTerms, 'unit' | 'qualityRequirements' | 'paymentTerms'> & Partial<Pick<ProcurementTerms, 'unit' | 'qualityRequirements' | 'paymentTerms'>>;
export type ProcurementCreateInput = ProcurementTermsInput & { supplierIds: string[]; deadline: string | null; requestId: string };
export type ProcurementUpdateInput = ProcurementTermsInput & { deadline: string | null; expectedVersion: number; reopen?: boolean };
export type ProcurementQuoteInput = {
  termsVersion?: number;
  requestId: string; unitPriceFen?: number; freightFen?: number; deliveryAt?: string; meetsRequirements?: boolean;
  note: string; declined: boolean;
};
export type ProcurementQuote = ProcurementQuoteInput & { id: string; termsVersion: number; totalFen?: number; submittedAt: string };
export type ProcurementStatus = 'open' | 'closed' | 'awarded' | 'failed' | 'cancelled';
export type ProcurementInvitation = {
  id: string; supplierId: string; supplierName: string; quotes: ProcurementQuote[]; invalidReason: string;
};
export type ProcurementPurchaseApproval = {
 status:'pending'|'approved'|'rejected';submittedBy:string;submittedName:string;submittedAt:string;
 reviewedBy?:string;reviewedName?:string;reviewedAt?:string;reason?:string;
 snapshot:{paymentMethod:string;purchaseDate:string;supplierName:string;contactName:string;phone:string;handlerPhone:string;invoice:string;recipientUnit:string;note:string;partName:string;specification:string;quantity:number;unit:string;unitPriceFen:number;freightFen:number;totalFen:number;customerAmountFen?:number};
};
export type ProcurementTender = {
  purchaseApproval?:ProcurementPurchaseApproval;
  id: string; version: number; termsVersion: number; data: ProcurementTerms; status: ProcurementStatus; deadline: string | null;
  closedAt: string | null; createdAt: string; winnerId: string | null; winnerIds?: string[]; reason: string;
  invitations: ProcurementInvitation[];
};
export type ProcurementLink = { supplierName: string; token: string; expiresAt: string };
export type ProcurementAudit = { id: string; actor: string; action: string; detail: Record<string, unknown>; at: string };
export type ProcurementDelivery = { id: string; status: string; error: string; recipientName: string; batchId?: string; title?: string; createdAt?: string; simulated?: boolean };
export type ProcurementDetail = { sharedLink?: ProcurementLink; hasActiveSharedLink?: boolean; tender: ProcurementTender; audit: ProcurementAudit[]; notifications: ProcurementDelivery[] };
export type ProcurementMetric = {
  supplierId: string; supplierName: string; invited: number; quoted: number; valid: number; awarded: number;
  lost: number; missed: number; declined: number; invalid: number; pending: number; participatedFailed: number;
  awardAmountFen: number; responseRate: number | null; winRate: number | null;
  priceIndex: number | null; priceSamples: number; priceLost: number; opportunityFen: number;
};
export type ProcurementAnalytics = {
  from: string; to: string; total: number; awarded: number; failed: number; pending: number; awardAmountFen: number;
  suppliers: ProcurementMetric[]; months: { month: string; total: number; awarded: number; failed: number }[];
};
export type ProcurementReport = {
  id: string; supplierName: string; from: string; to: string; generatedAt: string; note: string;
  metrics: Omit<ProcurementMetric, 'priceIndex' | 'priceSamples' | 'opportunityFen'>;
  benchmark: { samples: number; competitorCount: number; gapBand: string | null; below: number; near: number; above: number };
  categories: { category: string; samples: number; gapBand: string }[];
  quarters: { quarter: string; quoted: number; awarded: number; samples: number; gapBand: string | null }[];
};
export type ProcurementReportRecord = { id: string; snapshot: ProcurementReport; publishedAt: string | null; notifications: ProcurementDelivery[] };
export type ProcurementPortal = { kind: 'quote'; supplierName: string; tenderId: string; invitationId: string; termsVersion: number; terms: ProcurementTerms;
  status: ProcurementStatus; deadline: string | null; quotes: ProcurementQuote[]; result: string;
} | { kind: 'report'; report: ProcurementReport };


export type CustomerSignatureOrder = {
  id: string;
  shop: Pick<ShopProfile, "name" | "address" | "phone">;
  vehicle: Pick<WorkOrder["vehicle"], "plate" | "model" | "mileage">;
  customerName: string;
  faultDescription: string;
  repairItems: { name: string; laborFee: number }[];
  estimatedFee: number;
  feeNote: string;
  oldPartsHandling: WorkOrder["oldPartsHandling"];
  estimatedDeliveryAt: string;
};
export type CustomerSignatureSession =
  | { state: "pending"; expiresAt: string | null; order: CustomerSignatureOrder }
  | { state: "signed" };
export type CustomerSignatureInput = { token: string; imageBase64: string; confirmed: boolean };

export interface PrintPdfUpload {
  pdfBase64: string;
  fileName: string;
}

export interface PrintPdfDownload {
  path: string;
  expiresAt: string;
}

export type VehicleLicenseHistory = {fileId:string;plate:string;vin:string;selectedAt:string};
export type VehicleLicenseHistoryQuery = {plate?:string;vin?:string;excludeOrderId?:string;fileId?:string};
export type VehicleLicenseReuseResult = {fileId:string;vin:string};

export type OrderPhotoCategory = 'reception' | 'repair';
export type OrderOverview = { order: WorkOrder; dispatch: DispatchDetail };
export type OrderPhotoExportRequest = { categories: OrderPhotoCategory[] };
export type OrderPhotoExportDownload = { path: string; fileName: string; expiresAt: string; photoCount: number };

export type VehicleInsuranceDetails = Partial<Record<"originalPlate"|"registrationNote"|"condition"|"department"|"owner"|"payer"|"insurer",string>>;
export type CompanyVehicleImportRow = {plate:string;model:string;insuranceStart:string;insuranceEnd:string;insuranceDetails:VehicleInsuranceDetails};
export type CompanyVehicle = {
  insuranceStart?:string; insuranceEnd?:string; insuranceDetails?:VehicleInsuranceDetails;
  id: string; shopId: string; plate: string; brand: string; model: string; active: boolean;
};
export type CompanyVehicleInput = Pick<CompanyVehicle, "plate" | "brand" | "model" | "active" | "insuranceStart" | "insuranceEnd" | "insuranceDetails">;
export type VehicleTripStatus = "待审批" | "待出车" | "用车中" | "待收车审核" | "已还车" | "已驳回" | "已取消";
export type VehicleTripStage = "departure" | "return" | "signature";
export type VehicleTripAction = "approve" | "reject" | "cancel" | "depart" | "return" | "approve-return" | "reject-return";
export type VehicleTripAttachment = { fileId: string; stage: VehicleTripStage; confirmed: boolean; returnRound: number };
export type VehicleTrip = {
  id: string; shopId: string; applicantId: string; applicantName: string; vehicleId: string;
  vehicle: Pick<CompanyVehicle, "plate" | "brand" | "model">;
  reason: string; note: string; status: VehicleTripStatus; createdAt: string;
  approvedBy?: string; approvedName?: string; approvedAt?: string;
  departureAt?: string; returnAt?: string; rejectionReason?: string;
  departureEvidence: "license" | "mileage";
  returnRound: number; returnReviewedBy?: string; returnReviewedName?: string; returnReviewedAt?: string; returnRejectionReason?: string;
};
export type VehicleTripDetail = VehicleTrip & {
  attachments: VehicleTripAttachment[];
  history: Array<{ action: string; actorName: string; at: string }>;
};
export type VehicleTripCreateInput = { requestId: string; vehicleId: string; reason: string; note: string; departurePhotos: string[] };
export type VehicleTripActionInput = { requestId: string; fileIds?: string[]; reason?: string; returnRound?: number };
export type VehicleTripUploadInput = { requestId: string; stage: Exclude<VehicleTripStage, "signature">; imageBase64: string; returnRound?: number };
export interface AppVersionResponse { version: string }


export interface PageResult<T> { counts?: Record<string,number>; items: T[]; total: number; page: number; pageSize: number; }
export interface ArchiveFilters {
  search: string; baiyuanOnly: boolean; range: 'all' | 'today' | 'yesterday' | 'week' | 'custom';
  from: string; to: string; statuses: string[]; advisors: string[]; technicians: string[];
  sort: DispatchNumberSort | 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc';
}
export interface WorkOrderListQuery {
  page: number; pageSize: number; search?: string; baiyuanOnly?: string; from?: string; to?: string;
  statuses?: string; advisors?: string; technicians?: string; sort?: ArchiveFilters['sort']; shopId?: string;
}
export interface ArchiveOptions { statuses: Array<{value: string; label: string}>; advisors: Array<{value: string; label: string}>; technicians: Array<{value: string; label: string}>; }

export type WorkloadState = "working" | "waiting" | "paused" | "inspection" | "unfinished";
export type WarehouseRequestSort = DispatchNumberSort | 'newest' | 'oldest';
export type DispatchFilters = {sort?:DispatchNumberSort | 'assigned-asc'|'assigned-desc'|'due-asc'|'due-desc';assignedFrom?:string;assignedTo?:string;personal?:'true';includeCompleted?:string;workloadState?:WorkloadState;partsStatus?:string;partsSort?:WarehouseRequestSort;executionMode?:string;search?:string;technicianId?:string;stage?:string;metric?:string;urgent?:string;overdue?:string;from?:string;to?:string};

export type OperationsMetric = 'unfinished'|'working'|'waiting'|'parts'|'pickup'|'paused'|'inspection'|'overdue';
export type OperationsProject = {
  createdAt?:string;
  key:string; orderId:string; plate:string; dispatchNo:string; name:string;
  ownerId?:string; ownerName:string; status:string; dueAt?:string;
  flags:OperationsMetric[]; waitingSince?:string; note:string;
};
export type OperationsWorker = {
  id:string; name:string; assignable:boolean; vehicles:number;
  counts:Record<OperationsMetric,number>;
};
export type OperationsDashboard = {
  generatedAt:string; vehicles:number; unassigned:number; uncertain:number;
  counts:Record<OperationsMetric,number>; workers:OperationsWorker[]; projects:OperationsProject[];
};

export type AnalyticsCount = {name:string;value:number};
export type AnalyticsComparison = {value:number;previous:number;change:number|null};
export type BusinessAnalytics = {
  generatedAt:string;
  range:{days:number;from:string;to:string;previousFrom:string;previousTo:string};
  kpis:{orders:AnalyticsComparison;completed:AnalyticsComparison;vehicles:AnalyticsComparison;cycleDays:{value:number|null;previous:number|null;samples:number}};
  daily:Array<{date:string;previousDate:string;created:number;previous:number;completed:number}>;
  monthly:Array<{month:string;value:number;partial:boolean}>;
  customers:AnalyticsCount[];customerCount:number;vehicleMix:AnalyticsCount[];status:AnalyticsCount[];
  aging:AnalyticsCount[];cycleBuckets:AnalyticsCount[];execution:AnalyticsCount[];liveCount:number;
  quality:{missingCompletion:number;missingVehicle:number;invalidCreated:number};
};

export type TechnicianCompletedProject = {
  createdAt?:string;
  key: string; orderId: string; dispatchNo: string; plate: string; round: number;
  itemId: number; name: string; completedAt: string;
};

export type TechnicianCompletedOrder = {
  key: string; orderId: string; dispatchNo: string; plate: string;
  projects: TechnicianCompletedProject[];
};

export type CompletedProjectFilters = {from?:string;to?:string;sort?:DispatchNumberSort | 'completed-asc'|'completed-desc'};

/** List metadata only; fetch the full order before editing, signing or printing. */
export type WorkOrderListItem = Pick<WorkOrder, "id" | "dispatchNo" | "arrivalDate" | "status" | "createdAt" | "updatedAt" | "createdAtIso" | "updatedAtIso" | "shop" | "vehicle" | "customer" | "advisor" | "technician" | "dispatchStage" | "customerSignatureReview" | "isBaiyuanOrder" | "paperOrder" | "legacyApproved" | "legacySyncStatus" | "legacySyncRevision" | "legacySyncedAt" | "legacySyncError" | "customerVehicleUpdatedAt" | "customerVehicleUpdatedBy" | "estimatedFee" | "settlementAmount">;

export interface PurchaseDocumentRules {
  mode:'original'|'fixed'|'range'; fixedPercent:number; minPercent:number; maxPercent:number; decimals:0|2;
  minOriginalPrice:number; excludeBattery:boolean; excludeTyre:boolean; excludeOil:boolean;
  splitPaint:boolean; splitHengyu:boolean; dateMode:'source'|'blank'|'fixed'; date:string;
  excludedNames:string; overrides:Array<{name:string;kind:'price'|'percent';value:number}>;
  modelRules:Array<{models:string;template:string}>;
}
export interface PurchaseDocumentFile {name:string;base64:string}
export interface PurchaseDocumentPreview {
  lines:Array<{file:string;sheet:string;row:number;code:string;name:string;qty:number;price:number;newPrice:number;amount:number}>;
  canGenerate:boolean;
  summary:{documents:number;generated:number;kept:number;excluded:number;total:number;templates:Record<string,number>};
  issues:Array<{file:string;sheet:string;code:string;message:string;severity:'warning'|'error';row?:number}>;
  rates:Array<{name:string;percent:number|null;price:number|null}>;
  docs:Array<{id:string;file:string;sheet:string;code:string;model:string;plate:string;date:string;template:string;kept:number;paint:number;excluded:number;total:number}>;
}

export type PersonalBusinessTarget = { targetKey: 'dispatchOrder' | 'workOrder' | 'vehicleTrip' | 'procurementTender' | 'procurementReport'; targetId: string };
export type PersonalTodo = PersonalBusinessTarget & { id: string; category: string; title: string; summary: string };
export type PersonalMessage = PersonalBusinessTarget & { id: string; title: string; summary: string; plate: string; createdAt: string; readAt: string | null };
export type PersonalInboxPage = { items: PersonalMessage[]; nextCursor: string | null };
export type PersonalWorkbench = { unread: number; latestId: string; todos: PersonalTodo[]; updatedAt: string };
