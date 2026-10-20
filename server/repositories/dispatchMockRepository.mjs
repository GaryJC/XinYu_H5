import { applyDispatchAction } from '../domain/dispatchPolicy.mjs';
import { saveDispatchTask } from './dispatchRepository.mjs';
import { saveRepairRound } from './repairRoundRepository.mjs';

// Local fixtures only. Caller validates the destination before opening a connection.
// A separate namespace preserves every existing WT-MOCK-TECH fixture and any testing progress.
export async function seedTechnicianMocks(client) {
  await client.query("select pg_advisory_xact_lock(hashtext('repair-demo-fixtures-v2'))");
  const shopId='shop-hq';
  const people=[
    {id:'u_dev_technician',name:'李富强',role:'technician',active:true,shopId},
    {id:'u_dev_advisor',name:'张三（测试）',role:'advisor',active:true,shopId},
    {id:'u_dev_inspector',name:'检验员（测试）',role:'inspector',active:true,shopId},
    {id:'u_dev_manager',name:'Gary（测试）',role:'manager',active:true,shopId}
  ];
  for(const person of people) {
    await client.query('insert into users(id,name,role,shop_id,active) values($1,$2,$3,$4,true) on conflict(id) do nothing',[person.id,person.name,person.role,shopId]);
    const {rows:[existing]}=await client.query('select name,role,shop_id,active from users where id=$1',[person.id]);
    if(!existing.active || existing.role!==person.role || existing.shop_id!==shopId) throw new Error('测试身份已被调整，请先核对测试账号');
    person.name=existing.name;
  }
  const [technician,advisor,inspector,manager]=people;
  const scenarios=[
    {label:'待接单｜快捷配件',stage:'待接单',items:['更换机油机滤','全车检查'],model:'五菱荣光',hours:48},
    {label:'待接单｜手写清单照片',stage:'待接单',items:['检修制动系统'],model:'江铃全顺',hours:24},
    {label:'待接单｜无需配件',stage:'待接单',items:['检查空调异响'],model:'大众桑塔纳',hours:1},
    {label:'维修中｜已有配件清单',stage:'维修中',items:['更换空气滤芯','常规保养'],model:'五菱宏光',hours:36},
    {label:'暂停｜外修待配件',stage:'暂停',items:['检修冷却系统'],model:'福特全顺',hours:18},
    {label:'待检验｜未领取',stage:'待检验',items:['轮胎及四轮定位'],model:'依维柯',hours:24},
    {label:'已完结｜可以发起返工',stage:'完成',items:['发动机保养','油路检查'],model:'五菱荣光',hours:48},
    {label:'返工第1轮｜待接单',stage:'返工',items:['转向系统检查','更换转向球头'],model:'江铃顺达',hours:24}
  ];
  const result=[],now=Date.now(),today=new Date(now+8*3600000).toISOString().slice(0,10);
  for(const [index,scenario] of scenarios.entries()) {
    const number=String(index+1).padStart(2,'0'),id=`WT-DEMO-REPAIR-${number}`,plate=`鲁B960${number}`;
    if((await client.query('select 1 from work_orders where id=$1',[id])).rowCount) {result.push({id,plate,scenario:scenario.label,created:false});continue;}
    const dispatchNo=`A9960${number}`,vin=`LSVNV2182E21234${String(index+10)}`,mileage=String(57162+index*7300),customerName=`【测试】托修单位${index+1}号车队`;
    const fault=`【测试数据】${scenario.label}；用于测试接单、配件登记、维修照片与检验，不是真实业务。`;
    await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,shop_name,old_parts_handling,vehicle_plate,vehicle_vin,vehicle_model,vehicle_mileage,customer_name,arrival_date,dispatch_no,fault_description,fee_note)
      values($1,'已委托',$2,'待派工','待检验',$3,'抚顺路店','客户带走',$4,$5,$6,$7,$8,$9,$10,$11,'LOCAL-REPAIR-DEMO-V2')`,[id,advisor.name,shopId,plate,vin,scenario.model,mileage,customerName,today,dispatchNo,fault]);
    const items=scenario.items.map((name,i)=>({id:i+1,name:`【测试】${name}`,status:'待派工'}));
    for(const [i,item] of items.entries())await client.query("insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,$2,$3,$4,'待派工')",[id,item.id,i+1,item.name]);
    let task={orderId:id,shopId,orderStatus:'已委托',stage:'待派工',version:0,plate,dispatchNo,arrivalDate:today,vehicleModel:scenario.model,vehicleMileage:mileage,customerName,advisor:advisor.name,faultDescription:fault,items};
    const act=async(actor,action,extra={})=>{
      const input={action,expectedVersion:task.version,requestId:`demo-v2-${number}-${task.version}`,...extra};
      const previous=task,at=new Date(now-2*3600000+task.version*5*60000).toISOString();
      task=applyDispatchAction(task,input,actor,people,at);
      await saveRepairRound(client,previous,task,actor,action);
      await saveDispatchTask(client,task);
      await client.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail,at) values($1,$2,$3,$4,$5,$6,$7,$8)`,[id,actor.id,actor.name,input.requestId,JSON.stringify(input),action,JSON.stringify({stage:task.stage,repairRound:task.repairRound,items:task.items,partsRequirement:task.partsRequirement,note:'本地测试数据',reason:input.reason,technicianName:task.technicianName,dueAt:task.dueAt}),at]);
    };
    const dueAt=new Date(now+scenario.hours*3600000).toISOString();
    await act(advisor,'assign',{technicianIds:[technician.id],dueAt,note:`【测试】${scenario.label}`,urgent:index===0,...(scenario.stage==='暂停'?{executionMode:'field',serviceUnit:customerName,serviceAddress:'【测试】客户车队维修场地'}:{})});
    if(scenario.stage!=='待接单') {
      await act(technician,'accept',{partsRequirement:{mode:'list',items:[{name:scenario.stage==='暂停'?'水泵':'机油',quantity:scenario.stage==='暂停'?1:4,unit:scenario.stage==='暂停'?'个':'升'},{name:'机油滤芯',quantity:1,unit:'个'}],photoIds:[]}});
      if(scenario.stage==='暂停')await act(technician,'pause',{pauseReason:'待配件',note:'【测试】等待配件到货后恢复维修'});
      if(['待检验','完成','返工'].includes(scenario.stage))await act(technician,'submit-order',{note:'【测试】维修完成，请检验'});
      if(['完成','返工'].includes(scenario.stage)) {
        await act(inspector,'claim-inspection');await act(inspector,'inspect');await act(advisor,'record-hours',{workHours:2.5});
        // This is a local fixture, not an actual settlement or external platform operation.
        await client.query("update work_orders set status='完成' where id=$1",[id]);task.orderStatus='完成';
        if(scenario.stage==='返工')await act(manager,'reopen-repair',{reworkItemIds:[1],additionalItems:['【测试】路试复查'],reason:'【测试】客户反馈转向仍有异响，安排原维修工复查',technicianIds:[technician.id],dueAt,executionMode:'internal',note:'【测试】返工单接单时请重新登记配件'});
      }
    }
    await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,advisor.name,`创建本地测试维修单：${scenario.label}`]);
    result.push({id,plate,dispatchNo,scenario:scenario.label,created:true});
  }
  return result;
}
