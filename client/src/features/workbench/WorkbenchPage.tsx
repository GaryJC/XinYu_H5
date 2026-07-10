import { ClipboardCheck, LockKeyhole, Menu, RefreshCcw, UserRound } from "lucide-react";
import { RoleKey } from "../../../../shared/types";
import { MetricCard } from "../../shared/ui/Status";
import { roles } from "../work-orders/domain/workOrderDomain";
import { ModulePanel } from "./ModulePanel";
import { OrdersArchive } from "./OrdersArchive";
import { useWorkbenchController } from "./useWorkbenchController";
import { WorkOrderEditor } from "../work-orders/components/WorkOrderEditor";
import { WorkflowSidebar } from "../work-orders/components/WorkflowSidebar";
import { roleFocus } from "./workbenchConfig";

export function WorkbenchPage() {
  const controller = useWorkbenchController();
  const {
    activeNav, setActiveNav, role, setRole, orders, selectedOrder, syncLabel,
    currentUser, visibleNavItems, counters, apiError, dashboard, users
  } = controller;

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
          <WorkOrderEditor controller={controller} />
          <WorkflowSidebar controller={controller} />
        </section>

        <ModulePanel activeNav={activeNav} orders={orders} dashboard={dashboard} users={users} />

        <OrdersArchive controller={controller} />
      </main>
    </div>
  );
}
