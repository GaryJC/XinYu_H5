import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';

const advisor={id:'a',name:'顾问',role:'advisor',active:true,shopId:'s'};
const t1={id:'t1',name:'维修甲',role:'technician',active:true,shopId:'s'};
const t2={...t1,id:'t2',name:'维修乙'},t3={...t1,id:'t3',name:'维修丙'};
const people=[advisor,t1,t2,t3];
const now='2026-10-21T03:00:00Z',dueAt='2026-10-22T03:00:00Z';
const task=()=>({orderId:'order',shopId:'s',orderStatus:'维修中',stage:'维修中',version:3,technicianIds:['t1','t2'],technicianId:'t1',technicianName:'维修甲、维修乙',acceptedAt:'accepted',firstStartedAt:'started',dueAt,items:[
  {id:1,name:'机油机滤',status:'维修中',responsibleId:'t1',responsibleName:'维修甲',startAt:'start-1',startedBy:'t1'},
  {id:2,name:'全车检查',status:'待开工',responsibleId:'t2',responsibleName:'维修乙'},
  {id:3,name:'已检项目',status:'已完工',responsibleId:'t1',responsibleName:'维修甲',inspectedBy:'i'}
]});
const act=(task,input,actor=advisor)=>applyDispatchAction(task,{requestId:'project-test-request',expectedVersion:task.version,...input},actor,people,now);
const rows=task=>task.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));

test('initial dispatch atomically edits names, adds work and assigns individual owners',()=>{
  const original={...task(),orderStatus:'已委托',stage:'待派工',technicianIds:[],items:[{id:1,name:'检查',status:'待派工'}]};
  const next=act(original,{action:'assign',technicianIds:['t1','t2'],dueAt,repairItems:[{id:1,name:'更换机油',responsibleId:'t1'},{name:'检查刹车',responsibleId:'t2'}]});
  assert.equal(next.stage,'待接单');assert.deepEqual(next.items.map(i=>[i.name,i.responsibleId,i.responsibleName]),[['更换机油','t1','维修甲'],['检查刹车','t2','维修乙']]);
  assert.equal(next.items[1].id,-1);assert.equal(next.items[1].startAt,undefined);assert.equal(original.items.length,1);
  assert.throws(()=>act(original,{action:'assign',technicianIds:['t1','t2'],dueAt,repairItems:[{id:1,name:'检查'}]}),/有效负责人/);
});

test('scheduler inline editing preserves progress and gives new work no fabricated start time',()=>{
  const original=task(),input=rows(original);input[0]={...input[0],name:'更换机油机滤',responsibleId:'t3'};input.push({name:'新增检测',responsibleId:'t2'});
  const next=act(original,{action:'edit-repair-items',repairItems:input,reason:'专项维修交接'});
  assert.equal(next.stage,original.stage);assert.equal(next.acceptedAt,original.acceptedAt);assert.equal(next.items[0].startAt,'start-1');
  assert.deepEqual(next.items[1],original.items[1]);assert.deepEqual(next.items[2],original.items[2]);
  assert.equal(next.items[3].status,'待开工');assert.equal(next.items[3].startedBy,undefined);assert.ok(next.participantIds.includes('t1'));
  assert.ok(next.technicianIds.includes('t3'));assert.equal(next.items[0].responsibleName,'维修丙');
  for(const responsibleId of ['invalid',advisor.id])assert.throws(()=>act(original,{action:'edit-repair-items',repairItems:input.map((row,index)=>index?row:{...row,responsibleId})}),/有效负责人/);
  const pending={...original,stage:'待派工',technicianIds:[],items:[{id:1,name:'检查',status:'待派工'}]};
  assert.equal(act(pending,{action:'edit-repair-items',repairItems:[{id:1,name:'修正检查'},{name:'增项'}]}).items[1].status,'待派工');
});

test('inspection rejection preserves valid owners in an unchanged multi-person team',()=>{
  const inspector={...advisor,id:'inspector',name:'检验员',role:'inspector'};
  const original={...task(),stage:'待检验',inspectorId:inspector.id,items:task().items.map(item=>item.status==='已完工'?item:{...item,status:'待检验',finishAt:now,finishedBy:item.responsibleId})};
  const next=applyDispatchAction(original,{action:'inspect',expectedVersion:original.version,requestId:'reject-team-owners',rejectedItemIds:[1,2],reason:'重新检查'},inspector,[...people,inspector],now);
  assert.equal(next.stage,'维修中');
  for(const item of next.items.slice(0,2)) {
    const previous=original.items.find(i=>i.id===item.id);
    assert.equal(item.responsibleId,previous.responsibleId);assert.equal(item.responsibleName,previous.responsibleName);
    assert.equal(item.status,'待开工');assert.equal(item.finishAt,undefined);
  }
  assert.deepEqual(next.items[2],original.items[2]);
  const started=act(next,{action:'start-order'},t1);
  const first=act(started,{action:'submit-order'},t1);assert.equal(first.stage,'维修中');
  const second=act(first,{action:'start-order'},t2);assert.equal(act(second,{action:'submit-order'},t2).stage,'待检验');
});

test('both editing and completion require a reason when an existing project changes owner',()=>{
  const original={...task(),items:task().items.filter(i=>i.id!==2)};
  const edited=rows(original).map(row=>row.id===1?{...row,responsibleId:'t2'}:row);
  assert.throws(()=>act(original,{action:'submit-order',repairItems:edited,reason:'换班交接'},t1),/本人负责/);
  for(const action of ['edit-repair-items']) {
    const actor=action==='submit-order'?t1:advisor;
    for(const reason of [undefined,'','   '])assert.throws(()=>act(original,{action,repairItems:edited,reason},actor),/原因或交接说明/);
    const next=act(original,{action,repairItems:edited,reason:'换班交接'},actor);
    assert.equal(next.items[0].responsibleId,'t2');assert.equal(next.items[0].startAt,original.items[0].startAt);
    assert.equal(next.stage,action==='submit-order'?'待检验':'维修中');
  }
  // Renaming work, adding work and confirming a previously unspecified owner are not handovers.
  assert.equal(act(original,{action:'edit-repair-items',repairItems:rows(original).map(row=>row.id===1?{...row,name:'修正名称'}:row)}).items[0].name,'修正名称');
  const legacy={...original,items:original.items.map(item=>item.id===1?{...item,responsibleId:undefined,responsibleName:undefined}:item)};
  assert.equal(act(legacy,{action:'edit-repair-items',repairItems:edited}).items[0].responsibleId,'t2');
});

test('selected project reassignment changes only its owner, preserving unselected work and task state',()=>{
  for(const stage of ['待接单','待开工','维修中','暂停']) {
    const original={...task(),stage,resumeStage:'维修中'},before=structuredClone(original);
    const next=act(original,{action:'reassign',reason:'专项维修交接',reassignItemIds:[1],repairItems:[{id:1,name:'机油机滤',responsibleId:'t3'}]});
    assert.deepEqual(original,before);assert.equal(next.items[0].responsibleId,'t3');assert.equal(next.items[0].startedBy,'t1');assert.equal(next.items[0].startAt,'start-1');
    assert.deepEqual(next.items.slice(1),original.items.slice(1));
    for(const key of ['stage','acceptedAt','firstStartedAt','dueAt','resumeStage'])assert.equal(next[key],original[key]);
    assert.ok(next.participantIds.includes('t1'));assert.ok(next.technicianIds.includes('t2'));assert.ok(next.technicianIds.includes('t3'));assert.equal(next.version,original.version+1);
  }
});

test('project reassignment rejects invalid scopes, locked work, foreign staff and stale edits',()=>{
  const original=task(),input={action:'reassign',reason:'交接',reassignItemIds:[1],repairItems:[{id:1,name:'机油机滤',responsibleId:'t3'}]};
  for(const patch of [{reassignItemIds:[]},{reassignItemIds:[1,1]},{reassignItemIds:[2]},{technicianIds:['t3']},{dueAt},{reason:''},{expectedVersion:2},{repairItems:[{id:1,name:'机油机滤',responsibleId:'t1'}]},{repairItems:[{id:1,name:'机油机滤',responsibleId:'missing'}]}])assert.throws(()=>act(original,{...input,...patch}));
  assert.throws(()=>act(original,input,t1),e=>e.status===403);
  assert.throws(()=>act(original,{...input,reassignItemIds:[3],repairItems:[{id:3,name:'已检项目',responsibleId:'t3'}]}),/不可改派/);
  assert.throws(()=>act({...original,stage:'待检验',items:original.items.map(i=>({...i,status:'待检验'}))},input),/当前待检验/);
  assert.throws(()=>act({...original,executionMode:'outsourced'},input),/外包任务/);
});

test('scheduler deletion keeps retained work and past participants, rejects locked items and never reuses deleted IDs',()=>{
  const original=task(),before=structuredClone(original);
  const next=act(original,{action:'edit-repair-items',repairItems:rows(original).filter(row=>row.id!==1)});
  assert.deepEqual(original,before);assert.deepEqual(next.items,original.items.slice(1));
  assert.ok(next.participantIds.includes('t1'));assert.equal(next.acceptedAt,original.acceptedAt);assert.equal(next.stage,original.stage);
  for(const status of ['待检验','已完工'])assert.throws(()=>act({...original,items:original.items.map(i=>i.id===1?{...i,status}:i)},{action:'edit-repair-items',repairItems:rows(original).filter(row=>row.id!==1)}),/不可删除/);
  assert.throws(()=>act(original,{action:'edit-repair-items',repairItems:[]}),e=>e.status===400);
  const added=act(original,{action:'edit-repair-items',repairItems:[...rows(original),{name:'临时检查',responsibleId:'t2'}]});
  const id=added.items.at(-1).id;
  const removed=act(added,{action:'edit-repair-items',repairItems:rows(added).filter(row=>row.id!==id)});
  const again=act(removed,{action:'edit-repair-items',repairItems:[...rows(removed),{name:'后续检查',responsibleId:'t2'}]});
  assert.ok(again.items.at(-1).id<id);
});
