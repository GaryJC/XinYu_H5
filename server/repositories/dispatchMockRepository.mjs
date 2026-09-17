import { applyDispatchAction } from '../domain/dispatchPolicy.mjs';
import { saveDispatchTask } from './dispatchRepository.mjs';

// Local fixtures only. Caller must validate the destination before opening a connection.
export async function seedTechnicianMocks(client) {
  const shopId='shop-hq';
  const people=[
    {id:'u_dev_technician',name:'维修工（测试）',role:'technician',active:true,shopId},
    {id:'u_dev_advisor',name:'张三（测试）',role:'advisor',active:true,shopId},
    {id:'u_dev_inspector',name:'检验员（测试）',role:'inspector',active:true,shopId}
  ];
  for(const person of people) {
    await client.query('insert into users(id,name,role,shop_id,active) values($1,$2,$3,$4,true) on conflict(id) do nothing',[person.id,person.name,person.role,shopId]);
    const {rows:[existing]}=await client.query('select name,role,shop_id,active from users where id=$1',[person.id]);
    if(!existing.active || existing.role!==person.role || existing.shop_id!==shopId) throw new Error('测试身份已被调整，请先核对测试账号');
    person.name=existing.name;
  }
  const [technician,advisor,inspector]=people;
  const scenarios=[['待接单','更换机油机滤'],['待开工','检查空调'],['维修中','制动系统检修'],['暂停','外派维修冷却系统'],['待检验','轮胎及四轮定位'],['返工','转向系统异响'],['待工时','发动机常规保养']];
  const result=[];
  for(const [index,[scenario,itemName]] of scenarios.entries()) {
    const id=`WT-MOCK-TECH-${String(index+1).padStart(2,'0')}`;
    const existing=await client.query('select id from work_orders where id=$1',[id]);
    if(existing.rowCount) {result.push({id,scenario,created:false});continue;}
    const now=new Date(),today=now.toISOString().slice(0,10),dueAt=new Date(now.getTime()+86400000).toISOString();
    const plate=`鲁B9000${index+1}`;
    await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate,arrival_date,fault_description,fee_note)
      values($1,'已委托',$2,'待派工','待检验',$3,'客户带走',$4,$5,$6,'LOCAL-TECHNICIAN-MOCK')`,[id,advisor.name,shopId,plate,today,`【本地模拟】${scenario} · ${itemName}`]);
    await client.query("insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,1,1,$2,'待派工')",[id,`【模拟】${itemName}`]);
    let task={orderId:id,shopId,orderStatus:'已委托',stage:'待派工',version:0,plate,dispatchNo:'',arrivalDate:today,faultDescription:`【本地模拟】${scenario}`,items:[{id:1,name:`【模拟】${itemName}`,status:'待派工'}]};
    const events=[];
    const act=(actor,action,extra={})=>{
      const input={action,expectedVersion:task.version,requestId:`mock-${index}-${task.version}`, ...extra};
      task=applyDispatchAction(task,input,actor,people);
      events.push({actor,input,stage:task.stage});
    };
    act(advisor,'assign',{technicianIds:[technician.id],dueAt,note:`本地模拟：${scenario}`,urgent:index===0,...(scenario==='暂停'?{executionMode:'field',serviceUnit:'模拟客户车队',serviceAddress:'模拟维修场地'}:{})});
    if(scenario!=='待接单') act(technician,'accept');
    if(!['待接单','待开工'].includes(scenario)) act(technician,'start',{itemId:1});
    if(scenario==='暂停') act(technician,'pause',{pauseReason:'待配件'});
    if(['待检验','返工','待工时'].includes(scenario)) {act(technician,'finish',{itemId:1});act(technician,'submit',{inspectorId:inspector.id});}
    if(scenario==='返工') act(inspector,'inspect',{rejectedItemIds:[1],reason:'模拟检验：异响仍存在，请复检'});
    if(scenario==='待工时') act(inspector,'inspect');
    await saveDispatchTask(client,task);
    for(const event of events) await client.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values($1,$2,$3,$4,$5,$6,$7)`,[id,event.actor.id,event.actor.name,event.input.requestId,JSON.stringify(event.input),event.input.action,JSON.stringify({stage:event.stage,note:'本地模拟数据',reason:event.input.reason,itemId:event.input.itemId})]);
    await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,advisor.name,`创建本地维修技师模拟工单：${scenario}`]);
    result.push({id,scenario,created:true});
  }
  return result;
}
