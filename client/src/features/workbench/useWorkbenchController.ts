import { useEffect, useMemo, useState } from "react";
import {
  DashboardSummary,
  DevelopmentPersonaKey,
  RoleKey,
  UserProfile,
  WorkOrder
} from "../../../../shared/types";
import { roles, sumLabor, validateWorkOrderDraft } from "../work-orders/domain/workOrderDomain";
import { canCreateOrder } from "../work-orders/domain/permissions";
import { getDingTalkAuthCode } from "../../integrations/dingtalk/auth";
import { clearAuthToken } from "../../shared/api/httpClient";
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
  const [searchTerm, setSearchTerm] = useState("");
  const [syncLabel, setSyncLabel] = useState("钉钉组织已同步");
  const [dashboard, setDashboard] = useState<DashboardSummary>();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserProfile>();
  const [actionLoading, setActionLoading] = useState<"save" | "signature" | "sync" | "">("");
  const [devLoginLoading, setDevLoginLoading] = useState(false);

  const selectedOrder = orders.find((order) => order.id === selectedId);
  const actor = currentUser?.name || roles[role].name;
  const { ocrState, vehicleLicenseOcr, vehicleLicenseFileId, resetOcr, scanVehicleLicense, confirmVehicleLicenseOcr } =
    useVehicleLicenseOcr({ orderId: selectedOrder?.id, actor, setDraft });
  const visibleNavItems = useMemo(() => navItems.filter((item) => item.roles.includes(role)), [role]);
  const canEditForm = canCreateOrder(role) && (!selectedOrder || selectedOrder.status === "草稿");
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
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setOrders([]);
      setDashboard(undefined);
      setUsers([]);
      return;
    }
    void loadOrders(currentUser.role);
    void loadDashboard(currentUser.role);
    void workOrderApi.users().then(setUsers).catch(() => setUsers([]));
  }, [currentUser?.id]);

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
    if (/DingTalk/i.test(navigator.userAgent)) {
      try {
        const authCode = await getDingTalkAuthCode();
        const result = await workOrderApi.loginWithDingTalk(authCode);
        setCurrentUser(result.user);
        applyAuthenticatedUser(result.user);
        setSyncLabel(`钉钉组织已同步：${result.user.name}`);
        return;
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "钉钉免登失败");
        return;
      }
    }

    try {
      const user = await workOrderApi.me();
      setCurrentUser(user);
      applyAuthenticatedUser(user);
      setSyncLabel(`已登录：${user.name}`);
      return;
    } catch {
      // No local session yet. In plain browser development we keep the role switcher.
    }

    // 普通浏览器没有钉钉 JSAPI，保留未登录的本地开发体验。
  }

  function applyAuthenticatedUser(user: UserProfile) {
    const nextRole = user.role === "manager" ? "manager" : "advisor";
    setRole(nextRole);
    setActiveNav(user.homeRoute === "order-create" ? "委托开单" : "工作台");
  }

  async function loginForDevelopment(persona: DevelopmentPersonaKey) {
    clearAuthToken();
    setCurrentUser(undefined);
    setOrders([]);
    setSelectedId(null);
    setDashboard(undefined);
    setApiError("");
    setDevLoginLoading(true);
    try {
      const result = await workOrderApi.loginForDevelopment(persona);
      setCurrentUser(result.user);
      applyAuthenticatedUser(result.user);
      setSyncLabel(`测试身份：${result.user.name}`);
    } catch (error) {
      setSyncLabel("测试身份未登录");
      setApiError(error instanceof Error ? error.message : "测试身份登录失败");
    } finally {
      setDevLoginLoading(false);
    }
  }

  function selectOrder(order: WorkOrder) {
    setSelectedId(order.id);
    resetDraft(order);
    setFormErrors([]);
    resetOcr(order.ocrRecords);
  }

  function startNewOrder() {
    setSelectedId(null);
    resetDraft();
    setFormErrors([]);
    resetOcr();
  }

  async function saveDraft() {
    if (!canCreateOrder(role)) {
      setFormErrors(["当前角色不能创建或编辑委托单"]);
      return;
    }

    setActionLoading("save");
    setFormErrors([]);
    try {
      if (selectedOrder) {
        const updated = await workOrderApi.update({ ...selectedOrder, ...draft }, actor, "保存委托单");
        await loadOrders(role, updated.id);
        return;
      }

      const created = await workOrderApi.create(draft, actor);
      if (vehicleLicenseFileId) await workOrderApi.attachFile(vehicleLicenseFileId, created.id);
      await loadOrders(role, created.id);
    } catch (error) {
      setFormErrors([actionError(error, "保存草稿失败")]);
    } finally {
      setActionLoading("");
    }
  }

  async function sendSignature() {
    const errors = validateBeforeSignature();
    if (errors.length) {
      setFormErrors(errors);
      return;
    }

    setActionLoading("signature");
    setFormErrors([]);
    try {
      const order = selectedOrder ?? (await workOrderApi.create(draft, actor));
      if (!selectedOrder && vehicleLicenseFileId) await workOrderApi.attachFile(vehicleLicenseFileId, order.id);
      if (selectedOrder) await workOrderApi.update({ ...selectedOrder, ...draft }, actor, "保存签字前委托单");
      const withToken = await workOrderApi.createSignatureToken(order.id, actor);
      await loadOrders(role, withToken.id);
      return { token: withToken.signatureToken!, order: withToken };
    } catch (error) {
      setFormErrors([actionError(error, "发起签字失败")]);
      return undefined;
    } finally {
      setActionLoading("");
    }
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
    setActionLoading("sync");
    setFormErrors([]);
    try {
      const updated = await workOrderApi.syncPlatform(selectedOrder.id, actor);
      await loadOrders(role, updated.id);
      await loadDashboard(role);
    } catch (error) {
      setFormErrors([actionError(error, "同步维修平台失败")]);
    } finally {
      setActionLoading("");
    }
  }

  async function completeSignature(order: WorkOrder, token: string, signatureImage: string) {
    const signatureFile = await workOrderApi.uploadFile({
      orderId: order.id,
      kind: "signature_image",
      fileName: `signature-${order.id}.png`,
      mimeType: "image/png",
      imageBase64: signatureImage
    });
    const signed = await workOrderApi.signByToken(token, order.customer.name || "客户签名", signatureFile.id);
    await loadOrders(role, signed.id);
    return signed;
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
    if (ocrState.vehicleLicense.status === "未识别") errors.push("请拍照识别并确认行驶证");
    if (ocrState.vehicleLicense.status === "识别中") errors.push("行驶证正在识别，请稍候");
    if (ocrState.vehicleLicense.status === "待确认") errors.push("请确认行驶证 OCR 结果");
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
    searchTerm,
    setSearchTerm,
    syncLabel,
    vehicleLicenseOcr,
    dashboard,
    users,
    currentUser,
    actionLoading,
    devLoginLoading,
    selectedOrder,
    actor,
    visibleNavItems,
    canEditForm,
    totalLabor,
    technicianOptions,
    inspectorOptions,
    searchedOrders,
    counters,
    loginForDevelopment,
    selectOrder,
    startNewOrder,
    saveDraft,
    sendSignature,
    completeSignature,
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

function actionError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
