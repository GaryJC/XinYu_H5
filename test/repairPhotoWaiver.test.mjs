import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction,validateDispatchRequest} from '../server/domain/dispatchPolicy.mjs';
import {hasApprovedPhotoWaiver,currentPhotoWaiver,pendingPhotoWaivers,canRequestPhotoWaiver} from '../shared/repairPhotoWaiver.mjs';
import {countDispatchTaskStatuses,filterDispatchTasks} from '../server/domain/dispatchTaskFilters.mjs';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {assertRepairPhotoRecorded,saveDispatchTask}=await import('../server/repositories/dispatchRepository.mjs');
const worker={id:'a',name:'甲',role:'technician',shopId:'s',active:true};
const peer={...worker,id:'b',name:'乙'};
const manager={...worker,id:'m',name:'管理员',role:'manager'};
const advisor={...manager,id:'d',name:'顾问',role:'advisor'};
const inspector={...manager,id:'i',name:'检验员',role:'inspector'};
const people=[worker,peer,manager,advisor,inspector];
const task=()=>({orderId:'o',shopId:'s',plate:'鲁B12345',dispatchNo:'123',orderStatus:'维修中',stage:'维修中',version:1,executionMode:'field',assignedAt:'2026-11-10T00:00:00Z',technicianId:'a',technicianIds:['a','b'],items:[{id:1,name:'检修',status:'维修中',responsibleId:'a'},{id:2,name:'保养',status:'维修中',responsibleId:'b'}]});
const body=(t,action,extra={})=>({action,expectedVersion:t.version,requestId:'request-1234',...extra});
const request=(t=task(),actor=worker)=>applyDispatchAction(t,body(t,'request-photo-waiver',{requestId:actor.id==='a'?'request-1234':`request-${actor.id}-1234`,reason:'现场禁止拍照，手机上交'}),actor,people);
const decide=(t,actor=advisor,action='approve-photo-waiver',extra={})=>applyDispatchAction(t,body(t,action,{requestId:'decision-1234',waiverId:t.repairPhotoWaivers[0].id,...extra}),actor,people);
test('manager/advisor can approve another current worker; pending and rejection never waive photos',async()=>{
 const requested=request();assert.equal(hasApprovedPhotoWaiver(requested,'a'),false);
 for(const actor of [manager,advisor]) {
  const approved=decide(requested,actor);assert.equal(hasApprovedPhotoWaiver(approved,'a'),true);assert.equal(hasApprovedPhotoWaiver(approved,'b'),false);
  assert.equal(approved.version,requested.version+1);assert.deepEqual(approved.items,requested.items);assert.equal(approved.stage,requested.stage);
  const noPhotos={query:async()=>({rows:[]})};
  await assertRepairPhotoRecorded(noPhotos,approved,'a','a');
  await assert.rejects(()=>assertRepairPhotoRecorded(noPhotos,approved,'b','b'),e=>e.status===409);
  await assert.rejects(()=>assertRepairPhotoRecorded(noPhotos,requested,'a','a'),e=>e.status===409);
 }
 const rejected=decide(requested,advisor,'reject-photo-waiver',{reason:'请说明不能拍照的原因'});
 assert.equal(hasApprovedPhotoWaiver(rejected,'a'),false);assert.equal(request(rejected).repairPhotoWaivers[0].status,'pending');
 assert.throws(()=>request(requested),e=>e.status===409);
 assert.throws(()=>request(decide(requested)),e=>e.status===409);
 assert.throws(()=>decide(decide(requested)),e=>e.status===409);
});
test('approval authorization rejects self, wrong role, cross-shop, disabled and stale versions',()=>{
 const requested=request();
 for(const actor of [{...worker,roles:['technician','manager']},inspector,peer,{...manager,shopId:'other'},{...manager,active:false}])assert.throws(()=>decide(requested,actor),e=>e.status===403);
 assert.throws(()=>applyDispatchAction(requested,body(task(),'approve-photo-waiver',{waiverId:request().repairPhotoWaivers[0].id}),advisor,people),e=>e.status===409);
 for(const applicant of [{...worker,active:false},{...worker,role:'employee'},{...worker,shopId:'elsewhere'}])assert.throws(()=>applyDispatchAction(requested,body(requested,'approve-photo-waiver',{waiverId:request().repairPhotoWaivers[0].id}),advisor,[applicant,advisor]),e=>e.status===409);
 for(const actor of [peer,manager,advisor,inspector])if(actor.id!=='b')assert.equal(canRequestPhotoWaiver(task(),actor),false);
});
test('scope cannot survive round, rework, reassignment or project changes; normal progress is stable',async()=>{
 const approved=decide(request());
 const changes=[t=>t.repairRound=1,t=>t.assignedAt='later',t=>t.executionMode='outsourced',t=>t.technicianIds=['b'],t=>t.items[0].responsibleId='b',t=>t.items[0].name='换新项目',t=>t.items.push({id:3,name:'追加',responsibleId:'a',status:'维修中'})];
 for(const change of changes){const next=structuredClone(approved);change(next);assert.equal(hasApprovedPhotoWaiver(next,'a'),false);assert.equal(currentPhotoWaiver(next,'a'),undefined);}
 const normal=structuredClone(approved);normal.items[0].status='待检验';normal.dueAt='later';normal.version++;assert.equal(hasApprovedPhotoWaiver(normal,'a'),true);
 const changed=structuredClone(approved);changed.items[0].responsibleId='b';
 await saveDispatchTask({query:async()=>({rows:[]})},changed,{metadataOnly:true});
 changed.items[0].responsibleId='a';assert.equal(hasApprovedPhotoWaiver(changed,'a'),false,'restoring an old assignment must not revive an approval');
 const submitted={...approved,stage:'待检验',items:approved.items.map(i=>({...i,status:'待检验'})),workerSubmissions:{a:{at:'now'}}};
 const review=applyDispatchAction(submitted,body(submitted,'send-review'),inspector,people);
 assert.equal(hasApprovedPhotoWaiver(review,'a'),false);
});
test('photo gate validates post-edit scope and does not accept peer approval for shared-photo tasks',async()=>{
 const approved=decide(request());const noPhotos={query:async()=>({rows:[]})};
 const edited=structuredClone(approved);edited.items[0].name='新项目';
 await assert.rejects(()=>assertRepairPhotoRecorded(noPhotos,approved,'a','a',edited),e=>e.status===409);
 await assert.rejects(()=>assertRepairPhotoRecorded(noPhotos,approved,undefined,'b'),e=>e.status===409);
 await assert.rejects(()=>assertRepairPhotoRecorded(noPhotos,approved),e=>e.status===409);
 await assertRepairPhotoRecorded({query:async()=>({rows:[{}]})},task(),'a','a');
});
test('strict request body rejects blank reasons and forged approvals',()=>{
 for(const extra of [{reason:''},{reason:'  '},{reason:'x'.repeat(1001)},{reason:3},{reason:'原因',repairPhotoWaivers:[{status:'approved'}]},{reason:'原因',repairItems:[]},{reason:'原因',waiverId:'forged'}])assert.throws(()=>validateDispatchRequest(body(task(),'request-photo-waiver',extra)),e=>e.status===400);
 assert.throws(()=>validateDispatchRequest(body(task(),'approve-photo-waiver')),e=>e.status===400);
 assert.throws(()=>validateDispatchRequest(body(task(),'reject-photo-waiver',{waiverId:request().repairPhotoWaivers[0].id,reason:''})),e=>e.status===400);
});
test('pending queue includes all pages, excludes own/expired/submitted requests, and retains rework applications',()=>{
 const rows=Array.from({length:25},(_,i)=>request({...task(),orderId:`o${i}`}));
 assert.equal(filterDispatchTasks(rows,advisor,{stage:'无照片待审批'}).length,25);
 assert.equal(countDispatchTaskStatuses(rows,advisor)['无照片待审批'],25);
 assert.equal(filterDispatchTasks(rows,worker,{stage:'无照片待审批'}).length,0);
 const changed=structuredClone(rows[0]);changed.repairRound=1;assert.equal(pendingPhotoWaivers(changed).length,0);
 changed.workerSubmissions={a:{at:'previous'}};
 assert.equal(pendingPhotoWaivers(request(changed)).length,1,'old submission must not hide a new rework application');
 const submitted=structuredClone(rows[0]);submitted.items[0].status='待检验';submitted.workerSubmissions={a:{at:'now'}};
 assert.equal(pendingPhotoWaivers(submitted).length,0);assert.equal(canRequestPhotoWaiver(submitted,worker),false);
});
test('outsourced completion exemption belongs to its internal applicant and also forbids self approval',()=>{
 const external={...task(),executionMode:'outsourced',assignedBy:advisor.id};
 const applied=request(external,advisor);const approved=decide(applied,manager);
 assert.equal(hasApprovedPhotoWaiver(approved,advisor.id),true);assert.equal(hasApprovedPhotoWaiver(approved,manager.id),false);
 assert.throws(()=>decide(applied,advisor),e=>e.status===403);
});

test('photo approval does not waive unprepared parts or signature and historical reconciliation gates',()=>{
 const approved=decide(request());
 const waiting={...approved,partsRequests:[{ownerId:'a',mode:'list',items:[{name:'配件',quantity:1,unit:'件'}],photoIds:[]}]};
 assert.throws(()=>applyDispatchAction(waiting,body(waiting,'submit-order'),worker,people),error=>error.status===409&&/配件/.test(error.message));
 for(const extra of [{orderStatus:'待客户签字'},{needsReview:true},{stage:'维修完成'}])assert.throws(()=>request({...task(),...extra}));
});

test('a returned worker loses their approval without revoking a coworker exemption',()=>{
 let current=decide(request());current=request(current,peer);
 current=applyDispatchAction(current,body(current,'approve-photo-waiver',{waiverId:current.repairPhotoWaivers.find(e=>e.applicantId==='b').id}),manager,people);
 current.items[0].status='待检验';
 const returned=applyDispatchAction(current,body(current,'inspect',{rejectedItemIds:[1],reason:'重新检修'}),manager,people);
 assert.equal(hasApprovedPhotoWaiver(returned,'a'),false);assert.equal(hasApprovedPhotoWaiver(returned,'b'),true);
 const inactive=applyDispatchAction(request(),body(request(),'reject-photo-waiver',{waiverId:request().repairPhotoWaivers[0].id,reason:'员工已停用'}),advisor,[{...worker,active:false},advisor]);
 assert.equal(currentPhotoWaiver(inactive,'a').status,'rejected');
});

test('identical client request IDs from different workers cannot target the wrong applicant',()=>{
 let current=request();
 current=applyDispatchAction(current,body(current,'request-photo-waiver',{reason:'手机镜头遮挡'}),peer,people);
 const [a,b]=current.repairPhotoWaivers;assert.notEqual(a.id,b.id);
 current=applyDispatchAction(current,body(current,'approve-photo-waiver',{waiverId:b.id}),advisor,people);
 assert.equal(currentPhotoWaiver(current,'a').status,'pending');assert.equal(hasApprovedPhotoWaiver(current,'b'),true);
 const ambiguous=request();ambiguous.repairPhotoWaivers.push({...ambiguous.repairPhotoWaivers[0],applicantId:'b'});
 assert.throws(()=>decide(ambiguous),e=>e.status===409);
});
test('project reassignment away and back cannot revive approval; unaffected coworkers retain it',async()=>{
 let current=decide(request());current=request(current,peer);current=applyDispatchAction(current,body(current,'approve-photo-waiver',{waiverId:currentPhotoWaiver(current,'b').id}),advisor,people);
 const third={...worker,id:'c'};const roster=[...people,third];
 for(const owner of ['c','a']) {
  current=applyDispatchAction(current,body(current,'reassign',{reassignItemIds:[1],repairItems:[{id:1,name:'检修',responsibleId:owner}],reason:'项目交接'}),advisor,roster);
  await saveDispatchTask({query:async()=>({rows:[]})},current);
  assert.equal(hasApprovedPhotoWaiver(current,'a'),false);assert.equal(hasApprovedPhotoWaiver(current,'b'),true);
 }
});
test('review reapplication is personal; adding review work invalidates only the receiving worker',async()=>{
 let current=decide(request());current.stage='待检验';current.items=current.items.map(i=>({...i,status:'待检验'}));
 current=applyDispatchAction(current,body(current,'send-review'),inspector,people);
 assert.equal(hasApprovedPhotoWaiver(current,'a'),false);
 current=decide(request(current));current=request(current,peer);current=applyDispatchAction(current,body(current,'approve-photo-waiver',{waiverId:currentPhotoWaiver(current,'b').id}),advisor,people);
 current=applyDispatchAction(current,body(current,'edit-repair-items',{repairItems:[...current.items.map(({id,name,responsibleId})=>({id,name,responsibleId})),{name:'新增回审项目',responsibleId:'a'}]}),advisor,people);
 await saveDispatchTask({query:async()=>({rows:[]})},current);
 assert.equal(hasApprovedPhotoWaiver(current,'a'),false);assert.equal(hasApprovedPhotoWaiver(current,'b'),true);
});
