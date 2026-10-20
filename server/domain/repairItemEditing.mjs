import {HttpError} from '../http/HttpError.mjs';
export function validateRepairItemEdits(input) {
 if(input.repairItems===undefined)return;
 if(!['edit-repair-items','submit-order'].includes(input.action))throw new HttpError(400,'请通过维修项目编辑入口修改');
 const rows=input.repairItems;
 if(Array.isArray(rows)&&rows.some(row=>row?.responsibleId!==undefined&&(typeof row.responsibleId!=='string'||row.responsibleId.length>200)))throw new HttpError(400,'项目负责人无效');
 if(!Array.isArray(rows)||!rows.length||rows.length>200||rows.some(row=>!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>200||row.id!==undefined&&!Number.isSafeInteger(row.id)))throw new HttpError(400,'维修项目须填写名称，每项不超过 200 字');
 const ids=rows.filter(row=>row.id!==undefined).map(row=>row.id);
 if(new Set(ids).size!==ids.length)throw new HttpError(400,'维修项目编号重复');
}
export function editRepairItems(next,rows,actor,now) {
 if(!rows)throw new HttpError(400,'请填写维修项目');
 const known=new Map(next.items.map(item=>[item.id,item]));
 if(next.items.some(item=>!rows.some(row=>row.id===item.id)))throw new HttpError(409,'原维修项目不可删除');
 if(rows.some(row=>row.id!==undefined&&!known.has(row.id)))throw new HttpError(409,'维修项目不存在，请刷新');
 let nextId=Math.min(0,...(next.repairCatalog||next.items).map(item=>item.id))-1;
 const working=next.stage==='维修中'||next.stage==='暂停'&&next.resumeStage==='维修中';
 next.items=rows.map(row=>{
  const item=known.get(row.id),name=row.name.trim();
  if(item){
   if(['待检验','已完工'].includes(item.status)){if(row.name!==item.name||row.responsibleId!==undefined&&row.responsibleId!==item.responsibleId)throw new HttpError(409,'已提检或检验通过的项目不可修改');return {...item};}
   return {...item,name,responsibleId:row.responsibleId??item.responsibleId};
  }
  return {id:nextId--,name,responsibleId:row.responsibleId,status:working?'维修中':'待开工',...(working?{startAt:now,startedBy:actor.id}:{})};
 });
}
