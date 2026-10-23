import { userRoles } from "../../../../shared/roles.mjs";
import { hasRole, hasAnyRole } from "../../../../shared/roles.mjs";
import { EmployeeBindingGate } from "../employee-binding/EmployeeBindingGate";
import { workOrderDisplayStatus } from "../work-orders/domain/workOrderDomain";
import { lazy, Suspense, useState } from "react";
import { ArrowUp, ClipboardCheck, LockKeyhole, Menu, RefreshCcw, UserRound } from "lucide-react";
import { Alert, Button, Drawer, FloatButton, Grid, Layout, Select, Space } from "antd";
import { DevelopmentPersonaKey } from "../../../../shared/types";
import { MetricCard } from "../../shared/ui/Status";
import { roles } from "../work-orders/domain/workOrderDomain";
import { OrdersArchive } from "./OrdersArchive";
import { roleFocus } from "./workbenchConfig";
import { dispatchEnabled, isDispatchNavigation } from "../dispatch/dispatchAvailability";
import { useWorkbenchController } from "./useWorkbenchController";

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
    activeNav, setActiveNav, role, orders, selectedOrder, syncLabel,
    currentUser, visibleNavItems, counters, apiError, dashboard, users,
    devLoginLoading, loginForDevelopment
  } = controller;

  if (currentUser && hasRole(currentUser, 'technician') && !currentUser.legacyEmployeeCode) {
    return <EmployeeBindingGate key={currentUser.id} user={currentUser} onBound={controller.setCurrentUser} />;
  }

  const navigation = (
    <div className="navigation-shell">
      <div className="brand">
        <div className="brand-mark"><ClipboardCheck size={20} /></div>
        <div><strong>修理委托</strong><span>钉钉自建 H5</span></div>
      </div>
      <nav className="nav-list" aria-label="主导航">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              type={activeNav === item.label ? "primary" : "text"}
              className="nav-item"
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
    <Layout className={`app-shell${isMobile ? " has-mobile-bottom-nav" : ""}`}>
      {!isMobile ? <Layout.Sider className="sidebar" width={224}>{navigation}</Layout.Sider> : null}
      <Drawer className="mobile-drawer" placement="left" size={280} open={menuOpen} onClose={() => setMenuOpen(false)} styles={{ body: { padding: 16 } }}>
        {navigation}
      </Drawer>

      <Layout.Content className="main">
        <header className="topbar">
          <div className="topbar-title">
            <div>
              <h1>{isMobile ? "修理委托工作台" : "机动车修理委托书数字化工作台"}</h1>
              <p>{isDispatchNavigation(activeNav)?`抚顺路店 · ${activeNav}`:<>{orders.length} 张委托单 · 抚顺路店 · {selectedOrder ? workOrderDisplayStatus(selectedOrder) : "新建草稿"}</>}</p>
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
                  { value: "unassigned", label: "未分配角色员工" },
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

        {apiError ? <Alert className="error-box" type="warning" showIcon title="无法完成登录或加载数据" description={apiError} /> : null}

        {!dispatchEnabled && ["technician", "inspector", "warehouse"].includes(role) ? <Alert type="info" showIcon title="维修与检验功能暂未开放" /> : null}

        {activeNav === "工作台" && (dispatchEnabled || !["technician", "inspector", "warehouse"].includes(role)) ? (
          <>
            <div className="all-todos-label">全部待办</div>
            <section className="metric-grid" aria-label="全部待办统计">
              {counters.map((counter) => <MetricCard key={counter.label} label={counter.label} value={counter.value} />)}
            </section>
            <section className="role-focus-strip">
              <div><strong>{roleFocus[role].title}</strong><span>{roleFocus[role].dataScope}</span></div>
              <p>{roleFocus[role].primary}</p>
              <div>{roleFocus[role].blocked.map((item) => <span key={item}>{item}</span>)}</div>
            </section>
            <OrdersArchive controller={controller} />
          </>
        ) : null}

        {activeNav === "委托开单" ? (
          <Suspense fallback={<div role="status">正在加载委托开单…</div>}>
            <WorkOrderEditor controller={controller} />
          </Suspense>
        ) : null}

        {dispatchEnabled && currentUser && isDispatchNavigation(activeNav) ? (
          <Suspense fallback={<div role="status">正在加载派工模块…</div>}>
            <DispatchPage key={`${currentUser.id}-${activeNav}`} user={currentUser} view={activeNav}/>
          </Suspense>
        ) : null}

        {activeNav === "配件竞价" && currentUser && hasAnyRole(currentUser, ["manager","warehouse"]) ? (
          <Suspense fallback={<div role="status">正在加载配件竞价…</div>}><ProcurementPage key={currentUser.id} user={currentUser}/></Suspense>
        ) : null}

        {activeNav === "数据看板" || activeNav === "权限设置" ? (
          <Suspense fallback={<div role="status">正在加载功能模块…</div>}>
            <ModulePanel activeNav={activeNav} orders={orders} dashboard={dashboard} users={users} />
          </Suspense>
        ) : null}
      </Layout.Content>
      <FloatButton.BackTop className="workbench-back-top" style={{ bottom: isMobile ? `calc(var(--mobile-bottom-nav-height, 0px) + ${activeNav === "委托开单" ? 116 : 20}px)` : 48, right: isMobile ? 16 : 24, zIndex: 101 }} aria-label="回到顶部" tooltip="回到顶部" icon={<ArrowUp size={20} />} visibilityHeight={300} duration={300} />
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
