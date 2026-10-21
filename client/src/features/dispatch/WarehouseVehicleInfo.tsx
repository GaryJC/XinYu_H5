import { Collapse, Descriptions } from 'antd';
import type { DispatchTask } from '../../../../shared/types';
import { CopyTextButton } from '../../shared/ui/CopyTextButton';
import { WarehouseDispatchNumber } from './WarehouseDispatchNumber';
import { displayTime } from './dispatchLabels';

export function WarehouseVehicleInfo({task}:{task:DispatchTask}) {
  return <>
    <div className="warehouse-identifiers">
      {[{label:'车牌号',value:task.plate},{label:'车架号',value:task.vehicleVin}].map(({label,value})=><div className="warehouse-identifier" key={label} aria-label={label}>
        <div><span>{label}</span><strong>{value||'未填写'}</strong></div>
        {value?<CopyTextButton key={value} text={value} label={`复制${label} ${value}`}/>:null}
      </div>)}
      <WarehouseDispatchNumber value={task.dispatchNo}/>
    </div>
    <Descriptions className="warehouse-vehicle-info" size="small" column={1} colon={false} items={[
      {key:'technician',label:'主修人',children:task.technicianName||'未记录'},
      {key:'arrival',label:'进厂日期',children:task.arrivalDate||'未记录'}
    ]}/>
    <Collapse className="warehouse-order-more" items={[{key:'details',label:'车辆与委托单其他信息',children:<Descriptions className="warehouse-vehicle-info" size="small" column={1} colon={false} items={[
      {key:'model',label:'车型',children:task.vehicleModel||'未填写'},
      {key:'fault',label:'故障描述',children:task.faultDescription||'未填写'},
      {key:'mileage',label:'进厂里程',children:task.vehicleMileage?`${task.vehicleMileage} km`:'未填写'},
      {key:'customer',label:'托修单位',children:task.customerName||'未填写'},
      {key:'advisor',label:'服务顾问',children:task.advisor||'未记录'},
      {key:'due',label:'预计完工',children:displayTime(task.dueAt)},
      {key:'order',label:'委托单号',children:task.orderId},
      {key:'round',label:'维修轮次',children:task.repairRound?`返工第 ${task.repairRound} 轮`:'首次维修'},
      {key:'reason',label:'返工原因',children:task.roundReason||'无'}
    ]}/>}]} />
  </>;
}
