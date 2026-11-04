import { BarChart3, CarFront, ClipboardCheck, FilePenLine, Files, Gavel, LayoutDashboard, Network, PackagePlus, Route, ShieldCheck, Wrench } from "lucide-react";
import { RoleKey } from "../../../../shared/types";

export const primaryNavByRole: Record<RoleKey, string> = {
  employee: "出车申请",
  advisor: "委托开单",
  manager: "工作台",
  technician: "我的维修",
  outsourcing: "我的维修",
  inspector: "检验任务",
  warehouse: "配件申请"
};

export const navItems: Array<{ label: string; icon: typeof LayoutDashboard; roles: RoleKey[] }> = [
  { label: "工作台", icon: LayoutDashboard, roles: ["advisor", "manager"] },
  { label: "委托开单", icon: FilePenLine, roles: ["employee", "advisor", "manager", "technician", "inspector", "warehouse", "outsourcing"] },
  { label: "派工台", icon: Network, roles: ["advisor", "manager"] },
  { label: "检验任务", icon: ClipboardCheck, roles: ["inspector", "manager"] },
  { label: "工单全览", icon: Files, roles: ["advisor", "manager"] },
  { label: "配件申请", icon: PackagePlus, roles: ["warehouse"] },
  { label: "配件竞价", icon: Gavel, roles: ["warehouse", "manager"] },
  { label: "我的维修", icon: Wrench, roles: ["technician", "outsourcing"] },
  { label: "出车申请", icon: Route, roles: ["employee", "advisor", "manager", "technician", "inspector", "warehouse", "outsourcing"] },
  { label: "车辆管理", icon: CarFront, roles: ["manager"] },
  { label: "数据看板", icon: BarChart3, roles: ["manager"] },
  { label: "权限设置", icon: ShieldCheck, roles: ["manager"] }
];

export const belongings = ["音响系统", "点烟器", "天窗", "四门玻璃机", "中央门锁", "后视镜", "备胎", "灭火器", "行驶证", "千斤顶", "贵重物品"];
export const exteriorIssues = ["石击", "凹凸", "划伤", "损坏"];
