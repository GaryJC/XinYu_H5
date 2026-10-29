import { LoadingState } from "../../shared/ui/LoadingState";
import { userRoles } from "../../../../shared/roles.mjs";
import { hasRole, hasAnyRole } from "../../../../shared/roles.mjs";
import { EmployeeBindingGate } from "../employee-binding/EmployeeBindingGate";
import { lazy, Suspense, useState } from "react";
import { ArrowUp, ClipboardCheck, LockKeyhole, Menu, RefreshCcw, UserRound } from "lucide-react";
import { Alert, Button, Drawer, FloatButton, Grid, Layout, Select, Space } from "antd";
import { DevelopmentPersonaKey } from "../../../../shared/types";
import "./workbench.css";
import { roles } from "../work-orders/domain/workOrderDomain";
import { OrdersArchive } from "./OrdersArchive";
import { roleFocus } from "./workbenchConfig";
import { dispatchEnabled, isDispatchNavigation } from "../dispatch/dispatchAvailability";
import { useWorkbenchController } from "./useWorkbenchController";

const VehicleTripsPage = lazy(() => import('../vehicle-trips/VehicleTripsPage').then(m => ({ default: m.VehicleTripsPage })));
const CompanyVehiclesPage = lazy(() => import('../company-vehicles/CompanyVehiclesPage').then(m => ({ default: m.CompanyVehiclesPage })));

const ProcurementPage = lazy(() => import("../procurement/ProcurementPage").then(module => ({ default: module.ProcurementPage })));

const DispatchPage = lazy(() => import("../dispatch/DispatchPage").then(module => ({ default: module.DispatchPage })));

const WorkOrderEditor = lazy(() =>
  import("../work-orders/components/WorkOrderEditor").then((module) => ({ default: module.WorkOrderEditor }))
);
const ModulePanel = lazy(() =>
  import("./ModulePanel").then((module) => ({ default: module.ModulePanel }))
);

export function WorkbenchPage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const isDevelopmentAuth = import.meta.env.DEV && !/DingTalk/i.test(navigator.userAgent);
  const [menuOpen, setMenuOpen] = useState(false);
  const [devPersona, setDevPersona] = useState<DevelopmentPersonaKey>();
  const controller = useWorkbenchController();
  const {
    activeNav, setActiveNav, role, orders, syncLabel,
    currentUser, visibleNavItems, counters, apiError, dashboard, users,
    devLoginLoading, loginForDevelopment
  } = controller;

  const bindingRequired = currentUser && hasRole(currentUser, 'technician') && !currentUser.legacyEmployeeCode && !['出车申请', '车辆管理'].includes(activeNav);

  const navigation = (
    <div className="navigation-shell">
      <div className="brand">
        <div className="brand-mark"><ClipboardCheck size={20} /></div>
        <div><strong>修理委托</strong><span>门店协同工作台</span></div>
      </div>
      <nav className="nav-list" aria-label="主导航">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              type={activeNav === item.label ? "primary" : "text"}
              className="nav-item"
              aria-current={activeNav === item.label ? "page" : undefined}
              key={item.label}
              onClick={() => {
                setActiveNav(item.label);
                setMenuOpen(false);
              }}
            >
              <Icon size={18} /><span>{item.label}</span>
            </Button>
          );
        })}
      </nav>
      <div className="sidebar-note"><LockKeyhole size={16} /><p>按门店与岗位权限使用委托开单、签字与归档功能。</p></div>
    </div>
  );

  return (
    <Layout className={`app-shell workbench-shell${isMobile ? " has-mobile-bottom-nav" : ""}`}>
      {!isMobile ? <Layout.Sider className="sidebar" width={224}>{navigation}</Layout.Sider> : null}
      <Drawer className="mobile-drawer" placement="left" size={280} open={menuOpen} onClose={() => setMenuOpen(false)} styles={{ body: { padding: 16 } }}>
        {navigation}
      </Drawer>

      <Layout.Content className="main">
        <header className="topbar">
          <div className="topbar-title">
            <div>
              <span className="workbench-breadcrumb">门店工作空间</span>
              <h1>{activeNav}</h1>
              <p>{currentUser?.name ? `${currentUser.name} · ` : ''}{currentUser ? userRoles(currentUser).map(item => roles[item].name).join(' / ') : '请先登录'}{activeNav === '工作台' ? ` · ${orders.length} 张委托单` : ''}</p>
            </div>
          </div>
          <div className="topbar-actions">
            {!isMobile ? <div className="sync-state"><RefreshCcw size={15} /><span>{syncLabel}</span></div> : null}
            {isDevelopmentAuth ? (
              <Select
                className="dev-persona-switcher"
                aria-label="切换本地测试身份"
                placeholder="选择测试身份"
                loading={devLoginLoading}
                value={devPersona}
                onChange={(value: DevelopmentPersonaKey) => {
                  setDevPersona(value);
                  void loginForDevelopment(value).finally(() => setDevPersona(undefined));
                }}
                options={[
                  { value: "advisor", label: "张三｜服务顾问" },
                  { value: "manager", label: "Gary｜门店管理员" },
                  ...(dispatchEnabled ? [
                    { value: "warehouse", label: "仓管｜测试" },
                    { value: "technician", label: "李富强｜维修工（测试）" },
                    { value: "inspector", label: "检验员｜测试" }
                  ] : []),
                  { value: "employee", label: "普通员工｜出车申请" },
                  { value: "unassigned", label: "未分配岗位员工｜出车申请" },
                  { value: "disabled", label: "已停用员工" }
                ]}
              />
            ) : null}
            <Space className="role-switcher">
              <UserRound size={16} />
              <span>{currentUser ? userRoles(currentUser).map(role=>roles[role].name).join(" · ") : "未登录"}</span>
            </Space>
          </div>
        </header>

        {bindingRequired && <EmployeeBindingGate key={currentUser.id} user={currentUser} onBound={controller.setCurrentUser} onDefer={() => setActiveNav('出车申请')} />}
        {activeNav === '出车申请' && currentUser && <Suspense fallback={<LoadingState label="正在加载出车申请…" />}><VehicleTripsPage key={currentUser.id} user={currentUser} /></Suspense>}
        {activeNav === '车辆管理' && currentUser && hasRole(currentUser, 'manager') && <Suspense fallback={<LoadingState label="正在加载车辆管理…" />}><CompanyVehiclesPage key={currentUser.id} /></Suspense>}

        {apiError ? <Alert className="error-box" type="warning" showIcon title="无法完成登录或加载数据" description={apiError} /> : null}

        {!dispatchEnabled && ["technician", "inspector", "warehouse"].includes(role) ? <Alert type="info" showIcon title="维修与检验功能暂未开放" /> : null}

        {!bindingRequired && activeNav === "工作台" && (dispatchEnabled || !["technician", "inspector", "warehouse"].includes(role)) ? (
          <>
            <div className="workbench-section-heading"><h2>待办概览</h2><span>当前可见委托单</span></div>
            <section className="workbench-metrics" aria-label="全部待办统计">
              {counters.map((counter, index) => <div className={`workbench-metric metric-tone-${index}`} key={counter.label}>
                <span className="workbench-metric-label"><i aria-hidden="true" />{counter.label}</span><strong>{counter.value}<small>单</small></strong>
              </div>)}
            </section>
            <section className="workbench-shortcuts" aria-label="快捷入口">
              <div className="workbench-section-heading"><h2>快捷入口</h2><span>常用业务</span></div>
              <div className="workbench-shortcut-grid">{visibleNavItems.filter(item => !['工作台', '车辆管理', '数据看板', '权限设置', '配件竞价', '工单全览'].includes(item.label)).map(item => {
                const Icon = item.icon;
                return <button type="button" key={item.label} onClick={() => setActiveNav(item.label)}><span><Icon size={21} /></span>{item.label}</button>;
              })}</div>
            </section>
            <section className="role-focus-strip">
              <div><strong>{roleFocus[role].title}</strong><span>{roleFocus[role].dataScope}</span></div>
              <p>{roleFocus[role].primary}</p>
              <div>{roleFocus[role].blocked.map((item) => <span key={item}>{item}</span>)}</div>
            </section>
            <OrdersArchive controller={controller} />
          </>
        ) : null}

        {!bindingRequired && activeNav === "工单全览" && currentUser && hasAnyRole(currentUser, ["advisor", "manager"]) ? <OrdersArchive key={currentUser.id} controller={controller} overview/> : null}

        {!bindingRequired && activeNav === "委托开单" ? (
          <Suspense fallback={<LoadingState label="正在加载委托开单…" />}>
            <WorkOrderEditor controller={controller} />
          </Suspense>
        ) : null}

        {!bindingRequired && dispatchEnabled && currentUser && isDispatchNavigation(activeNav) ? (
          <Suspense fallback={<LoadingState label="正在加载派工模块…" />}>
            <DispatchPage key={`${currentUser.id}-${activeNav}`} user={currentUser} view={activeNav}/>
          </Suspense>
        ) : null}

        {!bindingRequired && activeNav === "配件竞价" && currentUser && hasAnyRole(currentUser, ["manager","warehouse"]) ? (
          <Suspense fallback={<LoadingState label="正在加载配件竞价…" />}><ProcurementPage key={currentUser.id} user={currentUser}/></Suspense>
        ) : null}

        {!bindingRequired && (activeNav === "数据看板" || activeNav === "权限设置") ? (
          <Suspense fallback={<LoadingState label="正在加载功能模块…" />}>
            <ModulePanel activeNav={activeNav} orders={orders} dashboard={dashboard} users={users} />
          </Suspense>
        ) : null}
      </Layout.Content>
      <FloatButton.BackTop className="workbench-back-top" style={{ bottom: isMobile ? `calc(var(--mobile-bottom-nav-height, 0px) + ${!bindingRequired && activeNav === "委托开单" ? 116 : 20}px)` : 48, right: isMobile ? 16 : 24, zIndex: 101 }} aria-label="回到顶部" tooltip={isMobile ? undefined : "回到顶部"} icon={<ArrowUp size={20} />} visibilityHeight={300} duration={isMobile ? 1 : 300}
        target={getWindowScrollTarget}
        onPointerDown={() => {
          // Dismiss the keyboard before BackTop starts scrolling, so focus does not pull the viewport back.
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && (focused.matches('input, textarea') || focused.isContentEditable)) focused.blur();
        }} />
      {isMobile && <nav className="mobile-bottom-nav" aria-label="底部主导航">
        {visibleNavItems.slice(0, 3).map(item => {
          const Icon = item.icon;
          return <button type="button" key={item.label} aria-current={activeNav === item.label ? 'page' : undefined} onClick={() => { setActiveNav(item.label); setMenuOpen(false); }}><Icon size={20} /><span>{item.label}</span></button>;
        })}
        <button type="button" aria-label="打开菜单" aria-expanded={menuOpen} aria-current={!visibleNavItems.slice(0, 3).some(item => item.label === activeNav) ? 'page' : undefined} onClick={() => setMenuOpen(true)}><Menu size={20} /><span>更多</span></button>
      </nav>}

    </Layout>
  );
}

function getWindowScrollTarget() { return window; }
