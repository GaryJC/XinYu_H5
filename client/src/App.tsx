import {
  BarChart3,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Copy,
  FileSignature,
  Gauge,
  LayoutDashboard,
  Link,
  LockKeyhole,
  Menu,
  Plus,
  ReceiptText,
  RefreshCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Wrench
} from "lucide-react";
import { type ChangeEvent, useEffect, useId, useMemo, useState } from "react";
import { MetricCard, StatusChip } from "./components";
import { dingTalkAuthAdapter, notificationAdapter } from "./adapters";
import { createEmptyDraft, roles, sumLabor, validateWorkOrderDraft, workflow } from "./domain";
import { workOrderApi } from "./mockApi";
import {
  canCompleteRepair,
  canCreateOrder,
  canDispatch,
  canSendSignature,
  canSettle,
  canSubmitDispatch
} from "./permissions";
import { DashboardSummary, OcrFieldKey, OcrFieldState, RepairItem, RoleKey, UserProfile, VehicleLicenseOcrResult, WorkOrder, WorkOrderDraft } from "../../shared/types";

const navItems: Array<{ label: string; icon: typeof LayoutDashboard; roles: RoleKey[] }> = [
  { label: "工作台", icon: LayoutDashboard, roles: ["advisor", "dispatcher", "technician", "inspector", "manager"] },
  { label: "委托开单", icon: ClipboardList, roles: ["advisor", "manager"] },
  { label: "派工管理", icon: UsersRound, roles: ["dispatcher", "manager"] },
  { label: "维修进度", icon: Wrench, roles: ["technician", "inspector", "manager"] },
  { label: "结算清单", icon: ReceiptText, roles: ["advisor", "manager"] },
  { label: "数据看板", icon: BarChart3, roles: ["manager"] },
  { label: "权限设置", icon: ShieldCheck, roles: ["manager"] }
];

const belongings = ["音响系统", "点烟器", "天窗", "四门玻璃机", "中央门锁", "后视镜", "备胎", "灭火器", "行驶证", "千斤顶", "贵重物品"];
const exteriorIssues = ["石击", "凹凸", "划伤", "损坏"];

const initialOcrState: Record<OcrFieldKey, OcrFieldState> = {
  vehicleLicense: { source: "行驶证照片", status: "未识别", value: "" }
};

const roleFocus: Record<RoleKey, { title: string; dataScope: string; primary: string; blocked: string[] }> = {
  advisor: {
    title: "服务顾问工作区",
    dataScope: "只显示本人创建或负责签字的委托单",
    primary: "开单、维护客户车辆信息、发起客户签字、提交派工池",
    blocked: ["不能指派技师", "不能提交维修完成", "不能改权限"]
  },
  dispatcher: {
    title: "派单员工作区",
    dataScope: "只显示待派工和维修中的工单",
    primary: "查看待派工池、指派/改派维修技师",
    blocked: ["不能编辑客户信息", "不能发起客户签字", "不能确认结算"]
  },
  technician: {
    title: "维修技师工作区",
    dataScope: "只显示派给陈立的维修单",
    primary: "查看自己的维修任务、确认领料、提报维修完成",
    blocked: ["不能看全店工单", "不能派工", "不能查看权限配置"]
  },
  inspector: {
    title: "检验员工作区",
    dataScope: "只显示维修中和待结算工单",
    primary: "执行完工检验、签署检验结果、退回返修占位",
    blocked: ["不能开单", "不能派工", "不能确认结算"]
  },
  manager: {
    title: "管理员工作区",
    dataScope: "显示全量门店数据",
    primary: "查看全量数据、处理异常、确认结算、配置权限",
    blocked: ["生产环境仍需后端强制审计"]
  }
};

export function App() {
  const [signToken, setSignToken] = useState(getSignTokenFromHash());

  useEffect(() => {
    const onHashChange = () => setSignToken(getSignTokenFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (signToken) {
    return <SignaturePage token={signToken} onBack={() => {
      window.location.hash = "";
      setSignToken(null);
    }} />;
  }

  return <Workbench />;
}

function Workbench() {
  const [activeNav, setActiveNav] = useState("工作台");
  const [role, setRole] = useState<RoleKey>("advisor");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkOrderDraft>(() => createEmptyDraft());
  const [ocrState, setOcrState] = useState(initialOcrState);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState("");
  const [signatureLink, setSignatureLink] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [syncLabel, setSyncLabel] = useState("钉钉组织已同步");
  const [ocrRecordIds, setOcrRecordIds] = useState<Partial<Record<OcrFieldKey, string>>>({});
  const [vehicleLicenseOcr, setVehicleLicenseOcr] = useState<VehicleLicenseOcrResult>();
  const [dashboard, setDashboard] = useState<DashboardSummary>();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile>();

  const selectedOrder = orders.find((order) => order.id === selectedId);
  const actor = currentUser?.name || roles[role].name;
  const visibleNavItems = useMemo(() => navItems.filter((item) => item.roles.includes(role)), [role]);
  const canEditForm = canCreateOrder(role);
  const totalLabor = useMemo(() => sumLabor(draft.repairItems), [draft.repairItems]);
  const technicianOptions = useMemo(() => users.filter((user) => user.active && user.role === "technician").map((user) => user.name), [users]);
  const inspectorOptions = useMemo(() => users.filter((user) => user.active && user.role === "inspector").map((user) => user.name), [users]);

  const searchedOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) =>
      [order.id, order.vehicle.plate, order.vehicle.vin, order.customer.name].some((value) =>
        value.toLowerCase().includes(term)
      )
    );
  }, [orders, searchTerm]);

  const counters = useMemo(() => {
    return [
      { label: "待客户签字", value: orders.filter((item) => item.status === "待客户签字").length },
      { label: "待派工", value: orders.filter((item) => item.status === "待派工").length },
      { label: "维修中", value: orders.filter((item) => item.status === "维修中").length },
      { label: "待结算", value: orders.filter((item) => item.status === "待结算").length }
    ];
  }, [orders]);

  useEffect(() => {
    void bootstrapAuth();
    void dingTalkAuthAdapter.syncOrganization().then((result) => setSyncLabel(`钉钉组织已同步 ${result.users} 人`));
    void workOrderApi.users().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    void loadOrders(role);
    void loadDashboard(role);
  }, [role]);

  useEffect(() => {
    if (!visibleNavItems.some((item) => item.label === activeNav)) {
      setActiveNav("工作台");
    }
  }, [activeNav, visibleNavItems]);

  async function loadOrders(nextRole = role, keepId = selectedId) {
    try {
      setApiError("");
      const next = await workOrderApi.list(nextRole);
      const safeNext = Array.isArray(next) ? next : [];
      setOrders(safeNext);
      const nextSelected = safeNext.find((order) => order.id === keepId) ?? safeNext[0];
      if (nextSelected) {
        selectOrder(nextSelected);
      } else {
        setSelectedId(null);
        setDraft(createEmptyDraft());
      }
    } catch (error) {
      setOrders([]);
      setSelectedId(null);
      setDraft(createEmptyDraft());
      setApiError(error instanceof Error ? error.message : "后端 API 暂时不可用");
    }
  }

  async function loadDashboard(nextRole = role) {
    try {
      setDashboard(await workOrderApi.dashboard(nextRole));
    } catch {
      setDashboard(undefined);
    }
  }

  async function bootstrapAuth() {
    try {
      const user = await workOrderApi.me();
      setCurrentUser(user);
      setRole(user.role);
      setSyncLabel(`已登录：${user.name}`);
      return;
    } catch {
      // No local session yet. In plain browser development we keep the role switcher.
    }

    try {
      const authCode = await getDingTalkAuthCode();
      if (!authCode) return;
      const result = await workOrderApi.loginWithDingTalk(authCode);
      setCurrentUser(result.user);
      setRole(result.user.role);
      setSyncLabel(`钉钉免登成功：${result.user.name}`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "钉钉免登失败");
    }
  }

  function selectOrder(order: WorkOrder) {
    setSelectedId(order.id);
    setDraft(orderToDraft(order));
    setFormErrors([]);
    setSignatureLink(order.signatureToken ? buildSignatureLink(order.signatureToken) : "");
    setOcrState(initialOcrState);
    setOcrRecordIds({});
    setVehicleLicenseOcr(undefined);
  }

  function startNewOrder() {
    setSelectedId(null);
    setDraft(createEmptyDraft());
    setSignatureLink("");
    setFormErrors([]);
    setOcrState(initialOcrState);
    setOcrRecordIds({});
    setVehicleLicenseOcr(undefined);
  }

  async function saveDraft() {
    if (!canCreateOrder(role)) {
      setFormErrors(["当前角色不能创建或编辑委托单"]);
      return;
    }

    if (selectedOrder) {
      const updated = await workOrderApi.update({ ...selectedOrder, ...draft }, actor, "保存委托单");
      await loadOrders(role, updated.id);
      return;
    }

    const created = await workOrderApi.create(draft, actor);
    await loadOrders(role, created.id);
  }

  async function sendSignature() {
    const errors = validateBeforeSignature();
    if (errors.length) {
      setFormErrors(errors);
      return;
    }

    const order = selectedOrder ?? (await workOrderApi.create(draft, actor));
    if (selectedOrder) await workOrderApi.update({ ...selectedOrder, ...draft }, actor, "保存签字前委托单");
    const withToken = await workOrderApi.createSignatureToken(order.id, actor);
    await notificationAdapter.sendSignatureTodo(withToken);
    setSignatureLink(buildSignatureLink(withToken.signatureToken!));
    await loadOrders(role, withToken.id);
  }

  async function submitDispatch() {
    if (!selectedOrder) return;
    const updated = await workOrderApi.transition(selectedOrder.id, "待派工", actor, "提交派工池");
    await loadOrders(role, updated.id);
  }

  async function dispatchToTechnician(technician: string) {
    if (!selectedOrder) return;
    const updated = await workOrderApi.transition(selectedOrder.id, "维修中", actor, `指派维修技师：${technician}`, {
      technician,
      repairItems: selectedOrder.repairItems.map((item) => ({ ...item, owner: item.owner === "待派工" ? technician : item.owner }))
    });
    await loadOrders(role, updated.id);
  }

  async function completeRepair() {
    if (!selectedOrder) return;
    const updated = await workOrderApi.transition(selectedOrder.id, "待结算", actor, role === "inspector" ? "检验通过" : "维修完成提报", {
      inspector: role === "inspector" ? actor : selectedOrder.inspector,
      signatures: role === "inspector" ? { ...selectedOrder.signatures, inspector: actor } : selectedOrder.signatures
    });
    await loadOrders(role, updated.id);
  }

  async function settleOrder() {
    if (!selectedOrder) return;
    if (!selectedOrder.settlementStatements.length) {
      await workOrderApi.createSettlement(selectedOrder.id, actor);
    }
    const updated = await workOrderApi.transition(selectedOrder.id, "完成", actor, "确认结算并归档", {
      settlementAmount: Number(draft.settlementAmount || draft.estimatedFee || totalLabor),
      feeNote: draft.feeNote
    });
    await loadOrders(role, updated.id);
  }

  async function scanVehicleLicense(file: File) {
    setOcrState((current) => ({
      ...current,
      vehicleLicense: { ...current.vehicleLicense, status: "识别中", error: undefined }
    }));
    setVehicleLicenseOcr(undefined);

    try {
      const imageBase64 = await fileToBase64(file);
      const uploadedFile = await workOrderApi.uploadFile({
        orderId: selectedOrder?.id,
        kind: "vehicle_license",
        fileName: file.name || "vehicle-license.jpg",
        mimeType: file.type || "image/jpeg",
        imageBase64
      });
      const result = await workOrderApi.recognizeVehicleLicense(imageBase64);
      const summary = formatVehicleLicenseSummary(result);
      const record = await workOrderApi.createOcrRecord(selectedOrder?.id, "vehicleLicense", initialOcrState.vehicleLicense.source, JSON.stringify(result), result.confidence, uploadedFile.id);
      setOcrRecordIds((current) => ({ ...current, vehicleLicense: record.id }));
      setVehicleLicenseOcr(result);
      setOcrState((current) => ({
        ...current,
        vehicleLicense: { ...current.vehicleLicense, status: "待确认", value: summary }
      }));
      setDraft((current) => ({
        ...current,
        vehicle: {
          ...current.vehicle,
          plate: result.plate || current.vehicle.plate,
          vin: result.vin || current.vehicle.vin,
          model: result.model || current.vehicle.model,
          purchaseDate: normalizeOcrDate(result.registerDate) || current.vehicle.purchaseDate
        },
        customer: {
          ...current.customer,
          name: result.owner || current.customer.name,
          contact: result.owner || current.customer.contact,
          address: result.address || current.customer.address
        }
      }));
    } catch (error) {
      setOcrState((current) => ({
        ...current,
        vehicleLicense: {
          ...current.vehicleLicense,
          status: "未识别",
          value: "",
          error: error instanceof Error ? error.message : "行驶证识别失败"
        }
      }));
    }
  }

  function confirmVehicleLicenseOcr() {
    const recordId = ocrRecordIds.vehicleLicense;
    const value = vehicleLicenseOcr ? JSON.stringify(vehicleLicenseOcr) : ocrState.vehicleLicense.value;
    if (recordId) void workOrderApi.confirmOcrRecord(recordId, value, actor);
    setOcrState((current) => ({ ...current, vehicleLicense: { ...current.vehicleLicense, status: "已确认" } }));
  }

  async function syncPlatform() {
    if (!selectedOrder) return;
    const updated = await workOrderApi.syncPlatform(selectedOrder.id, actor);
    await loadOrders(role, updated.id);
    await loadDashboard(role);
  }

  async function updateRepairAction(itemId: number, action: string, patch: Record<string, unknown> = {}) {
    if (!selectedOrder) return;
    const updated = await workOrderApi.repairItemAction(selectedOrder.id, itemId, action, actor, patch);
    await loadOrders(role, updated.id);
    await loadDashboard(role);
  }

  async function createSettlement() {
    if (!selectedOrder) return;
    const updated = await workOrderApi.createSettlement(selectedOrder.id, actor);
    await loadOrders(role, updated.id);
    await loadDashboard(role);
  }

  function validateBeforeSignature() {
    const errors = validateWorkOrderDraft(draft);
    const pending = Object.values(ocrState).filter((item) => item.status === "待确认");
    if (pending.length) errors.push("OCR 识别结果仍有待确认字段");
    return errors;
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ClipboardCheck size={20} />
          </div>
          <div>
            <strong>修理委托</strong>
            <span>钉钉自建 H5</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeNav === item.label ? "nav-item active" : "nav-item"}
                key={item.label}
                onClick={() => setActiveNav(item.label)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <LockKeyhole size={16} />
          <p>权限由钉钉身份 + 系统业务角色共同决定，后端接口必须二次校验。</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" aria-label="打开菜单">
            <Menu size={20} />
          </button>
          <div>
            <h1>机动车修理委托书数字化工作台</h1>
            <p>今日 {orders.length} 张委托单；当前门店：上海虹桥店；当前状态：{selectedOrder?.status ?? "新建草稿"}</p>
          </div>
          <div className="topbar-actions">
            <div className="sync-state">
              <RefreshCcw size={15} />
              <span>{syncLabel}</span>
            </div>
            <label className="role-switcher">
              <UserRound size={16} />
              <select value={role} disabled={Boolean(currentUser)} onChange={(event) => setRole(event.target.value as RoleKey)}>
                {Object.entries(roles).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <section className="metric-grid" aria-label="待办统计">
          {counters.map((counter) => (
            <MetricCard key={counter.label} label={counter.label} value={counter.value} />
          ))}
        </section>

        {apiError ? (
          <div className="error-box">
            <span>后端连接异常：{apiError}</span>
            <span>请确认 `npm run dev` 已同时启动 API server 和 Vite。</span>
          </div>
        ) : null}

        <section className="role-focus-strip">
          <div>
            <strong>{roleFocus[role].title}</strong>
            <span>{roleFocus[role].dataScope}</span>
          </div>
          <p>{roleFocus[role].primary}</p>
          <div>
            {roleFocus[role].blocked.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        <section className="workspace-grid">
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

          <aside className="panel side-panel">
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
                  <span key={permission}>{permission}</span>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <ModulePanel activeNav={activeNav} orders={orders} dashboard={dashboard} users={users} />

        <section className="panel lower-panel">
          <div className="panel-header">
            <div>
              <h2>归档查询</h2>
              <p>当前为本系统主数据；维修业务平台接口后续仅做同步/查询。</p>
            </div>
            <div className="search-box">
              <Search size={16} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索车牌 / VIN / 工单号" />
            </div>
          </div>

          <div className="orders-table">
            <div className="orders-row orders-head">
              <span>委托单号</span>
              <span>车牌</span>
              <span>车主</span>
              <span>服务顾问</span>
              <span>维修技师</span>
              <span>状态</span>
              <span>金额</span>
              <span>更新时间</span>
            </div>
            {searchedOrders.map((order) => (
              <button className={order.id === selectedId ? "orders-row selected" : "orders-row"} key={order.id} type="button" onClick={() => selectOrder(order)}>
                <strong>{order.id}</strong>
                <span>{order.vehicle.plate || "-"}</span>
                <span>{order.customer.name || "-"}</span>
                <span>{order.advisor}</span>
                <span>{order.technician}</span>
                <StatusChip status={order.status} />
                <span>{order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-"}</span>
                <span>{order.updatedAt}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PlatformPanel({ order, role, onSync }: { order?: WorkOrder; role: RoleKey; onSync: () => void }) {
  const canSync = Boolean(order && (role === "advisor" || role === "manager") && order.status !== "草稿");
  return (
    <div className="permission-card">
      <div className="permission-head">
        <RefreshCcw size={18} />
        <strong>平台同步 / 出库单</strong>
      </div>
      {!order ? <p>选择委托单后可同步维修业务平台。</p> : (
        <>
          <p>平台工单：{order.platformOrderNo || "未同步"}；派工号：{order.dispatchNo || "待生成"}</p>
          <button className="secondary-button full-width" type="button" disabled={!canSync} onClick={onSync}>同步并生成出库单</button>
          <div className="mini-list">
            {order.platformSyncRecords.map((item) => (
              <span key={item.id}>{item.status} · {item.platformOrderNo} · {item.message}</span>
            ))}
            {order.outboundOrders.map((outbound) => (
              <span key={outbound.id}>出库单 {outbound.id} · {outbound.status} · {outbound.items.length} 项</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SettlementPanel({ order, role, onCreateSettlement }: { order?: WorkOrder; role: RoleKey; onCreateSettlement: () => void }) {
  return (
    <div className="permission-card">
      <div className="permission-head">
        <ReceiptText size={18} />
        <strong>结算清单</strong>
      </div>
      {!order ? <p>选择委托单后查看结算匹配。</p> : (
        <>
          <button className="secondary-button full-width" type="button" disabled={!(role === "advisor" || role === "manager")} onClick={onCreateSettlement}>同步/生成结算清单</button>
          <div className="mini-list">
            {order.settlementStatements.length ? order.settlementStatements.map((item) => (
              <span key={item.id}>{item.matchStatus} · {item.dispatchNo} · ¥{item.amount}</span>
            )) : <span>暂无结算清单</span>}
          </div>
        </>
      )}
    </div>
  );
}

function ModulePanel({ activeNav, orders, dashboard, users }: { activeNav: string; orders: WorkOrder[]; dashboard?: DashboardSummary; users: UserProfile[] }) {
  if (activeNav === "数据看板") return <DashboardPanel dashboard={dashboard} />;
  if (activeNav === "权限设置") return <UsersPanel users={users} />;
  if (activeNav === "结算清单") return <SettlementList orders={orders} />;
  if (activeNav === "派工管理") return <OutboundList orders={orders} />;
  if (activeNav === "维修进度") return <TechnicianTaskList orders={orders} />;
  return null;
}

function DashboardPanel({ dashboard }: { dashboard?: DashboardSummary }) {
  if (!dashboard) return null;
  return (
    <section className="panel module-panel">
      <div className="panel-header">
        <div>
          <h2>数据看板</h2>
          <p>基于当前委托单实时聚合，后续可替换为 BI/图表服务。</p>
        </div>
      </div>
      <div className="dashboard-grid">
        <ChartBlock title="单据状态" data={dashboard.statusCounts} />
        <ChartBlock title="维修项目占比" data={dashboard.repairItemCounts} />
        <ChartBlock title="进厂里程区间" data={dashboard.mileageBuckets} />
        <ChartBlock title="员工接单量" data={dashboard.employeeRanking} />
      </div>
    </section>
  );
}

function ChartBlock({ title, data }: { title: string; data: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="chart-block">
      <strong>{title}</strong>
      {Object.entries(data).slice(0, 8).map(([label, value]) => (
        <div className="bar-row" key={label}>
          <span>{label}</span>
          <em style={{ width: `${Math.max(8, (value / max) * 100)}%` }} />
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function UsersPanel({ users }: { users: UserProfile[] }) {
  return (
    <section className="panel module-panel">
      <div className="panel-header">
        <div>
          <h2>权限设置</h2>
          <p>当前为钉钉组织同步占位，后续以钉钉 userId 绑定业务角色。</p>
        </div>
      </div>
      <div className="compact-grid">
        {users.map((user) => (
          <div className="mini-card" key={user.id}>
            <strong>{user.name}</strong>
            <span>{roles[user.role].name} · {user.active ? "启用" : "停用"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettlementList({ orders }: { orders: WorkOrder[] }) {
  return (
    <section className="panel module-panel">
      <div className="panel-header"><h2>结算清单匹配</h2></div>
      <div className="compact-grid">
        {orders.flatMap((order) => order.settlementStatements).map((item) => (
          <div className="mini-card" key={item.id}>
            <strong>{item.dispatchNo} · {item.plate}</strong>
            <span>{item.technician} · ¥{item.amount} · {item.matchStatus}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function OutboundList({ orders }: { orders: WorkOrder[] }) {
  return (
    <section className="panel module-panel">
      <div className="panel-header"><h2>出库单 / 领料</h2></div>
      <div className="compact-grid">
        {orders.flatMap((order) => order.outboundOrders).map((item) => (
          <div className="mini-card" key={item.id}>
            <strong>{item.id}</strong>
            <span>{item.dispatchNo} · {item.technician} · {item.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TechnicianTaskList({ orders }: { orders: WorkOrder[] }) {
  const tasks = orders.flatMap((order) => order.repairItems.map((item) => ({ order, item })));
  return (
    <section className="panel module-panel">
      <div className="panel-header"><h2>维修项目任务</h2></div>
      <div className="compact-grid">
        {tasks.map(({ order, item }) => (
          <div className="mini-card" key={`${order.id}-${item.id}`}>
            <strong>{item.name || "未命名维修项目"}</strong>
            <span>{order.vehicle.plate} · {item.owner} · {item.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionPanel({
  order,
  role,
  onSubmitDispatch,
  onDispatch,
  technicians,
  onCompleteRepair,
  onSettle
}: {
  order?: WorkOrder;
  role: RoleKey;
  onSubmitDispatch: () => void;
  onDispatch: (technician: string) => void;
  technicians: string[];
  onCompleteRepair: () => void;
  onSettle: () => void;
}) {
  return (
    <div className="permission-card action-card">
      <div className="permission-head">
        <FileSignature size={18} />
        <strong>下一步操作</strong>
      </div>
      {!order ? <p>请先保存或选择一张委托单。</p> : null}
      {canSubmitDispatch(role, order) ? <button className="primary-button" type="button" onClick={onSubmitDispatch}>提交派工池</button> : null}
      {canDispatch(role, order) ? (
        <div className="stacked-actions">
          {technicians.length ? (
            technicians.map((name) => (
              <button className="secondary-button" type="button" key={name} onClick={() => onDispatch(name)}>
                指派给{name}
              </button>
            ))
          ) : (
            <p>暂无可派技师，请先在权限设置中维护维修技师角色。</p>
          )}
        </div>
      ) : null}
      {(canCompleteRepair(role, order) || (role === "inspector" && order?.status === "维修中")) ? (
        <button className="primary-button" type="button" onClick={onCompleteRepair}>
          {role === "inspector" ? "检验通过" : "维修完成提报"}
        </button>
      ) : null}
      {canSettle(role, order) ? <button className="primary-button" type="button" onClick={onSettle}>确认结算归档</button> : null}
      {order ? (
        <div className="locked-actions">
          {[
            ["提交派工池", canSubmitDispatch(role, order)],
            ["指派维修技师", canDispatch(role, order)],
            [role === "inspector" ? "检验通过" : "维修完成提报", canCompleteRepair(role, order) || (role === "inspector" && order.status === "维修中")],
            ["确认结算归档", canSettle(role, order)]
          ]
            .filter(([, allowed]) => !allowed)
            .map(([label]) => (
              <span key={String(label)}>
                <LockKeyhole size={13} />
                {label}
              </span>
            ))}
        </div>
      ) : null}
      {order ? <p>最近留痕：{order.auditLog[0]?.action ?? "暂无操作记录"}</p> : null}
    </div>
  );
}

function VehicleLicenseOcrControl({
  state,
  result,
  disabled,
  onScan,
  onConfirm
}: {
  state: OcrFieldState;
  result?: VehicleLicenseOcrResult;
  disabled?: boolean;
  onScan: (file: File) => Promise<void>;
  onConfirm: () => void;
}) {
  const inputId = useId();
  const resultFields = result
    ? [
        ["车牌", result.plate],
        ["VIN", result.vin],
        ["车型", result.model],
        ["车主", result.owner],
        ["住址", result.address],
        ["注册日期", normalizeOcrDate(result.registerDate) || result.registerDate]
      ].filter(([, value]) => Boolean(value))
    : [];

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await onScan(file);
  }

  return (
    <div className="ocr-strip compact-ocr vehicle-license-ocr">
      <div className="ocr-main">
        <strong>扫描行驶证</strong>
        <span>{state.source} · {state.status}{state.value ? ` · ${state.value}` : ""}</span>
        {state.error ? <em>{state.error}</em> : null}
        {resultFields.length ? (
          <div className="ocr-result-grid">
            {resultFields.map(([label, value]) => (
              <span key={label}>
                <b>{label}</b>
                {value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="button-row">
        <label className={`secondary-button file-button${disabled || state.status === "识别中" ? " disabled" : ""}`} htmlFor={inputId}>
          {state.status === "识别中" ? <Sparkles size={16} /> : <Camera size={16} />}
          拍照识别
          <input id={inputId} type="file" accept="image/*" capture="environment" disabled={disabled || state.status === "识别中"} onChange={handleFileChange} />
        </label>
        <button className="text-button" type="button" onClick={onConfirm} disabled={disabled || state.status !== "待确认"}>
          确认
        </button>
      </div>
    </div>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatVehicleLicenseSummary(result: VehicleLicenseOcrResult) {
  const items = [
    result.plate && `车牌 ${result.plate}`,
    result.vin && `VIN ${result.vin}`,
    result.owner && `车主 ${result.owner}`
  ].filter(Boolean);
  return items.join(" · ") || "已识别行驶证";
}

function normalizeOcrDate(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const compact = raw.replace(/[^\d]/g, "");
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return raw;
}

function SignaturePage({ token, onBack }: { token: string; onBack: () => void }) {
  const [order, setOrder] = useState<WorkOrder | undefined>();
  const [signature, setSignature] = useState("");
  const [message, setMessage] = useState("正在读取签字链接...");

  useEffect(() => {
    void workOrderApi.findByToken(token).then((found) => {
      setOrder(found);
      setMessage(found ? "请核对委托信息并签字确认。" : "签字链接不存在或已失效。");
      setSignature(found?.customer.name ?? "");
    });
  }, [token]);

  async function sign() {
    if (!signature.trim()) {
      setMessage("请填写签名。");
      return;
    }
    try {
      const signed = await workOrderApi.signByToken(token, signature.trim());
      setOrder(signed);
      setMessage("签字完成，委托单已进入“已委托”。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "签字失败");
    }
  }

  return (
    <main className="signature-page">
      <section className="panel signature-panel">
        <div className="panel-header">
          <div>
            <h1>机动车维修委托确认</h1>
            <p>{message}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onBack}>返回工作台</button>
        </div>
        {order ? (
          <>
            <div className="summary-grid">
              <Summary label="委托单号" value={order.id} />
              <Summary label="车牌号码" value={order.vehicle.plate} />
              <Summary label="车主" value={order.customer.name} />
              <Summary label="车型" value={order.vehicle.model || "-"} />
              <Summary label="预计费用" value={`¥${order.estimatedFee || sumLabor(order.repairItems)}`} />
              <Summary label="旧件处置" value={order.oldPartsHandling} />
            </div>
            <div className="public-items">
              {order.repairItems.map((item) => (
                <div key={item.id}>
                  <span>{item.name}</span>
                  <strong>¥{item.laborFee}</strong>
                </div>
              ))}
            </div>
            <label className="field">
              <span>电子签名</span>
              <div className="signature-pad">
                <input value={signature} onChange={(event) => setSignature(event.target.value)} disabled={order.signatureTokenUsed} />
              </div>
            </label>
            <button className="primary-button full-width" type="button" onClick={sign} disabled={order.signatureTokenUsed}>
              <FileSignature size={16} />
              {order.signatureTokenUsed ? "已签字" : "确认签字"}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Field({ label, value, suffix, disabled, onChange }: { label: string; value: string; suffix?: string; disabled?: boolean; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      <div className="input-shell">
        <input id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </div>
  );
}

function TextArea({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field textarea-field">
      <span><label htmlFor={id}>{label}</label></span>
      <textarea id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Checklist({ title, items, selected, disabled, onToggle }: { title: string; items: string[]; selected: string[]; disabled?: boolean; onToggle: (value: string) => void }) {
  return (
    <div className="checklist">
      <strong>{title}</strong>
      <div>
        {items.map((item) => (
          <label key={item}>
            <input type="checkbox" disabled={disabled} checked={selected.includes(item)} onChange={() => onToggle(item)} />
            <span>{item}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function orderToDraft(order: WorkOrder): WorkOrderDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, auditLog: _auditLog, ...draft } = order;
  return draft;
}

function buildSignatureLink(token: string) {
  return `${window.location.origin}${window.location.pathname}#/sign/${token}`;
}

function getSignTokenFromHash() {
  const match = window.location.hash.match(/^#\/sign\/(.+)$/);
  return match?.[1] ?? null;
}

function getDingTalkAuthCode() {
  const corpId = import.meta.env.VITE_DINGTALK_CORP_ID;
  const dd = window.dd;
  if (!corpId || !dd) return Promise.resolve("");

  return new Promise<string>((resolve, reject) => {
    const request = () => {
      if (dd.runtime?.permission?.requestAuthCode) {
        dd.runtime.permission.requestAuthCode({
          corpId,
          onSuccess: (result: { code?: string }) => resolve(result.code || ""),
          onFail: (error: unknown) => reject(new Error(formatDingTalkError(error)))
        });
        return;
      }

      if (dd.getAuthCode) {
        dd.getAuthCode({
          corpId,
          success: (result: { authCode?: string; code?: string }) => resolve(result.authCode || result.code || ""),
          fail: (error: unknown) => reject(new Error(formatDingTalkError(error)))
        });
        return;
      }

      resolve("");
    };

    if (dd.ready) dd.ready(request);
    else request();
    if (dd.error) dd.error((error: unknown) => reject(new Error(formatDingTalkError(error))));
  });
}

function formatDingTalkError(error: unknown) {
  if (!error) return "钉钉 JSAPI 调用失败";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "钉钉 JSAPI 调用失败";
  }
}

declare global {
  interface Window {
    dd?: {
      ready?: (callback: () => void) => void;
      error?: (callback: (error: unknown) => void) => void;
      runtime?: {
        permission?: {
          requestAuthCode?: (options: {
            corpId: string;
            onSuccess: (result: { code?: string }) => void;
            onFail: (error: unknown) => void;
          }) => void;
        };
      };
      getAuthCode?: (options: {
        corpId: string;
        success: (result: { authCode?: string; code?: string }) => void;
        fail: (error: unknown) => void;
      }) => void;
    };
  }
}
