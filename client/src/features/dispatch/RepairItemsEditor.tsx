import {Button,Input} from 'antd';
import {PlusOutlined,DeleteOutlined,LockOutlined} from '@ant-design/icons';
import type {DispatchItem,RepairItemEdit} from '../../../../shared/types';
import './repair-items-editor.css';
export function RepairItemsEditor({items,rows,onChange,editing=false,disabled=false}:{items:DispatchItem[];rows:RepairItemEdit[];onChange:(rows:RepairItemEdit[])=>void;editing?:boolean;disabled?:boolean}) {
 const hasLocked=rows.some(row=>items.some(item=>item.id===row.id&&['待检验','已完工'].includes(item.status)));
 return <div className={`repair-items-editor${editing?' is-editing':''}`}>
   {editing?<div className="repair-items-toolbar"><span>共 <strong>{rows.length}</strong> 项</span><Button type="link" size="small" icon={<PlusOutlined/>} aria-label="＋ 新增增修项目" disabled={disabled||rows.length>=200} onClick={()=>onChange([...rows,{name:''}])}>新增增修项目</Button></div>:null}
   <ol className="repair-item-list">{rows.map((row,index)=>{
    const item=items.find(item=>item.id===row.id),locked=item&&['待检验','已完工'].includes(item.status),additional=row.id===undefined||row.id<0;
    return <li key={row.id??`new-${index}`} className={additional?'repair-item-row is-additional':'repair-item-row'}>
      <span className="repair-item-number">{String(index+1).padStart(2,'0')}</span>
      <div className="repair-item-content">
        <div className="repair-item-meta"><span className="repair-item-kind">{additional?'增修项目':'原维修项目'}</span><div className="repair-item-status">{editing&&row.id===undefined?<Button danger type="text" size="small" icon={<DeleteOutlined/>} disabled={disabled} aria-label={`移除新增项目 ${index+1}`} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}/>:null}</div></div>
        {editing&&!locked?<Input aria-label={`维修项目 ${index+1} 名称`} value={row.name} maxLength={200} disabled={disabled} placeholder="填写维修项目名称" onChange={e=>onChange(rows.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/>:<div className="repair-item-title">{row.name}{editing&&locked?<LockOutlined aria-label="项目已锁定"/>:null}</div>}
      </div>
    </li>;
   })}</ol>
   {editing&&hasLocked?<p className="repair-items-lock-note"><LockOutlined/> 已提检或检验通过的项目仅供查看</p>:null}
 </div>;
}
