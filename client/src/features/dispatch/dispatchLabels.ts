import type { DispatchActionName,DispatchMetric,DispatchStage,DispatchTask } from '../../../../shared/types';
export const stages:DispatchStage[]=['待派工','待接单','待开工','维修中','暂停','待检验','维修完成'];
export const metrics:Record<DispatchMetric,string>={pendingAccept:'待接单',unstarted:'尚未开工',working:'正在维修',paused:'暂停',inspection:'待检验',completed:'已完成',overdue:'超期',rework:'返工'};
export const actionLabels:Record<DispatchActionName,string>={'record-hours':'录入工时',assign:'指派维修工',reassign:'改派',reoffer:'重新发起接单',cancel:'撤销派工',accept:'确认接单',decline:'无法接单',start:'开工',finish:'项目完成',pick:'确认领料',pause:'暂停维修',resume:'恢复维修',submit:'提报检验',inspect:'检验处理',update:'调整派工信息',remind:'催办','retry-notification':'重试通知',reconcile:'核对历史任务'};
export const notificationLabels={pending:'待发送',accepted:'平台受理',sent:'发送成功',failed:'发送失败',unknown:'结果未知'};
export function displayTime(value?:string) {if(!value) return '未记录';const time=new Date(value);return Number.isFinite(time.getTime())?time.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):value;}
export function localDateTime(value?:string) {return value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';}

export function personDisplayName(person:{id:string;name:string},people:Array<{id:string;name:string}>) {
  return people.filter(p=>p.name===person.name).length>1?`${person.name}（账号 ${person.id}）`:person.name;
}

export const statusFilters = [
  {value:'',label:'全部未完结'}, {value:'待派工',label:'未派工'},
  {value:'待接单',label:'未接单'}, {value:'待开工',label:'待开工'},
  {value:'维修中',label:'正在维修'}, {value:'暂停',label:'暂停'},
  {value:'待检验',label:'待检验'}, {value:'待结算',label:'待结算'},
  {value:'草稿',label:'草稿'}, {value:'待客户签字',label:'待客户签字'},
  {value:'完成',label:'已完结'}
];
export function taskStatusLabel(task:DispatchTask) {
  const value=task.orderStatus==='完成'?'完成':task.orderStatus==='待结算'?'待结算':task.stage;
  return statusFilters.find(option=>option.value===value)?.label||value;
}
