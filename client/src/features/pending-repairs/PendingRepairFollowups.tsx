import {useState} from 'react';
import {Alert,Button,Modal,Tag} from 'antd';
import {request} from '../../shared/api/httpClient';
import type {PendingRepairList,UserProfile} from '../../../../shared/types';
import {PendingRepairsPanel} from './PendingRepairsPanel';
type Followup=PendingRepairList&{orderId:string;plate:string;dispatchNo:string};
export function PendingRepairFollowups({user}:{user?:UserProfile}) {
 const [open,setOpen]=useState(false),[rows,setRows]=useState<Followup[]>([]),[selected,setSelected]=useState<Followup>(),[error,setError]=useState('');
 async function load(){setError('');try{setRows(await request<Followup[]>('/api/pending-repairs'));}catch(e){setError(e instanceof Error?e.message:String(e));}}
 return <><Button onClick={()=>{setOpen(true);void load();}}>待客户确认跟进</Button><Modal open={open} title="待客户确认跟进（含已完结工单）" onCancel={()=>setOpen(false)} footer={null}>
 {error&&<Alert type="error" title={error}/>}{!error&&!rows.length&&<p>暂无待跟进事项</p>}
 {rows.map(row=><p key={row.orderId}><Button onClick={()=>setSelected(row)}>{row.plate} · {row.dispatchNo||row.orderId}</Button> <Tag>{row.items.filter(i=>i.state==='pending'||i.state==='approved'&&!i.scheduled).length} 项</Tag></p>)}
 </Modal><Modal open={!!selected} title={`${selected?.plate||''} · 待确认项目`} onCancel={()=>setSelected(undefined)} footer={null} destroyOnHidden>{selected&&<PendingRepairsPanel orderId={selected.orderId} user={user} onChanged={()=>void load()}/>}</Modal></>;
}
