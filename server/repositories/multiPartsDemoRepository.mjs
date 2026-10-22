import {randomUUID} from 'node:crypto';
import {applyDispatchAction} from '../domain/dispatchPolicy.mjs';
import {saveDispatchTask} from './dispatchRepository.mjs';

// The local-only script validates its database destination before invoking this.
export async function seedMultiPartsDemo(client) {
  const shopId='shop-hq';
  const definitions=[
    {id:'u_dev_advisor',name:'张三（测试）',role:'advisor'},
    {id:'u_dev_technician',name:'李富强',role:'technician'},
    {id:'u_demo_parts_technician_b',name:'维修工乙（模拟）',role:'technician'},
    {id:'u_dev_warehouse',name:'仓管（测试）',role:'warehouse'}
  ];
  const people=[];
  for(const definition of definitions){
    await client.query('insert into users(id,name,role,shop_id,active) values($1,$2,$3,$4,true) on conflict(id) do nothing',[definition.id,definition.name,definition.role,shopId]);
    const {rows:[user]}=await client.query('select id,name,role,active,shop_id from users where id=$1',[definition.id]);
    if(!user.active||user.role!==definition.role||user.shop_id!==shopId)throw new Error('模拟账号的门店或权限已调整，请核对后再创建');
    people.push({...user,shopId:user.shop_id});
  }
  const [advisor,a,b]=people,now=Date.now();
  const stamp=new Date(now+8*3600000).toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  const id=`WT-DEMO-MULTI-PARTS-${stamp}-${randomUUID().slice(0,4).toUpperCase()}`;
  const plate='鲁B测试622',dispatchNo=`DM${stamp.slice(2)}`,today=new Date(now+8*3600000).toISOString().slice(0,10);
  const fault='【本地模拟】两人分别申请不同配件，用于测试逐项备料完成、领料人归属和分批通知。';
  await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,shop_name,old_parts_handling,vehicle_plate,vehicle_model,vehicle_mileage,customer_name,arrival_date,dispatch_no,fault_description,fee_note)
    values($1,'已委托',$2,'待派工','待检验',$3,'抚顺路店','环保处理',$4,'【模拟】多人维修测试车','52600','【模拟】多人用料测试车队',$5,$6,$7,'LOCAL-MULTI-PARTS-DEMO')`,[id,advisor.name,shopId,plate,today,dispatchNo,fault]);
  let task={orderId:id,shopId,orderStatus:'已委托',stage:'待派工',version:0,plate,dispatchNo,arrivalDate:today,faultDescription:fault,items:[{id:1,name:'【模拟】发动机常规保养',status:'待派工'},{id:2,name:'【模拟】制动系统维修',status:'待派工'}]};
  async function act(actor,action,extra){
    const input={action,expectedVersion:task.version,requestId:randomUUID(),...extra};
    const at=new Date(now-15*60000+task.version*60000).toISOString();
    task=applyDispatchAction(task,input,actor,people,at);
    await saveDispatchTask(client,task);
    const parts=task.partsRequests?.find(p=>p.ownerId===actor.id);
    await client.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail,at) values($1,$2,$3,$4,$5,$6,$7,$8)`,[id,actor.id,actor.name,input.requestId,JSON.stringify(input),action,JSON.stringify({stage:task.stage,items:task.items,partsRequirement:parts,note:'本地多人用料模拟数据'}),at]);
  }
  await act(advisor,'assign',{technicianIds:[a.id,b.id],dueAt:new Date(now+48*3600000).toISOString(),repairItems:task.items.map((item,index)=>({id:item.id,name:item.name,responsibleId:index===0?a.id:b.id})),note:'【模拟】每人三项配件，初始全部待备料，可分批勾选。'});
  const requirement=items=>({mode:'list',photoIds:[],items:items.map(([name,quantity,unit])=>({name,quantity,unit}))});
  await act(a,'accept',{partsRequirement:requirement([['机油',4,'升'],['机油滤芯',1,'个'],['空气滤芯',1,'个']])});
  await act(b,'record-parts',{partsRequirement:requirement([['前刹车片',1,'套'],['刹车油',2,'瓶'],['砂轮片',2,'片']])});
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,advisor.name,'创建本地多人用料模拟单，未发送外部通知']);
  return {id,plate,dispatchNo,stage:task.stage,requests:task.partsRequests.map(p=>({owner:p.ownerName,items:p.items})),url:`http://localhost:5173/?dispatchOrder=${id}`};
}
