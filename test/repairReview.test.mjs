import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const tech={id:'t',name:'技师',role:'technician',shopId:'s',active:true};
const tech2={...tech,id:'t2',name:'技师二'};
const inspector={...tech,id:'i',name:'检验员',role:'inspector'};
const people=[tech,tech2,inspector];
const task=(stage='待检验')=>({orderId:'o',shopId:'s',orderStatus:stage==='维修完成'?'待结算':'维修中',stage,version:1,technicianIds:['t'],technicianId:'t',participantIds:['t'],inspectorId:'i',completedAt:'old',items:[{id:1,name:'原项目',status:stage==='维修完成'?'已完工':'待检验',responsibleId:'t',startAt:'old',finishAt:'old',inspectedBy:'i',inspectedAt:'old'}]});
const act=(t,action,actor=tech,extra={})=>applyDispatchAction(t,{action,expectedVersion:t.version,requestId:randomUUID(),...extra},actor,people,'2026-10-22T08:00:00Z');
for(const stage of ['待检验','维修完成'])test(`${stage} sends review, unlocks editing and returns to independent inspection`,()=>{
 const original=task(stage);
 let t=act(original,'send-review',inspector);
 assert.equal(t.stage,'回审');assert.equal(t.version,2);assert.equal(original.stage,stage);
 assert.equal(t.inspectorId,undefined);assert.equal(t.completedAt,undefined);assert.equal(t.items[0].inspectedAt,undefined);
 t=act(t,'edit-repair-items',tech,{repairItems:[{id:1,name:'修改项目',responsibleId:'t'},{name:'新增项目',responsibleId:'t'}]});
 assert.equal(t.stage,'回审');assert.equal(t.items[0].name,'修改项目');assert.equal(t.items[1].status,'维修中');
 t=act(t,'submit-review',tech,{repairItems:t.items.map(({id,name,responsibleId})=>({id,name,responsibleId})),note:'已核对'});
 assert.equal(t.stage,'待检验');assert.ok(t.items.every(i=>i.status==='待检验'));assert.equal(t.inspectorId,undefined);
 t=act(t,'claim-inspection',inspector);t=act(t,'inspect',inspector);
 assert.equal(t.stage,'维修完成');assert.ok(t.items.every(i=>i.inspectedBy==='i'));
});
test('review enforces state, permission, version, ownership and no self inspection',()=>{
 assert.throws(()=>act(task(),'send-review',tech),e=>e.status===403);
 assert.throws(()=>act({...task(),stage:'维修中'},'send-review',inspector),e=>e.status===409);
 assert.throws(()=>act({...task(),orderStatus:'完成'},'send-review',inspector),e=>e.status===409);
 assert.throws(()=>act(task(),'submit-review'),e=>e.status===409);
 const t=act(task(),'send-review',inspector);
 assert.throws(()=>act(t,'submit-order'),e=>e.status===409);
 assert.throws(()=>act(t,'submit-review',tech2),e=>e.status===403);
 assert.throws(()=>act(t,'submit-review',tech,{expectedVersion:1}),e=>e.status===409);
 assert.throws(()=>act({...task(),technicianIds:['i']},'send-review',inspector),e=>e.status===403);
});
test('each technician edits and submits only their review projects; final submission enters inspection',()=>{
 const original={...task('维修完成'),technicianIds:['t','t2'],items:[...task('维修完成').items,{id:2,name:'其他项目',status:'已完工',responsibleId:'t2'}]};
 let t=act(original,'send-review',inspector);
 assert.throws(()=>act(t,'submit-review',tech,{repairItems:[{id:2,name:'篡改其他人项目'}]}),e=>e.status===403);
 t=act(t,'submit-review',tech,{repairItems:[{id:1,name:'本人修改',responsibleId:'t'}]});
 assert.equal(t.stage,'回审');assert.equal(t.items[0].status,'待检验');assert.equal(t.items[1].status,'维修中');
 assert.throws(()=>act(t,'submit-review',tech),e=>e.status===409);
 t=act(t,'submit-review',tech2);
 assert.equal(t.stage,'待检验');assert.ok(t.items.every(i=>i.status==='待检验'));
});

test('review of a repair round preserves the original completed commercial status',()=>{
 const t=act({...task('维修完成'),orderStatus:'完成',repairRound:1},'send-review',inspector);
 assert.equal(t.stage,'回审');assert.equal(t.repairRound,1);assert.equal(t.orderStatus,'完成');
});

const warehouse={...tech,id:'w',name:'仓管',role:'warehouse'};
const materialPeople=[...people,warehouse];
const parts=()=>({mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'},{name:'密封圈',quantity:2,unit:'个'}],photoIds:[]});
const materials=(t,action,actor,extra={})=>applyDispatchAction(t,{action,expectedVersion:t.version,requestId:randomUUID(),...extra},actor,materialPeople,'2026-10-23T01:00:00Z');
test('review supports material requests, warehouse edits, partial preparation and review submission',()=>{
 let t=act({...task(),acceptedAt:'accepted'},'send-review',inspector);
 t=materials(t,'record-parts',tech,{partsRequirement:parts()});assert.equal(t.stage,'回审');
 assert.throws(()=>act(t,'submit-review'),/配件备齐/);
 t=materials(t,'edit-parts',warehouse,{partsRequirement:parts()});assert.equal(t.stage,'回审');
 t=materials(t,'confirm-parts',warehouse,{partsPreparation:[{index:0,recipientId:'t'}]});assert.equal(t.stage,'回审');assert.equal(t.partsRequirement.preparedAt,undefined);
 assert.throws(()=>act(t,'submit-review'),/配件备齐/);
 t=materials(t,'confirm-parts',warehouse,{partsPreparation:[{index:1,recipientId:'t'}]});assert.equal(t.stage,'回审');assert.ok(t.partsRequirement.preparedAt);
 const done=act(t,'submit-review');assert.equal(done.stage,'待检验');
});
test('multi-person review keeps individual requests independent and forbids material requests after personal submission',()=>{
 let t=act({...task(),acceptedAt:'accepted',technicianIds:['t','t2'],items:[...task().items,{id:2,name:'其他项目',status:'待检验',responsibleId:'t2'}]},'send-review',inspector);
 t=materials(t,'record-parts',tech,{partsRequirement:parts()});
 t=materials(t,'record-parts',tech2,{partsRequirement:parts()});assert.equal(t.partsRequests.length,2);
 t=materials(t,'confirm-parts',warehouse,{preparationGroups:[{partsOwnerId:'t',items:[{index:0,recipientId:'t'},{index:1,recipientId:'t'}]},{partsOwnerId:'t2',items:[{index:0,recipientId:'t2'}]}]});
 assert.equal(t.stage,'回审');assert.ok(t.partsRequests.find(p=>p.ownerId==='t').preparedAt);assert.equal(t.partsRequests.find(p=>p.ownerId==='t2').preparedAt,undefined);
 t=act(t,'submit-review',tech);assert.equal(t.stage,'回审');
 assert.throws(()=>materials(t,'record-parts',tech,{partsRequirement:parts()}),/本人项目已提交/);
 assert.throws(()=>act(t,'submit-review',tech2),/配件备齐/);
 t=materials(t,'confirm-parts',warehouse,{partsOwnerId:'t2',partsPreparation:[{index:1,recipientId:'t2'}]});
 assert.equal(act(t,'submit-review',tech2).stage,'待检验');
});

test('partial review inspection survives another worker editing and adding their own work',()=>{
 const original={...task('维修完成'),technicianIds:['t','t2'],items:[...task('维修完成').items,{id:2,name:'其他项目',status:'已完工',responsibleId:'t2',startAt:'old'}]};
 let t=act(original,'send-review',inspector);
 t=act(t,'submit-review',tech);t=act(t,'claim-inspection',inspector);t=act(t,'inspect',inspector);
 assert.equal(t.stage,'回审');assert.equal(t.items[0].status,'已完工');
 const inspected=structuredClone(t.items[0]);
 t=act(t,'edit-repair-items',tech2,{repairItems:[{id:2,name:'乙核对修改',responsibleId:'t2'},{name:'乙补充项目',responsibleId:'t2'}]});
 assert.deepEqual(t.items[0],inspected);assert.equal(t.items[2].responsibleId,'t2');assert.equal(t.stage,'回审');
 t=act(t,'submit-review',tech2);t=act(t,'claim-inspection',inspector);t=act(t,'inspect',inspector);
 assert.equal(t.stage,'维修完成');assert.deepEqual(t.items[0],inspected);
});

test('review cannot be reassigned through scheduling alternatives or a technician with manager roles',()=>{
 const t=act({...task('维修完成'),technicianIds:['t','t2'],items:[...task('维修完成').items,{id:2,name:'乙项目',status:'已完工',responsibleId:'t2'}]},'send-review',inspector);
 const manager={...tech,id:'manager',role:'manager'};
 for(const action of ['assign','reassign'])assert.throws(()=>act(t,action,manager,{technicianIds:['t2'],dueAt:'2027-01-01T00:00:00Z',reason:'换人'}),e=>e.status===409);
 assert.throws(()=>act(t,'update-technicians',manager,{technicianIds:['t2']}),e=>e.status===403);
 for(const role of ['advisor','manager']) {
  const dual={...tech,role,roles:[role,'technician']};
  for(const repairItems of [[{id:2,name:'越权修改',responsibleId:'t2'}],[{id:1,name:'原项目',responsibleId:'t2'}],[{id:1,name:'原项目',responsibleId:'t'},{name:'越权增项',responsibleId:'t2'}]])
   assert.throws(()=>act(t,'edit-repair-items',dual,{repairItems}),e=>e.status===403);
 }
 assert.equal(t.version,2);assert.equal(t.items.length,2);
});

test('schedulers add assigned review projects without changing existing work or starting new work',()=>{
 const advisor={...tech,id:'advisor',role:'advisor'},fresh={...tech,id:'fresh',name:'新增维修工'};
 const roster=[...people,advisor,fresh];
 const original=act(task('维修完成'),'send-review',inspector);
 const request={action:'edit-repair-items',expectedVersion:original.version,requestId:randomUUID(),repairItems:[...original.items.map(({id,name,responsibleId})=>({id,name,responsibleId})),{name:'回审增项',responsibleId:fresh.id}]};
 let next=applyDispatchAction(original,request,advisor,roster);
 assert.equal(next.stage,'回审');assert.deepEqual(next.items[0],original.items[0]);assert.equal(next.items[1].status,'待开工');assert.equal(next.items[1].startAt,undefined);assert.ok(next.technicianIds.includes(fresh.id));
 const run=(actor,action)=>{next=applyDispatchAction(next,{action,expectedVersion:next.version,requestId:randomUUID()},actor,roster);};
 assert.throws(()=>run(fresh,'submit-review'),e=>e.status===409);
 run(fresh,'start-order');run(fresh,'submit-review');assert.equal(next.stage,'回审');run(tech,'submit-review');assert.equal(next.stage,'待检验');
 for(const patch of [{active:false},{shopId:'other'},{role:'advisor'}])assert.throws(()=>applyDispatchAction(original,request,advisor,[...people,advisor,{...fresh,...patch}]),e=>e.status===409);
 const tampered=structuredClone(request);tampered.repairItems[0].name='改旧项目';
 assert.throws(()=>applyDispatchAction(original,tampered,advisor,roster),e=>e.status===409);
});

test('adding the current inspector as a review worker releases their inspection claim',()=>{
 const advisor={...tech,id:'advisor',role:'advisor'},dual={...tech2,roles:['technician','inspector']};
 const original={...act(task('维修完成'),'send-review',inspector),inspectorId:dual.id,inspectorName:dual.name,inspectionClaimedAt:'old'};
 original.items[0].status='待检验';
 const next=applyDispatchAction(original,{action:'edit-repair-items',expectedVersion:original.version,requestId:randomUUID(),repairItems:[{id:1,name:original.items[0].name,responsibleId:tech.id},{name:'追加检查',responsibleId:dual.id}]},advisor,[...people.filter(p=>p.id!==dual.id),dual,advisor]);
 assert.equal(next.inspectorId,undefined);assert.equal(next.inspectionClaimedAt,undefined);assert.equal(original.inspectorId,dual.id);
 assert.throws(()=>applyDispatchAction(next,{action:'claim-inspection',expectedVersion:next.version,requestId:randomUUID()},dual,[...people,advisor]),e=>e.status===403);
});
