import {useState} from 'react';
import {Alert,Button,Checkbox,Modal,Select,Tag} from 'antd';
import {warehouseRequests} from './individualRepair';
import {canProcessParts} from './partsProgress';
import type {DispatchController} from './useDispatchController';
import {PhotoPartsPreparation} from './PhotoPartsPreparation';

export function PartsPreparationDialog({controller:c,onClose}:{controller:DispatchController;onClose:()=>void}) {
 const task=c.detail!.task;
 const [version]=useState(task.version);
 const groups=warehouseRequests([task]);
 const ids=task.executionMode==='outsourced'?[task.assignedBy].filter((id):id is string=>Boolean(id)):task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 const people=[...c.people.technicians,...(c.people.dispatchers||[])].filter((p,index,all)=>p.active&&ids.includes(p.id)&&all.findIndex(o=>o.id===p.id)===index);
 const key=(owner:string|undefined,index:number)=>JSON.stringify([owner||'',index]);
 const [recipients,setRecipients]=useState<Record<string,string>>(()=>Object.fromEntries(groups.flatMap(group=>{
  const parts=group.partsRequirement!,applicant=parts.ownerId||parts.applicantId||parts.recordedBy;
  const defaultId=ids.includes(applicant||'')?applicant:ids.length===1?ids[0]:'';
  return parts.items.map((_,index)=>[key(parts.ownerId,index),defaultId||'']);
 })));
 const [selected,setSelected]=useState<string[]>([]);
 const stale=version!==task.version;
 const pendingFor=(group:typeof task)=>canProcessParts(group)&&group.partsRequirement?.mode==='list'?group.partsRequirement.items.flatMap((item,index)=>item.preparedAt||item.issuedAt?[]:[key(group.partsRequirement!.ownerId,index)]):[];
 const pending=groups.flatMap(pendingFor);
 const toggle=(keys:string[],checked:boolean)=>setSelected(rows=>checked?[...new Set([...rows,...keys])]:rows.filter(row=>!keys.includes(row)));
 const valid=selected.length>0&&selected.every(row=>pending.includes(row)&&people.some(p=>p.id===recipients[row]));
 const disabled=c.busy||stale;
 return <Modal open className="parts-preparation-dialog" title="确认备料" closable={!c.busy} mask={{closable:false}} onCancel={onClose} footer={<div className="parts-preparation-footer">
  {pending.length?<span role="status">已选 {selected.length} 项明细</span>:null}
  <div><Button disabled={c.busy} onClick={onClose}>取消</Button>{pending.length?<Button type="primary" loading={c.busy} disabled={disabled||!valid} onClick={async()=>{
   if(!valid||disabled)return;
   const preparationGroups=groups.map(group=>({partsOwnerId:group.partsRequirement!.ownerId,items:group.partsRequirement!.items.flatMap((_,index)=>selected.includes(key(group.partsRequirement!.ownerId,index))?[{index,recipientId:recipients[key(group.partsRequirement!.ownerId,index)]}]:[])})).filter(group=>group.items.length);
   if(await c.act({action:'confirm-parts',preparationGroups}))onClose();
  }}>备料完成并通知（{selected.length} 项）</Button>:null}</div>
 </div>}>
  <p className="parts-preparation-meta">{task.plate} · {task.dispatchNo||task.orderId}</p>
  <p className="parts-preparation-hint">明细配件可逐项勾选；照片清单核对全部照片后，按申请整份确认。系统通知对应领料人领取。</p>
  {stale?<Alert type="warning" showIcon title="申请已更新，请关闭后重新核对备料"/>:null}
  {pending.length?<div className="parts-preparation-select-all"><Checkbox disabled={disabled} checked={pending.every(row=>selected.includes(row))} indeterminate={selected.length>0&&selected.length<pending.length} onChange={e=>toggle(pending,e.target.checked)}>全选待备料配件（{pending.length} 项）</Checkbox></div>:null}
  <div className="parts-preparation-list">{groups.map(group=>{
   const parts=group.partsRequirement!,pendingKeys=pendingFor(group),selectedCount=pendingKeys.filter(row=>selected.includes(row)).length;
   const applicant=parts.ownerName||parts.applicantName||parts.recordedName||'历史共同申请';
   return <section className="parts-preparation-group" key={parts.ownerId||'legacy'} aria-label={`${applicant}的配件申请`}>
    <div className="parts-preparation-group-heading"><strong>{applicant}<small>{parts.mode==='photo'?`${parts.photoIds.length} 张照片 · 整份确认备料`:`${parts.items.length} 项 · ${pendingKeys.length} 项待备料`}</small></strong>{pendingKeys.length?<Checkbox aria-label={`全选${applicant}的待备料配件`} disabled={disabled} checked={selectedCount===pendingKeys.length} indeterminate={selectedCount>0&&selectedCount<pendingKeys.length} onChange={e=>toggle(pendingKeys,e.target.checked)}>本组全选</Checkbox>:null}</div>
    {parts.mode==='photo'?<PhotoPartsPreparation parts={parts} disabled={disabled||!canProcessParts(group)} onConfirm={async()=>{
     if(disabled||!canProcessParts(group))return;
     if(await c.act({action:'confirm-parts',partsOwnerId:parts.ownerId}))onClose();
    }}/>:parts.mode==='none'?<p>无需配件</p>:parts.items.map((item,index)=>{
     const row=key(parts.ownerId,index),prepared=Boolean(item.preparedAt||item.issuedAt||parts.preparedAt||parts.issuedAt);
     return <div className="parts-preparation-item" key={row}>
      <Checkbox disabled={disabled||!pendingKeys.includes(row)} checked={selected.includes(row)} onChange={e=>toggle([row],e.target.checked)}>{item.name} · {item.quantity} {item.unit}</Checkbox>
      {prepared?<p><Tag color="green">已备齐</Tag>领料人：{item.recipientName||parts.recipientName||applicant}</p>:<label className="parts-preparation-recipient">领料人<Select aria-label={`${applicant}申请的${item.name}领料人`} placeholder="请选择领料人" value={recipients[row]||undefined} disabled={disabled||!pendingKeys.includes(row)} options={people.map(p=>({value:p.id,label:p.name}))} onChange={id=>setRecipients(rows=>({...rows,[row]:id}))}/></label>}
     </div>;
    })}
   </section>;
  })}</div>
  {c.error?<Alert type="error" showIcon title={c.error}/>:null}
 </Modal>;
}
