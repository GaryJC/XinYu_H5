import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {warehouseRequests,matchesPartsStatus} from '../shared/warehouseRequests.mjs';

const a={id:'a',name:'维修甲',role:'technician',shopId:'s',active:true};
const b={...a,id:'b',name:'维修乙'},warehouse={...a,id:'w',role:'warehouse'},manager={...a,id:'m',role:'manager'};
const people=[a,b,warehouse,manager],now='2026-11-04T04:00:00Z';
const parts=name=>({mode:'list',items:[{name,quantity:1,unit:'个'}],photoIds:[]});
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'待开工',version:1,acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',
 partsRequirement:parts('共同申请'),partsRequests:[{ownerId:'a',mode:'none',items:[],photoIds:[]},{ownerId:'b',...parts('乙的申请')}],
 items:[{id:1,name:'甲项目',status:'待开工',responsibleId:'a',responsibleName:a.name},{id:2,name:'乙项目',status:'待开工',responsibleId:'b',responsibleName:b.name}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'lifecycle-review',...extra},actor,people,now);
const handle=(task,action,owner)=>act(task,warehouse,action,{...(owner?{partsOwnerId:owner}:{}),...(action==='issue-parts'?{partsIssue:[{index:0,recipientId:owner||'a'}]}:{})});

test('adding a personal project cannot borrow a coworker’s working stage to bypass preparation',()=>{
 const initial=base();delete initial.partsRequirement;
 initial.items[0]={...initial.items[0],status:'维修中',startAt:'earlier',startedBy:'a'};initial.stage='维修中';
 const next=act(initial,b,'edit-repair-items',{repairItems:[{id:2,name:'乙项目'},{name:'乙新增项目'}]});
 assert.equal(next.items.at(-1).status,'待开工');assert.equal(next.items.at(-1).startAt,undefined);
 assert.deepEqual(next.items[0],initial.items[0]);
 assert.equal(next.partsRequests.find(p=>p.ownerId==='b').preparedAt,undefined);
 const prepared=handle(next,'confirm-parts','b');
 assert.ok(prepared.items.filter(i=>i.responsibleId==='b').every(i=>i.status==='维修中'&&i.startedBy==='b'));
 assert.deepEqual(prepared.items[0],initial.items[0]);
});

test('new personal projects start with partial preparation but preserve a personal pause',()=>{
 for(const paused of [false,true]) {
  const initial=base();delete initial.partsRequirement;initial.stage='维修中';
  initial.partsRequests[1].items.push({name:'未备齐配件',quantity:1,unit:'个'});
  const working=act(initial,warehouse,'confirm-parts',{partsOwnerId:'b',partsPreparation:[{index:0,recipientId:'b'}]});
  if(paused)working.workerPauses={b:{resumeStage:'维修中',pausedAt:now,pauseReason:'其他',pauseNote:undefined}};
  const next=act(working,b,'edit-repair-items',{repairItems:[{id:2,name:'乙项目'},{name:'乙新增项目'}]});
  assert.equal(next.items.at(-1).status,'维修中');assert.equal(next.items.at(-1).startedBy,'b');
  assert.deepEqual(next.workerPauses,working.workerPauses);
  assert.equal(next.partsRequests.find(p=>p.ownerId==='b').preparedAt,undefined);
 }
});

for(const action of ['confirm-parts','issue-parts']) {
 test(`shared ${action} starts only workers whose personal parts are also ready`,()=>{
  const original=base(),before=structuredClone(original);
  let task=handle(original,action);
  assert.deepEqual(original,before);assert.equal(task.items[0].status,'维修中');
  assert.equal(task.items[1].status,'待开工');assert.equal(task.items[1].startAt,undefined);
  task=handle(task,action,'b');assert.equal(task.items[1].status,'维修中');assert.equal(task.items[1].startedBy,'b');
 });
 test(`personal ${action} allows its owner to start while shared material remains pending`,()=>{
  const original=base();let task=handle(original,action,'b');
  assert.equal(task.stage,'维修中');
  assert.deepEqual(task.items[0],original.items[0]);assert.equal(task.items[1].status,'维修中');
  assert.equal(task.firstStartedAt,now);assert.deepEqual(task.participantIds,['b']);
  assert.throws(()=>act(task,b,'submit-order'),/历史共同配件/);
  task=handle(task,action);assert.ok(task.items.every(item=>item.status==='维修中'));
  assert.equal(task.items[1].startedBy,'b');
 });
}

for(const action of ['accept','record-parts'])test(`${action} with no personal parts cannot bypass pending shared material`,()=>{
 const task=base();delete task.partsRequests;
 if(action==='accept'){task.stage='待接单';delete task.acceptedAt;}
 const next=act(task,a,action,{partsRequirement:{mode:'none'}});
 assert.ok(next.acceptedAt);assert.equal(next.stage,'待开工');assert.deepEqual(next.items,task.items);
 assert.equal(next.firstStartedAt,undefined);
});

test('warehouse removing unnecessary shared parts does not bypass a pending personal request',()=>{
 const next=act(base(),warehouse,'edit-parts',{partsRequirement:{mode:'none'}});
 assert.equal(next.items[0].status,'维修中');assert.equal(next.items[1].status,'待开工');
});

test('one worker can start and submit while a coworker still awaits personal parts',()=>{
 const initial=base();delete initial.partsRequirement;
 initial.partsRequests[0]={ownerId:'a',...parts('甲的申请')};
 const working=handle(initial,'confirm-parts','a');
 assert.deepEqual(working.items.map(item=>item.status),['维修中','待开工']);
 assert.equal(working.partsRequests.find(parts=>parts.ownerId==='b').preparedAt,undefined);
 const submitted=act(working,a,'submit-order');
 assert.equal(submitted.stage,'维修中');assert.deepEqual(submitted.items.map(item=>item.status),['待检验','待开工']);
 const coworker=handle(submitted,'confirm-parts','b');
 assert.deepEqual(coworker.items[0],submitted.items[0]);assert.equal(coworker.items[1].status,'维修中');
 assert.equal(act(coworker,b,'submit-order').stage,'待检验');
});

for(const action of ['confirm-parts','issue-parts'])test(`partial personal ${action} preserves pauses, pending lines and coworkers`,()=>{
 const initial=base();delete initial.partsRequirement;
 initial.partsRequests[0]={ownerId:'a',mode:'list',items:[...parts('滤芯').items,...parts('刹车片').items],photoIds:[]};
 initial.workerPauses={a:{pauseReason:'待配件',pausedAt:'paused',resumeStage:'待开工'}};
 const prepare=(task,index,time=now)=>applyDispatchAction(task,{action,partsOwnerId:'a',expectedVersion:task.version,requestId:'partial-personal',
  [action==='confirm-parts'?'partsPreparation':'partsIssue']:[{index,recipientId:'a'}]},warehouse,people,time);
 const first=prepare(initial,0),requirement=first.partsRequests.find(parts=>parts.ownerId==='a');
 assert.equal(first.items[0].status,'维修中');assert.deepEqual(first.items[1],initial.items[1]);
 assert.equal(first.workerPauses.a.resumeStage,'维修中');assert.equal(first.workerPauses.a.pausedAt,'paused');
 assert.equal(requirement.preparedAt,undefined);assert.equal(requirement.issuedAt,undefined);
 assert.ok(warehouseRequests([first]).some(request=>request.partsRequirement.ownerId==='a'&&matchesPartsStatus(request,'部分备齐')));
 assert.ok(warehouseRequests([first]).some(request=>request.partsRequirement.ownerId==='b'&&matchesPartsStatus(request,'待备料')));
 assert.equal(requirement.items[1].preparedAt,undefined);assert.equal(requirement.items[1].issuedAt,undefined);
 assert.throws(()=>act(first,a,'submit-order'),/暂停/);
 const resumed=act(first,a,'resume');assert.throws(()=>act(resumed,a,'submit-order'),/确认配件备齐/);
 const final=prepare(resumed,1,'2026-11-04T05:00:00Z');
 assert.equal(final.items[0].startAt,first.items[0].startAt);assert.deepEqual(final.items[1],initial.items[1]);
 assert.equal(act(final,a,'submit-order').items[0].status,'待检验');
});

test('shared preparation preserves personal pauses and attributes starts only to ready owners',()=>{
 const task=base();task.partsRequests.reverse();
 task.partsRequests.find(parts=>parts.ownerId==='a').mode='list';
 task.partsRequests.find(parts=>parts.ownerId==='a').items=[{name:'甲还缺配件',quantity:1,unit:'个'}];
 task.partsRequests.find(parts=>parts.ownerId==='b').preparedAt='already-prepared';
 task.workerPauses={b:{pauseReason:'技术问题',pausedAt:'paused',resumeStage:'待开工'}};
 const before=structuredClone(task),next=handle(task,'confirm-parts');
 assert.deepEqual(task,before);assert.equal(next.items[0].status,'待开工');assert.equal(next.items[1].startedBy,'b');
 assert.deepEqual(next.participantIds,['b']);assert.deepEqual(next.workerPauses.b,{...task.workerPauses.b,resumeStage:'维修中'});
 assert.throws(()=>act(next,b,'submit-order'),/暂停/);
 assert.equal(act(next,b,'resume').workerPauses.b,undefined);
});

test('a deleted project ID is not reused when the next repair round opens',()=>{
 let task={...base(),stage:'维修中',technicianIds:['a'],partsRequirement:{mode:'none'},partsRequests:undefined,items:[{id:1,name:'原项目',status:'维修中',responsibleId:'a',startedBy:'a'}]};
 const rows=t=>t.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));
 task=act(task,manager,'edit-repair-items',{repairItems:[...rows(task),{name:'临时项目',responsibleId:'a'}]});
 const deletedId=task.items.at(-1).id;
 task=act(task,manager,'edit-repair-items',{repairItems:rows(task).filter(item=>item.id!==deletedId)});
 task=act(task,a,'submit-order');task=act(task,manager,'inspect');
 const next=act(task,manager,'reopen-repair',{additionalItems:['下一轮项目'],reason:'客户追加',technicianIds:['a'],dueAt:'2026-11-05T00:00:00Z'});
 assert.ok(next.items[0].id<deletedId);assert.equal(next.repairItemIdFloor,next.items[0].id);
});

test('new repair rounds reserve deferred project IDs omitted from the selectable catalog',()=>{
 const task={...base(),stage:'维修完成',repairItemIdFloor:-4,repairCatalog:[{id:1,name:'已完成'}],items:[],deferredItems:[{id:-8,name:'已撤销项目'}]};
 const next=act(task,manager,'reopen-repair',{additionalItems:['新项目一','新项目二'],reason:'客户追加',technicianIds:['a'],dueAt:'2026-11-05T00:00:00Z'});
 assert.deepEqual(next.items.map(item=>item.id),[-9,-10]);assert.equal(next.repairItemIdFloor,-10);
});

test('additional project names are validated before opening a round and remain submittable',()=>{
 const task={...base(),stage:'维修完成',items:[{id:1,name:'原项目',status:'已完工',responsibleId:'a'}]};
 const input={additionalItems:['补'.repeat(100)],reason:'客户追加',technicianIds:['a'],dueAt:'2026-11-05T00:00:00Z'};
 let next=act(task,manager,'reopen-repair',input);
 next=act(next,a,'accept',{partsRequirement:{mode:'none'}});
 assert.equal(act(next,a,'submit-order').stage,'待检验');
 for(const length of [101,200])assert.throws(()=>act(task,manager,'reopen-repair',{...input,additionalItems:['补'.repeat(length)]}),error=>error.status===400);
});

for(const repairRound of [0,1])test(`removing the last unsettled addition in round ${repairRound} restores a finishable order`,()=>{
 const completed={...base(),stage:'维修完成',orderStatus:'待结算',repairRound,partsRequirement:{mode:'none'},partsRequests:undefined,
  items:[{id:1,name:'已检验项目',status:'已完工',responsibleId:'a',responsibleName:a.name,inspectedBy:'m',inspectedAt:'2026-11-03T02:00:00Z'}]};
 const rows=task=>task.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));
 const added=act(completed,manager,'edit-repair-items',{repairItems:[...rows(completed),{name:'误加项目',responsibleId:'b'}]});
 assert.equal(added.stage,'维修中');
 const cancelled=act(added,manager,'edit-repair-items',{repairItems:rows(completed)});
 assert.equal(cancelled.stage,'维修完成');assert.deepEqual(cancelled.items,completed.items);
 assert.equal(cancelled.completedAt,now);assert.equal(cancelled.rework,false);
});

test('removing another project never completes work still awaiting repair or inspection',()=>{
 for(const status of ['待开工','维修中','待检验']) {
  const task={...base(),stage:'维修中'};task.items[0].status=status;
  const retained=task.items.slice(0,1).map(({id,name,responsibleId})=>({id,name,responsibleId}));
  const next=act(task,manager,'edit-repair-items',{repairItems:retained});
  assert.equal(next.stage,'维修中');assert.equal(next.items[0].status,status);assert.equal(next.completedAt,undefined);
 }
});
