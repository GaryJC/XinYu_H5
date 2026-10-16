import roleDefinitions from "../../../../shared/dingtalkRoles.json";
export { roleDefinitions };
import type { RoleKey } from '../../../../shared/types';
import { dispatchEnabled } from '../dispatch/dispatchAvailability';
export const roleLabels:Record<RoleKey,string>={manager:'门店管理员',advisor:'服务顾问',technician:'维修工 / 维修技师',inspector:'检验员'};
export const roleOptions=Object.entries(roleLabels).map(([value,label])=>({value,label}));
const fullRoleDescriptions:Record<RoleKey,{scope:string;abilities:string;limits:string}>={
  manager:{scope:'本店工单与人员',abilities:'开单、派工、录入工时、检验、结算与查看员工权限',limits:'不能检验本人参与维修的项目'},
  advisor:{scope:'本店工单、维修任务与人员负荷',abilities:'开单、客户签字、派工、改派、录入工时；处理本人负责工单的结算',limits:'不能执行检验或查看员工权限'},
  technician:{scope:'分配给本人的维修任务',abilities:'接单、领料、开工、暂停、完成项目与提报检验',limits:'不能派工、填写工时或执行检验'},
  inspector:{scope:'指派给本人的检验任务',abilities:'检验通过、退回返工',limits:'不能开单、派工、填写工时或结算'}
};
export const roleDescriptions = dispatchEnabled ? fullRoleDescriptions : {
  manager: {scope:'本店工单与人员',abilities:'开单、客户签字、润丰同步、结算与查看员工权限',limits:'派工、维修与检验功能暂未开放'},
  advisor: {scope:'本店委托单',abilities:'开单、客户签字、润丰同步；处理本人负责工单的结算',limits:'不能查看员工权限；派工功能暂未开放'},
  technician: {scope:'维修功能暂未开放',abilities:'暂未开放',limits:'暂未开放维修任务操作'},
  inspector: {scope:'检验功能暂未开放',abilities:'暂未开放',limits:'暂未开放检验任务操作'}
};
export function roleLandingPage(role: RoleKey) {
  if (dispatchEnabled) return roleDefinitions.find(item => item.role === role)?.page || '工作台';
  return role === 'advisor' ? '委托开单' : role === 'manager' ? '工作台' : '功能暂未开放';
}
export function displayLogin(value?:string){if(!value)return '尚无进入记录';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无进入记录';}
