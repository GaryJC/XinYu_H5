import type { RoleKey } from '../../../../shared/types';
export const roleLabels:Record<RoleKey,string>={manager:'门店管理员',advisor:'服务顾问 / 派单',technician:'维修技师',inspector:'检验员'};
export const roleOptions=Object.entries(roleLabels).map(([value,label])=>({value,label}));
export const roleDescriptions:Record<RoleKey,{scope:string;abilities:string;limits:string}>={
  manager:{scope:'本店工单与人员',abilities:'开单、派工、录入工时、检验、结算与权限配置',limits:'不能检验本人参与维修的项目'},
  advisor:{scope:'本店工单、维修任务与人员负荷',abilities:'开单、客户签字、派工、改派、录入工时；处理本人负责工单的结算',limits:'不能执行检验或配置权限'},
  technician:{scope:'分配给本人的维修任务',abilities:'接单、领料、开工、暂停、完成项目与提报检验',limits:'不能派工、填写工时或执行检验'},
  inspector:{scope:'指派给本人的检验任务',abilities:'检验通过、退回返工',limits:'不能开单、派工、填写工时或结算'}
};
export function displayLogin(value?:string){if(!value)return '尚无进入记录';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无进入记录';}
