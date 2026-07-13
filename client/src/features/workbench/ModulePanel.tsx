import { DashboardSummary, UserProfile, WorkOrder } from "../../../../shared/types";
import { Card, Tag } from "antd";
import { roles } from "../work-orders/domain/workOrderDomain";

export function ModulePanel({
  activeNav,
  orders,
  dashboard,
  users
}: {
  activeNav: string;
  orders: WorkOrder[];
  dashboard?: DashboardSummary;
  users: UserProfile[];
}) {
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
    <Card className="panel module-panel">
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
    </Card>
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
    <Card className="panel module-panel">
      <div className="panel-header">
        <div>
          <h2>权限设置</h2>
          <p>员工权限按照钉钉角色名称自动同步，无需在 H5 中逐个配置。</p>
        </div>
      </div>
      <div className="dingtalk-mapping-panel" aria-label="钉钉自动映射规则">
        <div className="mapping-intro">
          <strong>自动映射规则</strong>
          <span>钉钉角色名称必须完全一致；当前 MVP1 的员工默认归属抚顺路店。</span>
        </div>
        <div className="mapping-list">
          <Tag color="blue">服务顾问 → 服务顾问权限 → 委托开单</Tag>
          <Tag color="purple">门店管理员 → 管理员权限 → 工作台</Tag>
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
    </Card>
  );
}

function SettlementList({ orders }: { orders: WorkOrder[] }) {
  return (
    <Card className="panel module-panel">
      <div className="panel-header"><h2>结算清单匹配</h2></div>
      <div className="compact-grid">
        {orders.flatMap((order) => order.settlementStatements).map((item) => (
          <div className="mini-card" key={item.id}>
            <strong>{item.dispatchNo} · {item.plate}</strong>
            <span>{item.technician} · ¥{item.amount} · {item.matchStatus}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OutboundList({ orders }: { orders: WorkOrder[] }) {
  return (
    <Card className="panel module-panel">
      <div className="panel-header"><h2>出库单 / 领料</h2></div>
      <div className="compact-grid">
        {orders.flatMap((order) => order.outboundOrders).map((item) => (
          <div className="mini-card" key={item.id}>
            <strong>{item.id}</strong>
            <span>{item.dispatchNo} · {item.technician} · {item.status}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TechnicianTaskList({ orders }: { orders: WorkOrder[] }) {
  const tasks = orders.flatMap((order) => order.repairItems.map((item) => ({ order, item })));
  return (
    <Card className="panel module-panel">
      <div className="panel-header"><h2>维修项目任务</h2></div>
      <div className="compact-grid">
        {tasks.map(({ order, item }) => (
          <div className="mini-card" key={`${order.id}-${item.id}`}>
            <strong>{item.name || "未命名维修项目"}</strong>
            <span>{order.vehicle.plate} · {item.owner} · {item.status}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
