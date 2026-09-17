import { BarChart3, ClipboardList, LayoutDashboard, ShieldCheck } from "lucide-react";
import { RoleKey } from "../../../../shared/types";

export const navItems: Array<{ label: string; icon: typeof LayoutDashboard; roles: RoleKey[] }> = [
  { label: "工作台", icon: LayoutDashboard, roles: ["advisor", "manager"] },
  { label: "委托开单", icon: ClipboardList, roles: ["advisor", "manager"] },
  { label: "派工台", icon: ClipboardList, roles: ["advisor", "manager"] },
  { label: "维修工详情", icon: BarChart3, roles: ["advisor", "manager"] },
  { label: "我的维修", icon: ClipboardList, roles: ["technician"] },
  { label: "检验任务", icon: ClipboardList, roles: ["inspector", "manager"] },
  { label: "数据看板", icon: BarChart3, roles: ["manager"] },
  { label: "权限设置", icon: ShieldCheck, roles: ["manager"] }
];

export const belongings = ["音响系统", "点烟器", "天窗", "四门玻璃机", "中央门锁", "后视镜", "备胎", "灭火器", "行驶证", "千斤顶", "贵重物品"];
export const exteriorIssues = ["石击", "凹凸", "划伤", "损坏"];

export const roleFocus: Record<RoleKey, { title: string; dataScope: string; primary: string; blocked: string[] }> = {
  advisor: {
    title: "服务顾问工作区",
    dataScope: "查看本店委托单、维修任务和维修工负荷",
    primary: "开单、客户签字、提交润丰同步、指派和改派维修工",
    blocked: ["不能配置门店权限", "不能检验通过"]
  },
  technician: {
    title: "维修技师工作区",
    dataScope: "只显示派给本人的维修单",
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
    primary: "查看全量数据、处理异常、协助签字与平台同步、配置权限",
    blocked: ["调度与检验操作全程留痕"]
  }
};
