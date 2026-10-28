import {WarehouseWorkOrderPhotos} from './WarehouseWorkOrderPhotos';
import {Alert,Button,Descriptions,Drawer,Spin,Table} from 'antd';
import {WorkOrderPrintButton} from '../work-order-print/WorkOrderPrintButton';
import {useWarehouseWorkOrder} from './useWarehouseWorkOrder';

export function WarehouseWorkOrderDrawer({orderId,onClose}:{orderId?:string;onClose:()=>void}) {
  const {order,error,loading,retry}=useWarehouseWorkOrder(orderId);
  return <Drawer title="委托单详情" open={Boolean(orderId)} onClose={onClose} size={700} styles={{wrapper:{maxWidth:'100vw'}}} extra={order?<WorkOrderPrintButton order={order}/>:null}>
    {loading?<div role="status"><Spin/> 正在加载委托单…</div>:null}
    {error?<Alert type="error" showIcon title={error} action={<Button onClick={retry}>重试</Button>}/>:null}
    {order?<>
      <Descriptions size="small" bordered column={1} items={[
        {key:'id',label:'委托单号',children:order.id},
        {key:'dispatch',label:'派工号',children:order.dispatchNo||'未记录'},
        {key:'status',label:'状态',children:order.status},
        {key:'plate',label:'车牌',children:order.vehicle.plate},
        {key:'vin',label:'车架号',children:order.vehicle.vin||'未填写'},
        {key:'model',label:'车型',children:order.vehicle.model||'未填写'},
        {key:'mileage',label:'进厂里程',children:order.vehicle.mileage?`${order.vehicle.mileage} km`:'未填写'},
        {key:'customer',label:'托修单位',children:order.customer.name||'未填写'},
        {key:'contact',label:'联系人',children:order.customer.contact||'未填写'},
        {key:'phone',label:'联系电话',children:order.customer.phone||'未填写'},
        {key:'advisor',label:'服务顾问',children:order.advisor||'未记录'},
        {key:'arrival',label:'进厂日期',children:order.arrivalDate||'未记录'},
        {key:'due',label:'预计交车',children:order.estimatedDeliveryAt||'未设置'},
        {key:'fault',label:'故障描述',children:order.faultDescription||'未填写'},
        {key:'oldParts',label:'旧件处置',children:order.oldPartsHandling||'未填写'}
      ]}/>
      <h3>维修项目</h3>
      <Table size="small" pagination={false} rowKey="id" dataSource={order.repairItems} scroll={{x:440}} columns={[
        {title:'项目',dataIndex:'name'}, {title:'主修人',dataIndex:'owner'}, {title:'状态',dataIndex:'status'}, {title:'工费',dataIndex:'laborFee'}
      ]}/>
      <WarehouseWorkOrderPhotos order={order}/>
    </>:null}
  </Drawer>;
}
