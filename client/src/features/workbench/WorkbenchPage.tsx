import { useState } from "react";
import { ClipboardCheck, LockKeyhole, Menu, RefreshCcw, UserRound } from "lucide-react";
import { Alert, Button, Drawer, Grid, Layout, Select, Space } from "antd";
import { RoleKey } from "../../../../shared/types";
import { MetricCard } from "../../shared/ui/Status";
import { roles } from "../work-orders/domain/workOrderDomain";
import { WorkOrderEditor } from "../work-orders/components/WorkOrderEditor";
import { ModulePanel } from "./ModulePanel";
import { OrdersArchive } from "./OrdersArchive";
import { roleFocus } from "./workbenchConfig";
import { useWorkbenchController } from "./useWorkbenchController";

const mvpRoles: RoleKey[] = ["advisor", "manager"];

export function WorkbenchPage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [menuOpen, setMenuOpen] = useState(false);
  const controller = useWorkbenchController();
  const {
    activeNav, setActiveNav, role, setRole, orders, selectedOrder, syncLabel,
    currentUser, visibleNavItems, counters, apiError, dashboard, users
  } = controller;

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
      <div className="sidebar-note"><LockKeyhole size={16} /><p>MVP1 仅开放服务顾问与门店管理员功能。</p></div>
    </div>
  );

  return (
    <Layout className="app-shell">
      {!isMobile ? <Layout.Sider className="sidebar" width={224}>{navigation}</Layout.Sider> : null}
      <Drawer className="mobile-drawer" placement="left" width={280} open={menuOpen} onClose={() => setMenuOpen(false)} styles={{ body: { padding: 16 } }}>
        {navigation}
      </Drawer>

      <Layout.Content className="main">
        <header className="topbar">
          <div className="topbar-title">
            {isMobile ? <Button aria-label="打开菜单" icon={<Menu size={19} />} onClick={() => setMenuOpen(true)} /> : null}
            <div>
              <h1>{isMobile ? "修理委托工作台" : "机动车修理委托书数字化工作台"}</h1>
              <p>{orders.length} 张委托单 · 抚顺路店 · {selectedOrder?.status ?? "新建草稿"}</p>
            </div>
          </div>
          <div className="topbar-actions">
            {!isMobile ? <div className="sync-state"><RefreshCcw size={15} /><span>{syncLabel}</span></div> : null}
            <Space className="role-switcher">
              <UserRound size={16} />
              <Select
                value={role}
                disabled={Boolean(currentUser)}
                onChange={(value) => setRole(value as RoleKey)}
                options={mvpRoles.map((key) => ({ value: key, label: roles[key].name }))}
              />
            </Space>
          </div>
        </header>

        {apiError ? <Alert className="error-box" type="warning" showIcon message={`后端连接异常：${apiError}`} description="请确认 npm run dev 已同时启动 API server 和 Vite。" /> : null}

        {activeNav === "工作台" ? (
          <>
            <section className="metric-grid" aria-label="待办统计">
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

        {activeNav === "委托开单" ? <WorkOrderEditor controller={controller} /> : null}

        <ModulePanel activeNav={activeNav} orders={orders} dashboard={dashboard} users={users} />
      </Layout.Content>
    </Layout>
  );
}
