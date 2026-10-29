import {Button,Checkbox,Input,Select} from 'antd';
import {PlusOutlined,DeleteOutlined,LockOutlined} from '@ant-design/icons';
import type {ReactNode} from 'react';
import type {DispatchItem,RepairItemEdit,UserProfile} from '../../../../shared/types';
import {personDisplayName,displayTime} from './dispatchLabels';
import './repair-items-editor.css';
export function RepairItemsEditor({items,rows,onChange,editing=false,disabled=false,technicians=[],showResponsibilities=true,selection,onResponsibleChange,allowRemoval=false,lockExisting=false,renderItemActions}:{items:DispatchItem[];rows:RepairItemEdit[];onChange:(rows:RepairItemEdit[])=>void;editing?:boolean;disabled?:boolean;technicians?:UserProfile[];showResponsibilities?:boolean;onResponsibleChange?:(index:number,responsibleId:string)=>void;allowRemoval?:boolean;lockExisting?:boolean;selection?:{selected:number[];onChange:(selected:number[])=>void};renderItemActions?:(item:DispatchItem)=>ReactNode}) {
 const eligible=rows.flatMap((row,index)=>items.some(item=>item.id===row.id&&(lockExisting||['待检验','已完工'].includes(item.status)))?[]:[index]);
 const hasLocked=rows.some(row=>items.some(item=>item.id===row.id&&(lockExisting||['待检验','已完工'].includes(item.status))));
 return <div className={`repair-items-editor${editing?' is-editing':''}`}>
   {editing?<div className="repair-items-toolbar"><div className="repair-items-summary">{selection?<Checkbox aria-label="全选可分配项目" disabled={disabled||!eligible.length} checked={eligible.length>0&&eligible.every(index=>selection.selected.includes(index))} indeterminate={selection.selected.length>0&&!eligible.every(index=>selection.selected.includes(index))} onChange={e=>selection.onChange(e.target.checked?eligible:[])}>全选</Checkbox>:null}<span>共 <strong>{rows.length}</strong> 项</span></div><Button type="link" size="small" icon={<PlusOutlined/>} aria-label="＋ 新增增修项目" disabled={disabled||rows.length>=200} onClick={()=>onChange([...rows,{name:'',responsibleId:showResponsibilities&&technicians.length===1?technicians[0].id:undefined}])}>新增维修项目</Button></div>:null}
   <ol className="repair-item-list">{rows.map((row,index)=>{
    const item=items.find(item=>item.id===row.id),locked=item&&(lockExisting||['待检验','已完工'].includes(item.status));
    return <li key={row.id??`new-${index}`} className="repair-item-row">
      <div className="repair-item-leading">{editing&&selection?<Checkbox aria-label={`选取维修项目 ${index+1}`} checked={selection.selected.includes(index)} disabled={disabled||Boolean(locked)} onChange={e=>selection.onChange(e.target.checked?[...selection.selected,index]:selection.selected.filter(i=>i!==index))}/>:null}<span className="repair-item-number">{String(index+1).padStart(2,'0')}</span></div>
      <div className="repair-item-content">
        <div className="repair-item-name-row">
        {editing&&!locked?<div className="repair-item-name-field"><Input.TextArea autoSize={{minRows:2}} aria-label={`维修项目 ${index+1} 名称`} value={row.name} maxLength={100} status={row.name.length>100?'error':undefined} disabled={disabled} placeholder="填写维修项目名称（最多 100 个字符）" onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/><span className="repair-item-name-count">{row.name.length} / 100</span></div>:<div className="repair-item-title">{row.name}{editing&&locked?<LockOutlined aria-label="项目已锁定"/>:null}</div>}
        {editing&&!locked&&(row.id===undefined||allowRemoval)?<Button danger type="text" size="small" icon={<DeleteOutlined/>} disabled={disabled||rows.length<=1} aria-label={row.id===undefined?`移除新增项目 ${index+1}`:`删除维修项目 ${index+1}`} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}/>:null}
        </div>
      {editing&&row.name.length>100?<p role="alert">项目名称不能超过 100 个字符，请缩短后再提交。</p>:null}
      {showResponsibilities?(editing&&!locked?<label className="repair-item-owner"><span>负责人</span><Select aria-label={`维修项目 ${index+1} 负责人`} placeholder="选择维修工" value={row.responsibleId} disabled={disabled} style={{width:'100%'}} options={technicians.map(p=>({value:p.id,label:personDisplayName(p,technicians)}))} onSelect={responsibleId=>onResponsibleChange?onResponsibleChange(index,responsibleId):onChange(rows.map((r,i)=>i===index?{...r,responsibleId,responsibleName:undefined}:r))}/></label>:<div className="repair-item-owner">负责人：{row.responsibleName||technicians.find(p=>p.id===row.responsibleId)?.name||'待指定'}</div>):null}
      {item?<div className="dispatch-item-times"><span>{item.status}</span><span>开工：{displayTime(item.startAt)}</span><span>完工提报：{displayTime(item.finishAt)}</span><span>检验：{item.inspectorName||'未检验'} · {displayTime(item.inspectedAt)}</span><span>领料确认：{displayTime(item.pickedAt)}</span></div>:null}
      {item?.rejectionReason?<p className="repair-item-return-reason">检验退回：{item.rejectionReason}</p>:null}
      {item?renderItemActions?.(item):null}
      </div>
    </li>;
   })}</ol>
   {editing&&hasLocked?<p className="repair-items-lock-note"><LockOutlined/> {lockExisting?'已有项目仅供查看，仅可新增并分配项目':'已提检或检验通过的项目仅供查看'}</p>:null}
 </div>;
}
