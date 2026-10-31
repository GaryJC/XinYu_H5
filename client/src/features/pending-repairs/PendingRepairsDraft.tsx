import { createRequestId } from "../../shared/api/requestId";
import {Button,Input,Space} from 'antd';
import type {PendingRepair} from '../../../../shared/types';
export function PendingRepairsDraft({items,onChange,disabled}:{items:PendingRepair[];onChange:(items:PendingRepair[])=>void;disabled:boolean}) {
 return <section aria-label="接车待确认项目"><Space wrap><h3>待客户确认项目（选填）</h3><Button disabled={disabled||items.length>=100} onClick={()=>onChange([...items,{id:createRequestId(),itemId:0,name:'',reason:'',state:'pending',scheduled:false,history:[]}])}>添加待确认项目</Button></Space>
 <p>司机需要向公司确认的项目先记在这里，其他项目正常维修。</p>
 {items.map((item,index)=><div key={item.id} style={{display:'grid',gap:8,marginBottom:16,minWidth:0}}><Input aria-label={`待确认项目 ${index+1} 名称`} placeholder="项目名称" value={item.name} disabled={disabled} maxLength={200} onChange={e=>onChange(items.map((p,i)=>i===index?{...p,name:e.target.value}:p))}/><Input.TextArea aria-label={`待确认项目 ${index+1} 原因`} placeholder="待确认原因" value={item.reason} disabled={disabled} maxLength={2000} onChange={e=>onChange(items.map((p,i)=>i===index?{...p,reason:e.target.value}:p))}/><Button disabled={disabled} onClick={()=>onChange(items.filter((_,i)=>i!==index))}>移除待确认项目</Button></div>)}
 </section>;
}
