import test from 'node:test';
import assert from 'node:assert/strict';
import {sendWorkNotification,queryWorkNotification,messageBody,notificationConfiguration} from '../server/integrations/dingtalk/notifications.mjs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {notificationNextState}=await import('../server/repositories/dispatchNotificationRepository.mjs');
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const env={DISPATCH_NOTIFICATION_MODE:'dingtalk',APP_ENV:'test',DINGTALK_AGENT_ID:'123',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://repair.example/app'};
const notification={id:'n',payload:{orderId:'WT-1',plate:'鲁B12345',summary:'制动维修',dueAt:'2026-09-11T10:00:00Z'},kind:'新派工'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const options=fetcher=>({env,fetcher,token:async()=>'test-token'});

test('notification links use internal order ID and never expose credentials',()=>{
  const body=messageBody(notification,'worker',env);
  assert.equal(new URL(body.msg.markdown.text.match(/\[查看维修任务\]\(([^)]+)\)/)[1]).searchParams.get('dispatchOrder'),'WT-1');
  assert.equal(body.to_all_user,false);assert.equal(body.userid_list,'worker');
  assert.doesNotMatch(JSON.stringify(body),/test-token|APP_SECRET/);
  assert.throws(()=>notificationConfiguration({...env,APP_ENV:'production',DISPATCH_NOTIFICATION_MODE:'mock'}));
  assert.equal(notificationConfiguration({...env,DISPATCH_APP_URL:'http://120.26.195.38/'}),'dingtalk');
  assert.throws(()=>notificationConfiguration({...env,DISPATCH_APP_URL:'ftp://120.26.195.38/'}));
  assert.throws(()=>notificationConfiguration({...env,DISPATCH_APP_URL:'http://user:password@120.26.195.38/'}));
});
test('notification entry preserves enterprise context and task across HTTP IP links',()=>{
  const linkFor=config=>new URL(messageBody(notification,'worker',config).msg.markdown.text.match(/\[查看维修任务\]\(([^)]+)\)/)[1]);
  const config={...env,DISPATCH_APP_URL:'http://120.26.195.38:8788/?corpid=$CORPID$&source=notification',DINGTALK_CORP_ID:'ding-enterprise'};
  const link=linkFor(config);
  assert.equal(link.origin,'http://120.26.195.38:8788');
  assert.equal(link.searchParams.get('corpid'),'ding-enterprise');
  assert.equal(link.searchParams.get('dispatchOrder'),'WT-1');
  assert.equal(link.searchParams.get('source'),'notification');
  assert.equal(linkFor({...config,DINGTALK_CORP_ID:undefined,VITE_DINGTALK_CORP_ID:'ding-fallback'}).searchParams.get('corpid'),'ding-fallback');
  assert.equal(linkFor({...env,DISPATCH_APP_URL:'https://repair.example/?corpid=ding-explicit'}).searchParams.get('corpid'),'ding-explicit');
});
test('async acceptance is distinct from successful sending and worker acceptance',async()=>{
  const result=await sendWorkNotification(notification,'worker',options(async()=>response({errcode:0,task_id:99})));
  assert.deepEqual(result,{status:'accepted',taskId:'99'});
  const confirmed=await queryWorkNotification({...notification,task_id:'99'},'worker',options(async()=>response({errcode:0,send_result:{unread_user_id_list:['worker']}})));
  assert.equal(confirmed.status,'sent');
});
test('network interruption and 5xx results never trigger blind resend',async()=>{
  for(const fetcher of [async()=>{throw new Error('network');},async()=>response({},502)]){
    const result=await sendWorkNotification(notification,'worker',options(fetcher));
    assert.equal(result.status,'unknown');assert.deepEqual(notificationNextState({attempts:1,polls:0},result),{status:'unknown',delay:null});
  }
});
test('explicit transient failure retries with a bound and queries have a separate bound',async()=>{
  const result=await sendWorkNotification(notification,'worker',options(async()=>response({},429)));
  assert.equal(result.retryable,true);assert.equal(notificationNextState({attempts:1},result).status,'pending');
  assert.equal(notificationNextState({attempts:5},result).status,'failed');
  assert.equal(notificationNextState({attempts:1,polls:20,task_id:'99'},{status:'accepted'}).delay,null);
  assert.equal(notificationNextState({attempts:1,polls:20,task_id:'99'},{status:'accepted'}).status,'unknown');
});
test('unknown task with platform ID is queried after restart instead of resent',async()=>{
  const row={...notification,previous_status:'unknown',task_id:'99',recipient_id:'u'};
  let sent=0,queried=0,finished;
  await processNotification({claim:async()=>row,recipient:async()=>({active:true,dingtalk_user_id:'worker'}),send:async()=>{sent++;},query:async()=>{queried++;return {status:'sent'};},finish:async(_row,result)=>{finished=result;}});
  assert.equal(sent,0);assert.equal(queried,1);assert.equal(finished.status,'sent');
});
test('inactive employee receives no new notification; malformed result remains unknown',async()=>{
  let sends=0,finished;
  await processNotification({claim:async()=>({...notification,previous_status:'pending'}),recipient:async()=>({active:false}),send:async()=>{sends++;},finish:async(_,result)=>{finished=result;}});
  assert.equal(sends,0);assert.equal(finished.status,'failed');
  assert.equal((await queryWorkNotification({...notification,task_id:'99'},'worker',options(async()=>response({errcode:0})))).status,'unknown');
});

test('obsolete due reminders are never sent and pre-send validation failures can retry safely',async()=>{
 const row={...notification,order_id:'WT-1',recipient_id:'t',kind:'即将到期',previous_status:'pending'};
 let sends=0,finished;
 const dependencies={claim:async()=>row,recipient:async()=>({active:true,role:'technician',id:'t'}),send:async()=>{sends++;return {status:'sent'};},finish:async(_,result)=>{finished=result;}};
 await processNotification({...dependencies,validateDue:async()=>false});assert.equal(sends,0);assert.equal(finished.status,'failed');assert.equal(finished.retryable,false);
 await processNotification({...dependencies,validateDue:async()=>{throw new Error('db unavailable');}});assert.equal(sends,0);assert.equal(finished.retryable,true);
 await processNotification({...dependencies,validateDue:async()=>true});assert.equal(sends,1);
});
test('scheduler notices include operator, reason and due reminders include a clear instruction',()=>{
 const text=messageBody({...notification,kind:'维修暂停',payload:{...notification.payload,actorName:'维修工甲',reason:'待配件：缺少滤芯'}},'scheduler',env).msg.markdown.text;
 assert.match(text,/操作人：维修工甲/);assert.match(text,/待配件：缺少滤芯/);
 assert.match(messageBody({...notification,kind:'即将到期',payload:{...notification.payload,notice:'工单将在1小时内到期，请尽快处理。'}},'t',env).msg.markdown.text,/请尽快处理/);
});

test('scheduler fanout checks role and store again before sending',async()=>{
 const {validateSchedulerRecipient}=await import('../server/workers/schedulerNotifications.mjs');
 const database={query:async()=>({rows:[{shop_id:'s'}]})};
 assert.equal(await validateSchedulerRecipient({order_id:'o'},{active:true,role:'advisor',shopId:'s'},{database}),true);
 assert.equal(await validateSchedulerRecipient({order_id:'o'},{active:true,role:'manager',shopId:'other'},{database}),false);
 let sends=0,result;
 await processNotification({claim:async()=>({...notification,kind:'维修暂停',previous_status:'pending'}),recipient:async()=>({active:true,role:'advisor',shopId:'other'}),validateScheduler:async()=>false,send:async()=>sends++,finish:async(_,r)=>{result=r;}});
 assert.equal(sends,0);assert.equal(result.retryable,false);
});

test('parts notifications reject recipients who lost warehouse or shop membership',async()=>{
 for(const user of [{active:true,role:'technician',shopId:'s'},{active:true,role:'warehouse',shopId:'other'},{active:false,role:'warehouse',shopId:'s'}]) {
   let result,sent=false;
   await processNotification({claim:async()=>({id:'parts',kind:'配件申请',previous_status:'pending',recipient_id:'w',payload:{shopId:'s'}}),recipient:async()=>user,send:async()=>{sent=true;},finish:async(_row,value)=>{result=value;}});
   assert.equal(sent,false);assert.equal(result.status,'failed');
 }
});

test('pickup and issue notices check the current request, round, handler and handover state',async()=>{
 const {validatePartsPickupNotification:validate}=await import('../server/repositories/partsRequirementRepository.mjs');
 const user={id:'t',active:true,role:'technician',shopId:'s'};
 const row={order_id:'o',recipient_id:'t',kind:'配件可领取',payload:{shopId:'s',repairRound:1,partsRecordedAt:'at',partsRevision:3}};
 const task={stage:'待开工',technician_id:'t',data:{repairRound:1,technicianIds:['t'],partsRequirement:{mode:'list',recordedAt:'at',revision:3,preparedAt:'ready'}}};
 const database={query:async()=>({rows:[task]})};
 assert.equal(await validate(row,user,database),true);
 for(const patch of [{active:false},{role:'inspector'},{shopId:'other'}])assert.equal(await validate(row,{...user,...patch},database),false);
 task.data.partsRequirement.revision=4;assert.equal(await validate(row,user,database),false);task.data.partsRequirement.revision=3;
 task.data.repairRound=2;assert.equal(await validate(row,user,database),false);task.data.repairRound=1;
 task.data.technicianIds=['other'];assert.equal(await validate(row,user,database),false);task.data.technicianIds=['t'];
 task.data.partsRequirement.issuedAt='issued';assert.equal(await validate(row,user,database),false);
 assert.equal(await validate({...row,kind:'配件已出库'},user,database),true);
 task.stage='待派工';assert.equal(await validate({...row,kind:'配件已出库'},user,database),false);
});
test('obsolete pickup messages are canceled before sending; database failures remain retryable',async()=>{
 const row={...notification,kind:'配件可领取',previous_status:'pending'};
 let sent=0,finished;
 const deps={claim:async()=>row,recipient:async()=>({active:true}),send:async()=>{sent++;return {status:'sent'};},finish:async(_,r)=>{finished=r;}};
 await processNotification({...deps,validateParts:async()=>false});assert.equal(sent,0);assert.equal(finished.retryable,false);
 await processNotification({...deps,validateParts:async()=>{throw new Error('db unavailable');}});assert.equal(sent,0);assert.equal(finished.retryable,true);
 await processNotification({...deps,validateParts:async()=>true});assert.equal(sent,1);
});

test('inspection delivery rechecks manager rights, shop, participants and current task state',async()=>{
 const {validateInspectionRecipient:validate}=await import('../server/repositories/dispatchRepository.mjs');
 const user={id:'m',active:true,role:'manager',shopId:'s',inspectorRoleMember:false};
 const row={id:'inspection',order_id:'o',recipient_id:'m',kind:'待检验',previous_status:'pending'};
 const task={order_id:'o',shop_id:'s',order_status:'维修中',stage:'待检验',technician_id:'t',repair_items:[],data:{items:[{id:1,status:'待检验',responsibleId:'t'}]}};
 const database={query:async()=>({rows:[task]})};
 assert.equal(await validate(row,user,database),true);
 for(const patch of [{active:false},{shopId:'other'},{role:'advisor'},{role:'inspector',inspectorRoleMember:false}]) {
  assert.equal(await validate(row,{...user,...patch},database),false);
 }
 for(const data of [{participantIds:['m']},{technicianIds:['m']},{items:[{id:1,responsibleId:'m'}]},{items:[{id:1,startedBy:'m'}]},{items:[{id:1,finishedBy:'m'}]},{needsReview:true}]) {
  assert.equal(await validate(row,user,{query:async()=>({rows:[{...task,data:{...task.data,...data}}]})}),false);
 }
 for(const patch of [{stage:'维修完成'},{stage:'回审'},{inspector_id:'other'},{order_status:'待客户签字'}]) {
  assert.equal(await validate(row,user,{query:async()=>({rows:[{...task,...patch}]})}),false);
 }
 assert.equal(await validate(row,user,{query:async()=>({rows:[]})}),false);
 assert.equal(await validate(row,user,{query:async()=>({rows:[{...task,inspector_id:'m'}]})}),true);
 let sent=0,finished;
 const deps={claim:async()=>row,recipient:async()=>user,send:async()=>{sent++;return {status:'sent'};},finish:async(_,r)=>{finished=r;}};
 await processNotification({...deps,validateInspection:(r,u)=>validate(r,u,database)});
 assert.equal(sent,1);assert.equal(finished.status,'sent');
 await processNotification({...deps,validateInspection:async()=>false});
 assert.equal(sent,1);assert.equal(finished.retryable,false);
 await processNotification({...deps,validateInspection:async()=>{throw new Error('db unavailable');}});
 assert.equal(sent,1);assert.equal(finished.retryable,true);
});

test('additional repair notices cancel after reassignment, shop transfer, completion or a later round',async()=>{
 const {validateAddedRepairRecipient:validate}=await import('../server/repositories/dispatchNotificationRepository.mjs');
 const user={id:'t',active:true,role:'technician',shopId:'s'};
 const row={order_id:'o',recipient_id:'t',kind:'新增维修项目',previous_status:'pending',payload:{repairRound:1,itemIds:[1000000000]}};
 const task={shop_id:'s',stage:'维修中',data:{repairRound:1,technicianIds:['t','other'],items:[{id:1000000000,name:'追加项目',status:'待开工',responsibleId:'t'}]}};
 const database={query:async()=>({rows:[task]})};
 assert.equal(await validate(row,user,database),true);
 for(const patch of [{active:false},{shopId:'other'},{role:'advisor'},{id:'other'}])assert.equal(await validate(row,{...user,...patch},database),false);
 for(const data of [{repairRound:2},{technicianIds:['other']},{items:[]},{items:[{id:1000000000,status:'已完工',responsibleId:'t'}]},{items:[{id:1000000000,status:'待开工',responsibleId:'other'}]}]) {
  assert.equal(await validate(row,user,{query:async()=>({rows:[{...task,data:{...task.data,...data}}]})}),false);
 }
 assert.equal(await validate(row,user,{query:async()=>({rows:[{...task,stage:'维修完成'}]})}),false);
 const contractor={...user,role:'outsourcing'};
 const outsourced={...task,data:{...task.data,executionMode:'outsourced'}};
 assert.equal(await validate(row,contractor,{query:async()=>({rows:[outsourced]})}),true);
 assert.equal(await validate(row,user,{query:async()=>({rows:[outsourced]})}),false);
 const legacyOutsourced={...task,data:{...task.data,executionMode:'outsourced',technicianIds:[],items:[{id:1000000000,status:'待开工'}]}};
 assert.equal(await validate(row,{...user,role:'manager'},{query:async()=>({rows:[legacyOutsourced]})}),true);
 for(const kind of ['新增维修项目','追加维修派工']) {
  let sent=0,finished;
  const deps={claim:async()=>({...row,kind}),recipient:async()=>user,send:async()=>{sent++;return {status:'sent'};},finish:async(_,r)=>{finished=r;}};
  await processNotification({...deps,validateAddedRepair:async()=>false});assert.equal(sent,0);assert.equal(finished.retryable,false);
  await processNotification({...deps,validateAddedRepair:async()=>{throw new Error('db unavailable');}});assert.equal(sent,0);assert.equal(finished.retryable,true);
  await processNotification({...deps,validateAddedRepair:async()=>true});assert.equal(sent,1);
 }
});
