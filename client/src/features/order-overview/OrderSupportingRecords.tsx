import { ActionHistory } from "../../shared/ui/ActionHistory";
import { Collapse, Descriptions, Table } from 'antd';
import type { OrderOverview } from '../../../../shared/types';
import { displayTime, notificationLabels } from '../dispatch/dispatchLabels';
export function OrderSupportingRecords({data}:{data:OrderOverview}) {
  const {order,dispatch}=data;
  return <Collapse style={{marginTop:16}} items={[
    {key:'extra',label:'补充业务资料',children:<Descriptions column={1} size="small" items={[
      {key:'shop',label:'门店',children:order.shop.name},
      {key:'department',label:'业务部门',children:`${order.department.name} ${order.department.code}`},
      {key:'created',label:'开单时间',children:order.createdAt},
      {key:'type',label:'单据类型',children:order.paperOrder?'纸质委托书':order.isBaiyuanOrder?'百援订单':'电子委托书'},
      {key:'license',label:'行驶证异常备案',children:order.vehicleLicenseException?`${order.vehicleLicenseException.reason} · ${order.vehicleLicenseException.reportedName} · ${displayTime(order.vehicleLicenseException.reportedAt)}`:'无'},
      {key:'signature',label:'客户签字复核',children:order.customerSignatureReview?`${order.customerSignatureReview.state==='confirmed'?'已确认':'待确认'} · 签署 ${displayTime(order.customerSignatureReview.signedAt)} · 确认人 ${order.customerSignatureReview.confirmedBy||'未记录'}`:'无'},
      {key:'sync',label:'润丰同步',children:`${order.legacySyncStatus||'未同步'} · ${displayTime(order.legacySyncedAt)} ${order.legacySyncError||''}`},
      {key:'writeback',label:'维修完工回写',children:dispatch.repairWriteback?`${dispatch.repairWriteback.status} · ${dispatch.repairWriteback.error||'无错误'} · ${displayTime(dispatch.repairWriteback.syncedAt)}`:'无'}
    ]}/>},
    {key:'pending',label:`待修项目与客户决定（${order.pendingRepairs?.length||0}）`,children:(order.pendingRepairs||[]).map(item=><section key={item.id}><h4>{item.name}</h4><p>{item.reason} · {{pending:'待确认',approved:'客户同意',declined:'客户拒绝'}[item.state]} · {item.progress|| (item.scheduled?'已安排':'未安排')}</p><ActionHistory items={item.history.map((event,index)=>({key:index,title:event.action,actor:event.actor,time:displayTime(event.at),detail:<>{event.note?<p>{event.note}</p>:null}{event.respondent?<p>回复人：{event.respondent}</p>:null}</>}))}/></section>)},
    {key:'outbound',label:'出库物料明细',children:order.outboundOrders.map(outbound=><section key={outbound.id}><h4>{outbound.id} · {outbound.status}</h4><Table size="small" rowKey="id" pagination={false} dataSource={outbound.items} columns={[{title:'物料',dataIndex:'name'},{title:'数量',dataIndex:'quantity'},{title:'领料',render:(_,item)=>item.picked?'已领':'未领'}]}/></section>)},
    {key:'ocr',label:'OCR 识别内容',children:<Table size="small" rowKey="id" pagination={false} scroll={{x:'max-content'}} dataSource={order.ocrRecords} columns={[{title:'字段',dataIndex:'field'},{title:'识别内容',dataIndex:'value'},{title:'状态',dataIndex:'status'},{title:'异常',dataIndex:'error'}]}/>},
    {key:'notifications',label:`派工通知记录（${dispatch.notifications.length}）`,children:<ActionHistory items={dispatch.notifications.map(item=>({key:item.id,title:item.kind,actor:item.recipientName,time:displayTime(item.createdAt),detail:<><p>{notificationLabels[item.status]}</p>{item.error?<p>{item.error}</p>:null}</>}))}/>}

  ]}/>;
}
