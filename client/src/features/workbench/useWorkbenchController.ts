import { useEffect, useMemo, useRef, useState } from "react";
import {
  DashboardSummary,
  DevelopmentPersonaKey,
  LegacyDepartment,
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
import { createWorkOrderWorkflowActions } from "../work-orders/hooks/createWorkOrderWorkflowActions";
import { useVehicleLicenseOcr } from "../vehicle-license-ocr/useVehicleLicenseOcr";
import { useVehicleIdentityRecognition } from "../vehicle-identity/useVehicleIdentityRecognition";
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
  const [departments, setDepartments] = useState<LegacyDepartment[]>([]);
  const [departmentError, setDepartmentError] = useState("");
  const [actionLoading, setActionLoading] = useState<"save" | "signature" | "sync" | "delete" | "">("");
  const [devLoginLoading, setDevLoginLoading] = useState(false);
  const sessionGeneration = useRef(0);

  const selectedOrder = orders.find((order) => order.id === selectedId);
  const actor = currentUser?.name || roles[role].name;
  const {
    identifierRecognition,
    vehicleHistory,
    vehicleHistoryLoading,
    vehicleHistoryError,
    resetVehicleIdentityRecognition,
    scanVehicleIdentifier,
    lookupVehicleIdentifier,
    lookupVehicleLicense,
    lookupVehicleLicenseForDevelopment,
    selectVehicleReference
  } = useVehicleIdentityRecognition({ setDraft });
  const { ocrState, vehicleLicenseOcr, vehicleLicenseFileId, resetOcr, scanVehicleLicense, confirmVehicleLicenseOcr } =
    useVehicleLicenseOcr({ orderId: selectedOrder?.id, actor, setDraft, onRecognized: lookupVehicleLicense });
  const visibleNavItems = useMemo(() => navItems.filter((item) => item.roles.includes(role)), [role]);
  const canEditForm = canCreateOrder(role) && (
    !selectedOrder || (
      selectedOrder.status === "草稿"
      && (role === "manager" || selectedOrder.advisor === currentUser?.name)
    )
  );
  const totalLabor = useMemo(() => sumLabor(draft.repairItems), [draft.repairItems]);
  const technicianOptions = useMemo(() => users.filter((user) => user.active && user.role === "technician").map((user) => user.name), [users]);
  const inspectorOptions = useMemo(() => users.filter((user) => user.active && user.role === "inspector").map((user) => user.name), [users]);

  const searchedOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) =>
      [order.id, order.vehicle.plate, order.vehicle.vin, order.vehicle.model, order.customer.name].some((value) =>
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
    const generation = ++sessionGeneration.current;
    if (!currentUser) {
      setOrders([]);
      setDashboard(undefined);
      setUsers([]);
      setDepartments([]);
      setDepartmentError("");
      return;
    }
    void loadOrders(currentUser.role, selectedId, generation);
    void loadDashboard(currentUser.role, generation);
    void loadUsers(generation);
    void loadDepartments(generation);
    return () => {
      if (sessionGeneration.current === generation) sessionGeneration.current += 1;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!visibleNavItems.some((item) => item.label === activeNav)) {
      setActiveNav("工作台");
    }
  }, [activeNav, visibleNavItems]);

  async function loadOrders(nextRole = role, keepId = selectedId, generation = sessionGeneration.current) {
    try {
      setApiError("");
      const next = await workOrderApi.list(nextRole);
      if (generation !== sessionGeneration.current) return;
      const safeNext = Array.isArray(next) ? next : [];
      setOrders(safeNext);
      const nextSelected = safeNext.find((order) => order.id === keepId)
        ?? (nextRole === "advisor"
          ? safeNext.find((order) => order.advisor === currentUser?.name)
          : safeNext[0]);
      if (nextSelected) {
        selectOrder(nextSelected);
      } else {
        setSelectedId(null);
        resetDraft(undefined, currentUser?.name || "");
      }
    } catch (error) {
      if (generation !== sessionGeneration.current) return;
      setOrders([]);
      setSelectedId(null);
      resetDraft(undefined, currentUser?.name || "");
      setApiError(error instanceof Error ? error.message : "后端 API 暂时不可用");
    }
  }

  async function loadDashboard(nextRole = role, generation = sessionGeneration.current) {
    try {
      const next = await workOrderApi.dashboard(nextRole);
      if (generation === sessionGeneration.current) setDashboard(next);
    } catch {
      if (generation === sessionGeneration.current) setDashboard(undefined);
    }
  }

  async function loadUsers(generation = sessionGeneration.current) {
    try {
      const next = await workOrderApi.users();
      if (generation === sessionGeneration.current) setUsers(next);
    } catch {
      if (generation === sessionGeneration.current) setUsers([]);
    }
  }

  async function loadDepartments(generation = sessionGeneration.current) {
    try {
      setDepartmentError("");
      const next = await workOrderApi.departments();
      if (generation !== sessionGeneration.current) return;
      setDepartments(next);
      const defaultDepartment = next.find((item) => item.isDefault) || next[0];
      if (defaultDepartment) {
        setDraft((current) =>
          current.department?.code
            ? current
            : {
                ...current,
                department: {
                  code: defaultDepartment.code,
                  name: defaultDepartment.name
                }
              }
        );
      }
    } catch (error) {
      if (generation !== sessionGeneration.current) return;
      setDepartments([]);
      setDepartmentError(actionError(error, "部门加载失败"));
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
    setDraft((current) => ({ ...current, advisor: user.name }));
  }

  async function loginForDevelopment(persona: DevelopmentPersonaKey) {
    sessionGeneration.current += 1;
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
    resetVehicleIdentityRecognition();
  }

  function startNewOrder() {
    setSelectedId(null);
    resetDraft(undefined, currentUser?.name || "");
    setFormErrors([]);
    resetOcr();
    resetVehicleIdentityRecognition();
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

  async function deleteDraft(order: WorkOrder) {
    if (order.status !== "草稿") return "只能删除草稿";
    if (role !== "manager" && order.advisor !== currentUser?.name) return "只能删除自己创建的草稿";
    setActionLoading("delete");
    try {
      await workOrderApi.deleteDraft(order.id);
      setSelectedId(null);
      resetDraft(undefined, currentUser?.name || "");
      await loadOrders(role, null);
      await loadDashboard(role);
      return undefined;
    } catch (error) {
      return actionError(error, "删除草稿失败");
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

  function validateBeforeSignature() {
    const errors = validateWorkOrderDraft(draft);
    if (!draft.vehicle.modelLegacyCode.trim()) {
      errors.push("车型尚未确认，请从搜索结果中选择，或新增车型并确认编码");
    }
    if (!draft.customer.legacyCode.trim()) {
      errors.push("所属单位尚未确认，请从搜索结果中选择，或新增所属单位并确认编码");
    }
    const hasVehicleLicense = Boolean(
      vehicleLicenseFileId || selectedOrder?.files?.some((file) => file.kind === "vehicle_license")
    );
    if (vehicleHistory?.status === "new" && !hasVehicleLicense) {
      errors.push("公司系统中未找到该车辆，新车必须上传行驶证照片");
    }
    return errors;
  }

  const workflowActions = createWorkOrderWorkflowActions({
    selectedOrder,
    draft,
    role,
    actor,
    totalLabor,
    setFormErrors,
    setActionLoading,
    loadOrders,
    loadDashboard
  });

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
    vehicleLicenseFileId,
    identifierRecognition,
    vehicleHistory,
    vehicleHistoryLoading,
    vehicleHistoryError,
    dashboard,
    users,
    currentUser,
    departments,
    departmentError,
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
    deleteDraft,
    sendSignature,
    ...workflowActions,
    scanVehicleLicense,
    confirmVehicleLicenseOcr,
    scanVehicleIdentifier,
    lookupVehicleIdentifier,
    lookupVehicleLicenseForDevelopment,
    selectVehicleReference,
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
