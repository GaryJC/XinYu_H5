import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validatePartsRequirement} from '../server/domain/partsRequirement.mjs';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const tech={id:'t',name:'维修工',role:'technician',active:true,shopId:'s'};
const waiting=()=>({orderId:'o',shopId:'s',stage:'待接单',orderStatus:'待派工',version:1,technicianIds:['t'],items:[{id:1,name:'维修',status:'待开工'},{id:2,name:'已通过项目',responsibleId:'t',responsibleName:'维修工',status:'已完工',startAt:'2026-10-01',inspectedBy:'i'}]});
const input=(partsRequirement)=>({action:'accept',expectedVersion:1,requestId:randomUUID(),partsRequirement});
test('acceptance requiring parts waits for issue without overwriting inspected projects',()=>{
 const task=waiting(),original=structuredClone(task),now='2026-10-15T12:00:00Z';
 assert.throws(()=>applyDispatchAction(task,input(undefined),tech,[tech],now),e=>e.status===400);
 const next=applyDispatchAction(task,input({mode:'list',items:[{name:' 机油 ',quantity:4,unit:'升'}],photoIds:[],recordedBy:'forged'}),tech,[tech],now);
 assert.deepEqual(task,original);assert.equal(next.stage,'待开工');assert.equal(next.acceptedAt,now);assert.equal(next.firstStartedAt,undefined);assert.equal(next.items[0].startAt,undefined);assert.deepEqual(next.items[1],task.items[1]);assert.equal(next.partsRequirement.recordedBy,'t');assert.equal(next.partsRequirement.items[0].name,'机油');
});
test('parts modes enforce meaningful lists, quantities and photo selections',()=>{
 for(const value of [null,{}, {mode:'none',items:[{name:'机油',quantity:1,unit:'升'}]}, {mode:'list',items:[]},{mode:'list',items:[{name:' ',quantity:1,unit:'个'}]},{mode:'list',items:[{name:'机油',quantity:0,unit:'升'}]},{mode:'list',items:[{name:'机油',quantity:'1',unit:'升'}]},{mode:'photo',photoIds:[]},{mode:'photo',photoIds:['a','a']}])assert.throws(()=>validatePartsRequirement(value),e=>e.status===400);
 assert.deepEqual(validatePartsRequirement({mode:'none'}),{mode:'none',items:[],photoIds:[]});
 assert.equal(validatePartsRequirement({mode:'photo',photoIds:['f']}).photoIds[0],'f');
});
test('waiting tasks must start before completion and retain passed inspection history',()=>{
 for(const partsRequirement of [undefined,{mode:'none',items:[],photoIds:[]},{mode:'list',items:[{name:'机油',quantity:4,unit:'升'}],issuedAt:'2026-10-01T12:00:00Z'}]) {
  const task={...waiting(),stage:'待开工',acceptedAt:'2026-10-01T12:00:00Z',partsRequirement};
  const before=structuredClone(task),startedAt='2026-10-15T12:00:00Z',finishedAt='2026-10-15T13:00:00Z';
  assert.throws(()=>applyDispatchAction(task,request(task,'submit-order'),tech,[tech],finishedAt),/当前待开工/);
  assert.deepEqual(task,before);assert.equal(task.firstStartedAt,undefined);assert.equal(task.submittedAt,undefined);
  assert.equal(task.items[0].startAt,undefined);assert.equal(task.items[0].finishAt,undefined);
  const started=applyDispatchAction(task,request(task,'start-order'),tech,[tech],startedAt);
  assert.equal(started.stage,'维修中');assert.equal(started.firstStartedAt,startedAt);
  const completed=applyDispatchAction(started,request(started,'submit-order'),tech,[tech],finishedAt);
  assert.equal(completed.stage,'待检验');assert.equal(completed.items[0].status,'待检验');
  assert.equal(completed.items[0].startAt,startedAt);assert.equal(completed.items[0].finishAt,finishedAt);
  assert.deepEqual(completed.items[1],task.items[1]);
 }
});
test('working tasks cannot silently start unfinished projects during completion',()=>{
 for(const status of ['待开工','待派工','待领料']) {
  const task={...waiting(),stage:'维修中',items:[{id:1,status:'维修中',startAt:'2026-10-15T12:00:00Z',startedBy:'t'},{id:2,status}]};
  const before=structuredClone(task);
  assert.throws(()=>applyDispatchAction(task,request(task,'submit-order'),tech,[tech]),/全部维修项目开工/);
  assert.deepEqual(task,before);
 }
});

const warehouse={id:'w',name:'仓管',role:'warehouse',active:true,shopId:'s'};
const request=(task,action,extra={})=>({action,expectedVersion:task.version,requestId:randomUUID(),...extra});
const withParts=()=>applyDispatchAction(waiting(),input({mode:'list',items:[{name:'机油',quantity:4,unit:'升'}]}),tech,[tech]);
test('warehouse preparation starts repair under the technician identity',()=>{
 const task=withParts(),before=structuredClone(task),now='2026-10-16T12:00:00Z';
 const next=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[],now);
 assert.deepEqual(task,before);assert.equal(next.partsRequirement.preparedBy,'w');assert.equal(next.partsRequirement.preparedName,'仓管');assert.equal(next.partsRequirement.preparedAt,now);
 assert.deepEqual(next.items[1],task.items[1]);assert.equal(next.items[0].startedBy,tech.id);assert.equal(next.stage,'维修中');assert.equal(next.version,task.version+1);
 assert.throws(()=>applyDispatchAction(next,request(next,'confirm-parts'),warehouse,[]),e=>e.status===409);
 assert.throws(()=>applyDispatchAction(next,request(task,'confirm-parts'),warehouse,[]),e=>e.status===409);
});
test('only active same-shop warehouse can confirm; warehouse cannot repair or schedule',()=>{
 const task=withParts();
 for(const actor of [tech,{...warehouse,active:false},{...warehouse,shopId:'other'},{...warehouse,role:'manager'}]) assert.throws(()=>applyDispatchAction(task,request(task,'confirm-parts'),actor,[]),e=>e.status===403);
 for(const action of ['record-parts','submit-order','update','start-order','pick']) assert.throws(()=>applyDispatchAction(task,request(task,action),warehouse,[]),e=>e.status===403);
 const noParts={...task,partsRequirement:{mode:'none',items:[],photoIds:[]}};
 assert.throws(()=>applyDispatchAction(noParts,request(noParts,'confirm-parts'),warehouse,[]),e=>e.status===409);
});
test('changing an application resets confirmation and ignores forged audit fields',()=>{
 const task=withParts();const confirmed=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[]);
 const next=applyDispatchAction(confirmed,request(confirmed,'record-parts',{partsRequirement:{...confirmed.partsRequirement,items:[{name:'滤芯',quantity:1,unit:'个'}]}}),tech,[]);
 assert.equal(next.partsRequirement.preparedAt,undefined);assert.equal(next.partsRequirement.preparedBy,undefined);assert.equal(next.partsRequirement.recordedBy,tech.id);
 assert.ok(confirmed.partsRequirement.preparedAt);
});

test('no parts begins immediately; removing an unissued requirement starts waiting repair',()=>{
 const now='2026-10-17T01:00:00Z';
 const none={mode:'none',items:[],photoIds:[]};
 const next=applyDispatchAction(waiting(),input(none),tech,[tech],now);
 assert.equal(next.stage,'维修中');assert.equal(next.firstStartedAt,now);
 const task=withParts();const changed=applyDispatchAction(task,request(task,'record-parts',{partsRequirement:none}),tech,[tech],now);
 assert.equal(changed.stage,'维修中');assert.equal(changed.items[0].startedBy,'t');
});
test('unissued requests block all start and completion bypasses including legacy endpoints',()=>{
 const task=withParts();
 for(const action of ['start-order','start','pick']) assert.throws(()=>applyDispatchAction(task,request(task,action,{itemId:1}),tech,[tech]),/确认配件备齐/);
 assert.throws(()=>applyDispatchAction(task,request(task,'submit-order'),tech,[tech]),/当前待开工/);
 const ready=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[tech]);
 assert.equal(ready.stage,'维修中');assert.doesNotThrow(()=>applyDispatchAction(ready,request(ready,'submit-order'),tech,[tech]));
 const working={...task,stage:'维修中',items:task.items.map(i=>({...i,status:'待检验'}))};
 assert.throws(()=>applyDispatchAction(working,request(working,'submit-order'),tech,[tech]),/确认配件备齐/);
 assert.throws(()=>applyDispatchAction(working,request(working,'submit',{inspectorId:'i'}),tech,[tech]),/确认配件备齐/);
});
test('issue requires preparation and starts repair using technician identity, never warehouse identity',()=>{
 const task=withParts(),before=structuredClone(task),now='2026-10-17T01:00:00Z';
 assert.throws(()=>applyDispatchAction(task,request(task,'issue-parts'),warehouse,[tech]),/先确认备料/);
 const ready=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[tech]);
 const issued=applyDispatchAction(ready,request(ready,'issue-parts'),warehouse,[tech],now);
 assert.deepEqual(task,before);assert.equal(issued.stage,'维修中');assert.equal(issued.firstStartedAt,ready.firstStartedAt);
 assert.equal(issued.partsRequirement.issuedBy,'w');assert.equal(issued.partsRequirement.issuedName,'仓管');assert.equal(issued.partsRequirement.issuedAt,now);
 assert.deepEqual(issued.partsRequirement.recipientIds,['t']);assert.equal(issued.items[0].startedBy,'t');assert.equal(issued.items[0].pickedAt,now);
 assert.ok(!issued.participantIds.includes('w'));assert.deepEqual(issued.items[1],task.items[1]);
 assert.throws(()=>applyDispatchAction(issued,request(issued,'issue-parts'),warehouse,[tech]),/已出库/);
 for(const user of [tech,{...warehouse,active:false},{...warehouse,shopId:'other'},{...warehouse,role:'manager'}])assert.throws(()=>applyDispatchAction(ready,request(ready,'issue-parts'),user,[tech]),e=>e.status===403);
 for(const stage of ['待接单','待派工','待检验','维修完成'])assert.throws(()=>applyDispatchAction({...ready,stage},request(ready,'issue-parts'),warehouse,[tech]),e=>e.status===409);
});
test('issued batches stay immutable; subsequent requests are new batches and keep original start time',()=>{
 const task=withParts(),ready=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[tech]);
 const issued=applyDispatchAction(ready,request(ready,'issue-parts'),warehouse,[tech]);const original=structuredClone(issued);
 const extra={mode:'list',items:[{name:'滤芯',quantity:2,unit:'个'}],photoIds:[],preparedAt:'forged',issuedAt:'forged'};
 const added=applyDispatchAction(issued,request(issued,'record-parts',{partsRequirement:extra}),tech,[tech]);
 assert.deepEqual(issued,original);assert.equal(added.partsRequirement.batch,2);assert.equal(added.stage,'维修中');
 assert.equal(added.partsRequirement.preparedAt,undefined);assert.equal(added.partsRequirement.issuedAt,undefined);
 const updated=applyDispatchAction(added,request(added,'record-parts',{partsRequirement:extra}),tech,[tech]);assert.equal(updated.partsRequirement.batch,2);
 const readyAgain=applyDispatchAction(updated,request(updated,'confirm-parts'),warehouse,[tech]);
 const issuedAgain=applyDispatchAction(readyAgain,request(readyAgain,'issue-parts'),warehouse,[tech]);
 assert.equal(issuedAgain.firstStartedAt,issued.firstStartedAt);assert.equal(issuedAgain.items[0].startAt,issued.items[0].startAt);
});
test('issue during pause keeps pause, updates resume stage, and cannot act on canceled or unaccepted work',()=>{
 const task=withParts(),paused=applyDispatchAction(task,request(task,'pause',{pauseReason:'待配件'}),tech,[tech]);
 const ready=applyDispatchAction(paused,request(paused,'confirm-parts'),warehouse,[tech]);
 const issued=applyDispatchAction(ready,request(ready,'issue-parts'),warehouse,[tech]);
 assert.equal(issued.stage,'暂停');assert.equal(issued.resumeStage,'维修中');assert.equal(issued.pauseReason,'待配件');
 const resumed=applyDispatchAction(issued,request(issued,'resume'),tech,[tech]);assert.equal(resumed.stage,'维修中');
 const unaccepted={...task,acceptedAt:undefined};assert.throws(()=>applyDispatchAction(unaccepted,request(unaccepted,'confirm-parts'),warehouse,[tech]),/等待维修工接单/);
});
test('old application confirmations are not treated as preparation or issue',()=>{
 const task=withParts();task.partsRequirement.confirmedAt='2026-10-16T01:00:00Z';task.partsRequirement.confirmedName='旧仓管';
 assert.throws(()=>applyDispatchAction(task,request(task,'issue-parts'),warehouse,[tech]),/先确认备料/);
 const ready=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[tech]);assert.ok(ready.partsRequirement.preparedAt);
});

test('warehouse can add, edit and delete unissued requirements, invalidating preparation and forged metadata',()=>{
 const task=withParts(),ready=task,before=structuredClone(ready);
 const parts={mode:'list',items:[{name:'机油 SN5W30',quantity:4,unit:'升'},{name:'滤清器',quantity:1,unit:'只'}],photoIds:[],issuedAt:'forged',preparedAt:'forged'};
 const edited=applyDispatchAction(ready,request(ready,'edit-parts',{partsRequirement:parts}),warehouse,[tech]);
 assert.deepEqual(ready,before);assert.equal(edited.stage,'待开工');assert.equal(edited.partsRequirement.items.length,2);assert.equal(edited.partsRequirement.recordedBy,'w');assert.equal(edited.partsRequirement.preparedAt,undefined);assert.equal(edited.partsRequirement.issuedAt,undefined);
 assert.throws(()=>applyDispatchAction(edited,request(edited,'issue-parts'),warehouse,[tech]),/先确认备料/);
 const removed=applyDispatchAction(edited,request(edited,'edit-parts',{partsRequirement:{...parts,items:parts.items.slice(1)}}),warehouse,[tech]);assert.equal(removed.partsRequirement.items.length,1);assert.equal(removed.partsRequirement.items[0].name,'滤清器');
 const none=applyDispatchAction(removed,request(removed,'edit-parts',{partsRequirement:{mode:'none'}}),warehouse,[tech]);
 assert.equal(none.stage,'维修中');assert.equal(none.items[0].startedBy,'t');assert.ok(!none.participantIds.includes('w'));
});
test('warehouse cannot alter issued history, act across stores, or forge clear-list photos',()=>{
 const task=withParts();
 for(const user of [tech,{...warehouse,active:false},{...warehouse,shopId:'other'},{...warehouse,role:'manager'}])assert.throws(()=>applyDispatchAction(task,request(task,'edit-parts',{partsRequirement:{mode:'none'}}),user,[tech]),e=>e.status===403);
 const ready=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[tech]);
 const issued=applyDispatchAction(ready,request(ready,'issue-parts'),warehouse,[tech]);
 assert.throws(()=>applyDispatchAction(issued,request(issued,'edit-parts',{partsRequirement:{mode:'none'}}),warehouse,[tech]),/已完成/);
 assert.throws(()=>applyDispatchAction(task,request(task,'edit-parts',{partsRequirement:{mode:'photo',photoIds:['other-photo']}}),warehouse,[tech]),e=>e.status===400);
 const photoTask={...task,partsRequirement:{mode:'photo',items:[],photoIds:['original-photo']}};
 const transcribed=applyDispatchAction(photoTask,request(photoTask,'edit-parts',{partsRequirement:{mode:'list',items:[{name:'机油',quantity:1,unit:'桶'}],sourcePhotoIds:['forged-photo']}}),warehouse,[tech]);
 assert.deepEqual(transcribed.partsRequirement.sourcePhotoIds,['original-photo']);
 const updated=applyDispatchAction(transcribed,request(transcribed,'edit-parts',{partsRequirement:{mode:'none'}}),warehouse,[tech]);assert.deepEqual(updated.partsRequirement.sourcePhotoIds,['original-photo']);
});

test('outsourced start keeps the scheduling owner after warehouse transcription',()=>{
 const task={...withParts(),executionMode:'outsourced',technicianIds:[],technicianId:undefined,assignedBy:'advisor',partsRequirement:{mode:'list',items:[{name:'机油',quantity:1,unit:'桶'}],photoIds:[],recordedBy:'w'}};
 const edited=applyDispatchAction(task,request(task,'edit-parts',{partsRequirement:{mode:'none'}}),warehouse,[]);
 assert.equal(edited.items[0].startedBy,'advisor');assert.ok(!edited.participantIds.includes('w'));
 const ready=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[]);
 assert.throws(()=>applyDispatchAction(ready,request(ready,'issue-parts'),warehouse,[]),/领料人必须/);
 const issued=applyDispatchAction({...ready,technicianId:'t',technicianIds:['t']},request(ready,'issue-parts'),warehouse,[tech]);
 assert.equal(issued.items[0].startedBy,'advisor');assert.ok(!issued.participantIds.includes('w'));
});


test('reassigned acceptance preserves issued batches instead of requesting material twice',()=>{
 const advisor={id:'a',name:'顾问',role:'advisor',active:true,shopId:'s'},replacement={...tech,id:'t2'};
 const original={...withParts(),stage:'维修中',firstStartedAt:'2026-10-01T12:00:00Z',partsRequirement:{...withParts().partsRequirement,batch:3,preparedAt:'2026-10-02',issuedAt:'2026-10-03',recipientIds:['t']}};
 const reassigned=applyDispatchAction(original,request(original,'reassign',{technicianIds:['t2'],dueAt:'2027-01-01T12:00:00Z',reason:'换班'}),advisor,[advisor,replacement]);
 const accepted=applyDispatchAction(reassigned,request(reassigned,'accept',{partsRequirement:{mode:'none'}}),replacement,[replacement]);
 assert.equal(accepted.stage,'维修中');assert.equal(accepted.firstStartedAt,original.firstStartedAt);
 assert.deepEqual(accepted.partsRequirement,original.partsRequirement);assert.equal(accepted.partsRequirement.batch,3);
});
test('reassigned acceptance cannot bypass an unissued requirement by selecting no material',()=>{
 const original={...waiting(),partsRequirement:{mode:'list',items:[{name:'机油',quantity:4,unit:'升'}],photoIds:[],batch:2}};
 const accepted=applyDispatchAction(original,request(original,'accept',{partsRequirement:{mode:'none'}}),tech,[tech]);
 assert.equal(accepted.stage,'待开工');assert.deepEqual(accepted.partsRequirement,original.partsRequirement);
 assert.throws(()=>applyDispatchAction(accepted,request(accepted,'start-order'),tech,[tech]),/等待仓管/);
});
