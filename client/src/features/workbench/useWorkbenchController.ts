import { useEffect, useMemo, useState } from "react";
import { DashboardSummary, RoleKey, UserProfile, WorkOrder } from "../../../../shared/types";
import { signatureNotificationAdapter } from "../signature/notificationAdapter";
import { roles, sumLabor, validateWorkOrderDraft } from "../work-orders/domain/workOrderDomain";
import { canCreateOrder } from "../work-orders/domain/permissions";
import { getDingTalkAuthCode } from "../../integrations/dingtalk/auth";
import { dingTalkOrganizationAdapter } from "../../integrations/dingtalk/organizationAdapter";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { useWorkOrderDraft } from "../work-orders/hooks/useWorkOrderDraft";
import { useVehicleLicenseOcr } from "../vehicle-license-ocr/useVehicleLicenseOcr";
import { navItems } from "./workbenchConfig";

export function useWorkbenchController() {
  const [activeNav, setActiveNav] = useState("工作台");
  const [role, setRole] = useState<RoleKey>("advisor");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { draft, setDraft, resetDraft, updateDraft, updateVehicle, updateCustomer, updateRepairItem, toggleArrayField } = useWorkOrderDraft();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState("");
  const [signatureLink, setSignatureLink] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [syncLabel, setSyncLabel] = useState("钉钉组织已同步");
  const [dashboard, setDashboard] = useState<DashboardSummary>();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile>();

  const selectedOrder = orders.find((order) => order.id === selectedId);
  const actor = currentUser?.name || roles[role].name;
  const { ocrState, vehicleLicenseOcr, resetOcr, scanVehicleLicense, confirmVehicleLicenseOcr } =
    useVehicleLicenseOcr({ orderId: selectedOrder?.id, actor, setDraft });
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
    void dingTalkOrganizationAdapter.syncOrganization().then((result) => setSyncLabel(`钉钉组织已同步 ${result.users} 人`));
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
        resetDraft();
      }
    } catch (error) {
      setOrders([]);
      setSelectedId(null);
      resetDraft();
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
    resetDraft(order);
    setFormErrors([]);
    setSignatureLink(order.signatureToken ? buildSignatureLink(order.signatureToken) : "");
    resetOcr();
  }

  function startNewOrder() {
    setSelectedId(null);
    resetDraft();
    setSignatureLink("");
    setFormErrors([]);
    resetOcr();
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
    await signatureNotificationAdapter.sendSignatureTodo(withToken);
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

  return {
    activeNav,
    setActiveNav,
    role,
    setRole,
    orders,
    selectedId,
    draft,
    setDraft,
    ocrState,
    formErrors,
    apiError,
    signatureLink,
    searchTerm,
    setSearchTerm,
    syncLabel,
    vehicleLicenseOcr,
    dashboard,
    users,
    currentUser,
    selectedOrder,
    actor,
    visibleNavItems,
    canEditForm,
    totalLabor,
    technicianOptions,
    inspectorOptions,
    searchedOrders,
    counters,
    selectOrder,
    startNewOrder,
    saveDraft,
    sendSignature,
    submitDispatch,
    dispatchToTechnician,
    completeRepair,
    settleOrder,
    scanVehicleLicense,
    confirmVehicleLicenseOcr,
    syncPlatform,
    updateRepairAction,
    createSettlement,
    updateDraft,
    updateVehicle,
    updateCustomer,
    updateRepairItem,
    toggleArrayField
  };
}

export type WorkbenchController = ReturnType<typeof useWorkbenchController>;

function buildSignatureLink(token: string) {
  return `${window.location.origin}${window.location.pathname}#/sign/${token}`;
}
