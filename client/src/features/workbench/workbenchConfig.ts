import { BarChart3, ClipboardList, LayoutDashboard, ReceiptText, ShieldCheck, UsersRound, Wrench } from "lucide-react";
import { RoleKey } from "../../../../shared/types";

export const navItems: Array<{ label: string; icon: typeof LayoutDashboard; roles: RoleKey[] }> = [
  { label: "工作台", icon: LayoutDashboard, roles: ["advisor", "dispatcher", "technician", "inspector", "manager"] },
  { label: "委托开单", icon: ClipboardList, roles: ["advisor", "manager"] },
  { label: "派工管理", icon: UsersRound, roles: ["dispatcher", "manager"] },
  { label: "维修进度", icon: Wrench, roles: ["technician", "inspector", "manager"] },
  { label: "结算清单", icon: ReceiptText, roles: ["advisor", "manager"] },
  { label: "数据看板", icon: BarChart3, roles: ["manager"] },
  { label: "权限设置", icon: ShieldCheck, roles: ["manager"] }
];

export const belongings = ["音响系统", "点烟器", "天窗", "四门玻璃机", "中央门锁", "后视镜", "备胎", "灭火器", "行驶证", "千斤顶", "贵重物品"];
export const exteriorIssues = ["石击", "凹凸", "划伤", "损坏"];

export const roleFocus: Record<RoleKey, { title: string; dataScope: string; primary: string; blocked: string[] }> = {
  advisor: {
    title: "服务顾问工作区",
    dataScope: "只显示本人创建或负责签字的委托单",
    primary: "开单、维护客户车辆信息、发起客户签字、提交派工池",
    blocked: ["不能指派技师", "不能提交维修完成", "不能改权限"]
  },
  dispatcher: {
    title: "派单员工作区",
    dataScope: "只显示待派工和维修中的工单",
    primary: "查看待派工池、指派/改派维修技师",
    blocked: ["不能编辑客户信息", "不能发起客户签字", "不能确认结算"]
  },
  technician: {
    title: "维修技师工作区",
    dataScope: "只显示派给陈立的维修单",
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
    primary: "查看全量数据、处理异常、确认结算、配置权限",
    blocked: ["生产环境仍需后端强制审计"]
  }
};
