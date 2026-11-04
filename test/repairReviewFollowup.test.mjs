import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';

const a={id:'a',name:'甲',role:'technician',active:true,shopId:'s'},b={...a,id:'b',name:'乙'};
const inspector={...a,id:'i',name:'兼任检验员',role:'inspector',roles:['inspector','technician']};
const other={...a,id:'j',role:'inspector'},manager={...a,id:'m',role:'manager'},warehouse={...a,id:'w',role:'warehouse'};
const people=[a,b,inspector,other,manager,warehouse],now='2026-11-04T06:00:00Z';
const part=name=>({name,quantity:1,unit:'个'});
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',version:1,acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',
 items:[{id:1,name:'甲项目',responsibleId:'a',status:'维修中',startAt:'started',startedBy:'a'},{id:2,name:'乙项目',responsibleId:'b',status:'待开工'}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'review-followup',...extra},actor,people,now);
const rows=task=>task.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));

test('review editing does not force new work to start before that worker has usable material',()=>{
 const original={...base(),stage:'回审',partsRequests:[{ownerId:'b',mode:'list',items:[part('滤芯'),part('皮带')],photoIds:[]}]};
 original.items[0].status='待检验';original.workerSubmissions={a:{at:now}};
 const next=act(original,b,'edit-repair-items',{repairItems:[{id:2,name:'乙项目'},{name:'回审补充项目'}]});
 assert.equal(next.stage,'回审');assert.equal(next.items.at(-1).status,'待开工');assert.equal(next.items.at(-1).startAt,undefined);
 assert.deepEqual(next.items[0],original.items[0]);
 assert.throws(()=>act(next,b,'start-order'),e=>e.status===409);
 const ready=act(next,warehouse,'confirm-parts',{partsOwnerId:'b',partsPreparation:[{index:0,recipientId:'b'}]});
 const started=act(ready,b,'start-order');
 assert.ok(started.items.filter(i=>i.responsibleId==='b').every(i=>i.status==='维修中'&&i.startedBy==='b'));
 assert.equal(started.stage,'回审');assert.deepEqual(started.items[0],original.items[0]);
 assert.throws(()=>act(started,b,'submit-review'),e=>e.status===409);
});

test('review additions with no parts or partial parts retain the legitimate start behavior',()=>{
 for(const partsRequirement of [{mode:'none',items:[],photoIds:[]},{mode:'list',items:[{...part('滤芯'),preparedAt:now},part('皮带')],photoIds:[]}]) {
  const task={...base(),stage:'回审',partsRequests:[{ownerId:'b',...partsRequirement}]};
  const next=act(task,b,'edit-repair-items',{repairItems:[{id:2,name:'乙项目'},{name:'回审补充项目'}]});
  assert.equal(next.items.at(-1).status,'维修中');assert.equal(next.items.at(-1).startedBy,'b');
  assert.deepEqual(next.items[0],task.items[0]);assert.equal(next.stage,'回审');
 }
});

for(const action of ['reassign','edit-repair-items'])test(`${action} releases an active inspector claim if the inspector joins the repair team`,()=>{
 let task=act(base(),a,'submit-order');task=act(task,inspector,'claim-inspection');
 const changedRows=(action==='reassign'?rows(task).filter(row=>row.id===2):rows(task)).map(row=>row.id===2?{...row,responsibleId:inspector.id}:row);
 const next=act(task,manager,action,{repairItems:changedRows,reason:'项目交接',...(action==='reassign'?{reassignItemIds:[2]}:{})});
 assert.deepEqual(next.items[0],task.items[0]);assert.equal(next.stage,'维修中');
 for(const key of ['inspectorId','inspectorName','inspectionClaimedAt'])assert.equal(next[key],undefined,key);
 assert.throws(()=>act(next,inspector,'claim-inspection'),e=>e.status===403);
 const claimed=act(next,other,'claim-inspection');assert.equal(act(claimed,other,'inspect').items[0].status,'已完工');
});

test('adding a project for the claimed inspector also releases the claim; unrelated edits preserve it',()=>{
 let task=act(base(),a,'submit-order');task=act(task,inspector,'claim-inspection');
 const next=act(task,manager,'edit-repair-items',{repairItems:[...rows(task),{name:'新增专项检查',responsibleId:inspector.id}]});
 assert.equal(next.inspectorId,undefined);assert.equal(next.items.at(-1).status,'待开工');
 const unchanged=act(task,manager,'edit-repair-items',{repairItems:[...rows(task),{name:'乙新增项目',responsibleId:b.id}]});
 for(const key of ['inspectorId','inspectorName','inspectionClaimedAt'])assert.equal(unchanged[key],task[key]);
 assert.deepEqual(task.items,act(base(),a,'submit-order').items);
});

test('historical inspection attribution survives a new assignment when no work is awaiting inspection',()=>{
 const task={...base(),inspectorId:inspector.id,inspectorName:inspector.name,inspectionClaimedAt:'old'};
 task.items[0]={...task.items[0],status:'已完工',inspectedBy:inspector.id,inspectedAt:'old'};
 const next=act(task,manager,'edit-repair-items',{repairItems:[...rows(task),{name:'后续维修',responsibleId:inspector.id}]});
 assert.equal(next.inspectorId,inspector.id);assert.deepEqual(next.items[0],task.items[0]);
});
