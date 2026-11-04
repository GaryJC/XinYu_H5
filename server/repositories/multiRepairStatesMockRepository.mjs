import {applyDispatchAction} from '../domain/dispatchPolicy.mjs';
import {saveDispatchTask} from './dispatchRepository.mjs';
import {partsStatus} from '../../shared/warehouseRequests.mjs';

// The entry script validates local storage and the development database first.
export async function seedMultiRepairStates(client,photos) {
  await client.query("select pg_advisory_xact_lock(hashtext('multi-repair-states-20261104'))");
  const ids=['u_dev_advisor','u_dev_technician','u_demo_parts_technician_b','u_dev_warehouse','u_dev_inspector','u_dev_manager'];
  const roles=['advisor','technician','technician','warehouse','inspector','manager'];
  const {rows}=await client.query('select id,name,role,active,shop_id as "shopId" from users where id=any($1)',[ids]);
  const people=ids.map((id,index)=>{
    const person=rows.find(row=>row.id===id);
    if(!person?.active||person.shopId!=='shop-hq'||person.role!==roles[index])throw new Error(`请核对本地测试身份：${id}`);
    return person;
  });
  const [advisor,a,b,warehouse,inspector]=people;
  // Only this local mock account gets a synthetic binding; do not query Runfeng
  // or overwrite any existing employee binding while preparing test data.
  await client.query(`update users set legacy_employee_code='DM002',legacy_employee_name=$2,
    legacy_employee_department='本地测试（非润丰员工）',legacy_employee_bound_at=now()
    where id=$1 and legacy_employee_code is null and dingtalk_user_id is null`,[b.id,b.name]);
  const scenarios=['两人均待备料','甲部分备齐，乙待备料','甲全部备齐，乙部分备齐','甲已提检，乙待备料','甲已通过检验，乙部分备齐','甲部分备齐但暂停，乙待备料'];
  const now=Date.now(),today=new Date(now+8*3600000).toISOString().slice(0,10),results=[];
  for(const [index,scenario] of scenarios.entries()) {
    const suffix=String(index+1).padStart(2,'0'),id=`WT-DUMMY-MULTI-20261104-${suffix}`,plate=`鲁B测料${suffix}`,dispatchNo=`DUMMY-MP-${suffix}`;
    if((await client.query('select 1 from work_orders where id=$1',[id])).rowCount){results.push({id,plate,dispatchNo,scenario,created:false});continue;}
    const fault=`【本地测试】${scenario}；甲：${a.name}，乙：${b.name}。`;
    await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,shop_name,old_parts_handling,vehicle_plate,vehicle_model,vehicle_mileage,customer_name,arrival_date,dispatch_no,fault_description,fee_note)
      values($1,'已委托',$2,'待派工','待检验',$3,'抚顺路店','环保处理',$4,'【测试】多人备料验证车','52600','【测试】多人维修备料车队',$5,$6,$7,'LOCAL-MULTI-REPAIR-STATES-20261104')`,[id,advisor.name,advisor.shopId,plate,today,dispatchNo,fault]);
    for(const photo of photos) {
      const owner=photo.key==='b'?b:a,kind=photo.key==='nameplate'?'vehicle_nameplate_photo':'repair_progress_photo';
      await client.query(`insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by,repair_round)
        values($1,$2,$3,'local','local',$4,$5,'image/jpeg',$6,$7,0)`,[`${id}-${photo.key}`,id,kind,photo.objectKey,photo.key==='nameplate'?'【测试占位】车辆铭牌.jpg':`【测试占位】${owner.name}维修记录.jpg`,photo.sizeBytes,owner.id]);
    }
    let task={orderId:id,shopId:advisor.shopId,orderStatus:'已委托',stage:'待派工',version:0,plate,dispatchNo,arrivalDate:today,faultDescription:fault,vehicleNameplateFileId:`${id}-nameplate`,
      items:[{id:1,name:'【测试】机油机滤保养',status:'待派工'},{id:2,name:'【测试】发动机进气检查',status:'待派工'},{id:3,name:'【测试】制动系统检修',status:'待派工'}]};
    const act=async(actor,action,extra={})=>{
      const at=new Date(now-60*60000+task.version*5*60000).toISOString();
      const input={action,expectedVersion:task.version,requestId:`dummy-mp-${suffix}-${task.version}`,...extra};
      task=applyDispatchAction(task,input,actor,people,at);
      await saveDispatchTask(client,task);
      const owner=input.partsOwnerId||actor.id;
      await client.query('insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail,at) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,actor.id,actor.name,input.requestId,JSON.stringify(input),action,
        JSON.stringify({stage:task.stage,items:task.items,partsRequirement:task.partsRequests?.find(parts=>parts.ownerId===owner),partsPreparation:input.partsPreparation,technicianName:task.technicianName,inspectorName:task.inspectorName,note:input.note||'本地测试数据',pauseReason:input.pauseReason,dueAt:task.dueAt}),at]);
    };
    const requirement=lines=>({mode:'list',photoIds:[],items:lines.map(([name,quantity,unit])=>({name,quantity,unit}))});
    const prepare=(worker,indices)=>act(warehouse,'confirm-parts',{partsOwnerId:worker.id,partsPreparation:indices.map(index=>({index,recipientId:worker.id}))});
    await act(advisor,'assign',{technicianIds:[a.id,b.id],dueAt:new Date(now+48*3600000).toISOString(),note:`【测试】${scenario}`,repairItems:task.items.map(item=>({id:item.id,name:item.name,responsibleId:item.id<3?a.id:b.id}))});
    await act(a,'accept',{partsRequirement:requirement([['机油',4,'升'],['机油滤芯',1,'个'],['空气滤芯',1,'个']])});
    await act(b,'record-parts',{partsRequirement:requirement([['刹车片',1,'套'],['刹车油',2,'瓶'],['皮带',1,'条']])});
    if(index===5)await act(a,'pause',{pauseReason:'待配件',note:'【测试】配件部分到货后仍保持本人暂停，可测试恢复维修'});
    if([1,5].includes(index))await prepare(a,[0]);
    if([2,3,4].includes(index))await prepare(a,[0,1,2]);
    if([2,4].includes(index))await prepare(b,[0]);
    if([3,4].includes(index))await act(a,'submit-order',{note:'【测试】本人项目已完成，申请先行检验'});
    if(index===4){await act(inspector,'claim-inspection');await act(inspector,'inspect');}
    await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,advisor.name,`创建本地多人备料测试单：${scenario}；未发送外部通知或同步`]);
    results.push({id,plate,dispatchNo,scenario,created:true,stage:task.stage,workers:[a,b].map(worker=>({id:worker.id,name:worker.name,paused:Boolean(task.workerPauses?.[worker.id]),parts:partsStatus(task.partsRequests.find(parts=>parts.ownerId===worker.id)),items:task.items.filter(item=>item.responsibleId===worker.id).map(item=>item.status)}))});
  }
  return {people:people.map(({id,name,role})=>({id,name,role})),orders:results};
}
