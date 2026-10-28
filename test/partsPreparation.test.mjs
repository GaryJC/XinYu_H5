import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'甲',role:'technician',active:true,shopId:'s'},b={...a,id:'b',name:'乙'},w={...a,id:'w',role:'warehouse',name:'仓管'};
const people=[a,b,w];
const task=()=>({shopId:'s',orderId:'o',orderStatus:'维修中',version:1,stage:'待开工',acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'},{name:'耗材',quantity:2,unit:'片'}],photoIds:[],recordedBy:'a'},items:[{id:1,name:'保养',status:'待开工',responsibleId:'a'},{id:2,name:'检查',status:'待开工',responsibleId:'b'}]});
const act=(t,rows,actor=w)=>applyDispatchAction(t,{action:'confirm-parts',expectedVersion:t.version,requestId:'preparation-test',partsPreparation:rows},actor,people,'2026-10-22T06:00:00Z');
test('partial preparation keeps pending items; final preparation ends warehouse work without issuing',()=>{
 const original=task(),first=act(original,[{index:0,recipientId:'a'}]);
 assert.equal(first.stage,'待开工');assert.equal(first.partsRequirement.preparedAt,undefined);
 assert.equal(first.partsRequirement.items[0].preparedName,'仓管');assert.equal(first.partsRequirement.items[0].recipientName,'甲');assert.equal(first.partsRequirement.items[1].preparedAt,undefined);
 assert.equal(first.partsRequirement.items[0].issuedAt,undefined);assert.deepEqual(original,task());
 const last=act(first,[{index:1,recipientId:'b'}]);
 assert.equal(last.stage,'维修中');assert.ok(last.partsRequirement.preparedAt);assert.equal(last.partsRequirement.issuedAt,undefined);
 assert.deepEqual(last.partsRequirement.recipientIds,['a','b']);assert.deepEqual(last.partsRequirement.items[0],first.partsRequirement.items[0]);
 assert.ok(last.items.every(i=>!i.pickedAt));
});
test('preparation validates selection, actor and recipient; cannot repeat completed lines',()=>{
 for(const rows of [[],[{index:0,recipientId:'a'},{index:0,recipientId:'b'}],[{index:10,recipientId:'a'}],[{index:0,recipientId:'w'}]])assert.throws(()=>act(task(),rows));
 assert.throws(()=>act(task(),[{index:0,recipientId:'a'}],a),e=>e.status===403);
 const first=act(task(),[{index:0,recipientId:'a'}]);
 assert.throws(()=>act(first,[{index:0,recipientId:'a'}]),/已备齐/);
 const last=act(first,[{index:1,recipientId:'b'}]);assert.throws(()=>act(last,[{index:1,recipientId:'b'}]),/已备料完成/);
});

const individual=()=>{const t=task();t.partsRequests=['a','b'].map(id=>({...structuredClone(t.partsRequirement),ownerId:id,ownerName:id}));delete t.partsRequirement;return t;};
const batch=(t,groups,extra={},actor=w)=>applyDispatchAction(t,{action:'confirm-parts',preparationGroups:groups,expectedVersion:t.version,requestId:'batch-preparation-test',...extra},actor,people,'2026-10-22T06:00:00Z');
test('atomic multi-person preparation keeps each application and starts only fully prepared workers',()=>{
 const original=individual();
 const next=batch(original,[{partsOwnerId:'a',items:[{index:0,recipientId:'a'},{index:1,recipientId:'a'}]},{partsOwnerId:'b',items:[{index:0,recipientId:'b'}]}]);
 assert.deepEqual(original,individual());assert.equal(next.version,original.version+1);
 assert.ok(next.partsRequests.find(p=>p.ownerId==='a').preparedAt);assert.equal(next.partsRequests.find(p=>p.ownerId==='b').preparedAt,undefined);
 assert.equal(next.items.find(i=>i.responsibleId==='a').status,'维修中');assert.equal(next.items.find(i=>i.responsibleId==='b').status,'待开工');
 assert.equal(next.partsRequests.find(p=>p.ownerId==='b').items[1].preparedAt,undefined);
});
test('batch rejects mixed, malformed, duplicate, unauthorized and stale operations without mutation',()=>{
 const original=individual(),before=structuredClone(original);
 const first={partsOwnerId:'a',items:[{index:0,recipientId:'a'}]};
 for(const groups of [[],[first,first],[{}],[{partsOwnerId:'a',items:[]}],[first,{partsOwnerId:'b',items:[{index:7,recipientId:'b'}]}],[first,{partsOwnerId:'b',items:[{index:0,recipientId:'w'}]}],[{partsOwnerId:'missing',items:first.items}]]){
  assert.throws(()=>batch(original,groups));assert.deepEqual(original,before);
 }
 assert.throws(()=>batch(original,[first],{partsPreparation:first.items}));
 assert.throws(()=>batch(original,[first],{},a),e=>e.status===403);
 assert.throws(()=>batch(original,[first],{expectedVersion:0}),/已更新/);
 const done=batch(original,[first]);assert.throws(()=>batch(done,[first]),/已备齐/);
});
test('batch supports shared legacy applications and skips unselected photo requests',()=>{
 const legacy=batch(task(),[{items:[{index:0,recipientId:'b'}]}]);assert.equal(legacy.partsRequirement.items[0].recipientId,'b');
 const mixed=individual();Object.assign(mixed.partsRequests[1],{mode:'photo',photoIds:['photo'],items:[]});
 const next=batch(mixed,[{partsOwnerId:'a',items:[{index:0,recipientId:'a'}]}]);assert.deepEqual(next.partsRequests.find(p=>p.ownerId==='b'),mixed.partsRequests[1]);
});

test('photo-only legacy request can be prepared without inventing line items',()=>{
 const original={...task(),technicianIds:['a'],items:[task().items[0]],partsRequirement:{mode:'photo',items:[],photoIds:['p1','p2'],revision:2,batch:1}};
 const next=applyDispatchAction(original,{action:'confirm-parts',expectedVersion:original.version,requestId:'photo-prepare'},w,people,'2026-10-28T01:00:00Z');
 assert.equal(next.partsRequirement.preparedAt,'2026-10-28T01:00:00Z');
 assert.equal(next.partsRequirement.preparedBy,w.id);assert.equal(next.partsRequirement.issuedAt,undefined);
 assert.deepEqual(next.partsRequirement.photoIds,['p1','p2']);assert.deepEqual(next.partsRequirement.items,[]);
 assert.equal(next.stage,'维修中');assert.equal(original.partsRequirement.preparedAt,undefined);
 assert.throws(()=>applyDispatchAction(next,{action:'confirm-parts',expectedVersion:next.version,requestId:'photo-repeat'},w,people),/已备料完成/);
});

test('photo preparation isolates personal, legacy and coworker requirements',()=>{
 const original=individual();original.partsRequirement={...task().partsRequirement,preparedAt:'earlier',preparedBy:'w'};
 Object.assign(original.partsRequests[1],{mode:'photo',photoIds:['personal-photo'],items:[]});
 const next=applyDispatchAction(original,{action:'confirm-parts',partsOwnerId:'b',expectedVersion:original.version,requestId:'personal-photo'},w,people,'now');
 assert.ok(next.partsRequests.find(p=>p.ownerId==='b').preparedAt);
 assert.deepEqual(next.partsRequests.find(p=>p.ownerId==='a'),original.partsRequests[0]);
 assert.deepEqual(next.partsRequirement,original.partsRequirement);
 assert.deepEqual(next.items[0],original.items[0]);assert.equal(next.items[1].status,'维修中');
 assert.throws(()=>applyDispatchAction(next,{action:'confirm-parts',partsOwnerId:'b',expectedVersion:original.version,requestId:'stale-photo'},w,people),/已更新/);
});
