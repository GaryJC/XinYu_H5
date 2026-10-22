import {useState} from 'react';
import {Button,Card,Empty} from 'antd';
import type {DispatchTask} from '../../../../shared/types';

export function WarehouseRepairItems({task,onRefresh,disabled=false}:{task:DispatchTask;onRefresh?:()=>Promise<unknown>;disabled?:boolean}) {
  const [refreshing,setRefreshing]=useState(false);
  async function refresh() {
    if(!onRefresh||refreshing)return;
    setRefreshing(true);
    try{await onRefresh();}finally{setRefreshing(false);}
  }
  return <Card className="warehouse-repair-items" size="small" title="维修项目" aria-label="维修项目"
    extra={onRefresh?<Button size="small" aria-label="刷新维修项目" loading={refreshing} disabled={disabled} onClick={()=>void refresh()}>刷新项目</Button>:null}>
    {task.items.length?<ol>{task.items.map(item=><li key={item.id}>{item.name}<small style={{display:'block',color:'#667085'}}>负责人：{item.responsibleName||(task.technicianIds?.length===1?task.technicianName:'未分配')} · {item.status}</small></li>)}</ol>:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无维修项目"/>}
  </Card>;
}
