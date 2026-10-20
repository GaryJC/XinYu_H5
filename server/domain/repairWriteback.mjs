import {createHash} from 'node:crypto';
export function writebackEnabled(env=process.env) {return env.RUNFENG_REPAIR_WRITEBACK_ENABLED==='true';}
export function makeWritebackSnapshot(task,items,users) {
 return {orderId:task.orderId,repairRound:task.repairRound||0,plate:task.plate,items:items.map(item=>{
  const person=users.find(p=>p.id===item.responsibleId);
  return {id:item.id,name:item.name,responsibleId:item.responsibleId||null,
   employeeCode:person?.legacy_employee_code||null,employeeName:person?.legacy_employee_name||null};
 })};
}
export function writebackHash(snapshot) {return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');}
export function validateWritebackSnapshot(snapshot) {
 if(!snapshot.plate||!snapshot.items?.length||snapshot.items.length>200)throw new Error('维修项目快照不完整');
 for(const item of snapshot.items) {
  if(!item.name?.trim())throw new Error('维修项目名称为空');
  if(item.name.length>100)throw new Error(`项目“${item.name.slice(0,20)}…”超出润丰字段长度，请缩短名称`);
  if(item.employeeCode&&item.employeeName&&`${item.employeeCode.trim()} ${item.employeeName.trim()}`.length>100)throw new Error('负责人编码及姓名超出润丰字段长度');
  if(!item.responsibleId||!item.employeeCode?.trim()||!item.employeeName?.trim())throw new Error(`项目“${item.name}”的负责人尚未绑定润丰员工编码，请管理员核对后重新生成同步任务`);
 }
}

export function writebackDispatchAllowlist(env=process.env) {
 const raw=env.RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST?.trim();
 if(!raw)return null;
 const values=raw.split(',').map(s=>s.trim());
 return values.every(s=>/^[A-Za-z][0-9]{1,19}$/.test(s))?[...new Set(values)]:[];
}
export function writebackAllowed(dispatchNo,env=process.env) {
 const list=writebackDispatchAllowlist(env);
 return writebackEnabled(env)&&(!list||list.includes(dispatchNo));
}
