import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'维修甲',role:'technician',active:true,shopId:'s'},b={...a,id:'b',name:'维修乙'},w={...a,id:'w',role:'warehouse',name:'仓管'};
const people=[a,b,w];
const parts=()=>({mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'},{name:'砂轮片',quantity:2,unit:'片'}],photoIds:[],recordedBy:'a',recordedName:'维修甲'});
const task=()=>({shopId:'s',orderId:'o',orderStatus:'维修中',version:1,stage:'待开工',acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',technicianName:'维修甲、维修乙',partsRequirement:parts(),items:[{id:1,name:'保养',status:'待开工',responsibleId:'a'},{id:2,name:'检查',status:'待开工',responsibleId:'b'}]});
const act=(t,extra,actor=w)=>applyDispatchAction(t,{action:'issue-parts',expectedVersion:t.version,requestId:'partial-parts-test',...extra},actor,people,'2026-10-22T06:00:00Z');
test('selected ready items issue to distinct recipients; remainder stays pending until next issue',()=>{
 const original=task(),first=act(original,{partsIssue:[{index:0,recipientId:'a'}]});
 assert.equal(first.stage,'待开工');assert.equal(first.partsRequirement.issuedAt,undefined);
 assert.equal(first.partsRequirement.items[0].recipientName,'维修甲');assert.equal(first.partsRequirement.items[0].issuedName,'仓管');assert.equal(first.partsRequirement.items[1].issuedAt,undefined);
 assert.deepEqual(first.partsRequirement.recipientIds,['a']);assert.deepEqual(original,task());
 const last=act(first,{partsIssue:[{index:1,recipientId:'b'}]});
 assert.equal(last.stage,'维修中');assert.ok(last.partsRequirement.issuedAt);assert.deepEqual(last.partsRequirement.recipientIds,['a','b']);assert.equal(last.partsRequirement.items[1].recipientName,'维修乙');assert.deepEqual(last.partsRequirement.items[0],first.partsRequirement.items[0]);
});
test('personal request defaults to owner for legacy callers but supports actual handover to another assigned worker',()=>{
 const t=task();t.partsRequests=[{...parts(),ownerId:'a',ownerName:a.name,preparedAt:'ready'}];delete t.partsRequirement;
 const next=act(t,{partsOwnerId:'a',partsIssue:[{index:0,recipientId:'a'},{index:1,recipientId:'b'}]});
 assert.deepEqual(next.partsRequests[0].items.map(i=>i.recipientName),['维修甲','维修乙']);
 assert.equal(next.items[1].status,'待开工');assert.equal(next.partsRequests[0].ownerId,'a');
 const automatic=act(t,{partsOwnerId:'a'});assert.ok(automatic.partsRequests[0].items.every(i=>i.recipientId==='a'));
});
test('rejects duplicate, already issued, invalid, unauthorized and stale selections',()=>{
 const original=task(),first=act(original,{partsIssue:[{index:0,recipientId:'a'}]});
 for(const partsIssue of [[],[{index:0,recipientId:'a'},{index:0,recipientId:'b'}],[{index:-1,recipientId:'a'}],[{index:10,recipientId:'a'}],[{index:0,recipientId:'w'}],[{index:0,recipientId:'outsider'}]])assert.throws(()=>act(original,{partsIssue}));
 assert.throws(()=>act(first,{partsIssue:[{index:0,recipientId:'a'}]}),/已出库/);
 assert.throws(()=>act(first,{expectedVersion:original.version,partsIssue:[{index:1,recipientId:'b'}]}),/已更新/);
 assert.throws(()=>act(original,{partsIssue:[{index:0,recipientId:'a'}]},a),e=>e.status===403);
 assert.throws(()=>act({...original,partsRequirement:{...parts(),preparedAt:'ready'}},{}),/逐项确认/);
 assert.throws(()=>act({...original,partsRequirement:{mode:'photo',photoIds:['photo'],items:[]}},{partsIssue:[{index:0,recipientId:'a'}]}),/整理为配件明细/);
 assert.throws(()=>act(first,{action:'edit-parts',partsRequirement:{mode:'none'}}),/部分处理/);
 const separate=act(first,{action:'record-parts',partsRequirement:{mode:'none'}},a);assert.deepEqual(separate.partsRequirement,first.partsRequirement);
 const personal={...first,partsRequirement:undefined,partsRequests:[{...first.partsRequirement,ownerId:'a',ownerName:a.name}]};
 assert.throws(()=>act(personal,{action:'record-parts',partsRequirement:{mode:'none'}},a),/部分处理/);
});
test('implicit personal batch issue preserves the recipients selected during preparation',()=>{
 const original=task();delete original.partsRequirement;
 original.partsRequests=[{...parts(),ownerId:'a',ownerName:a.name}];
 const prepared=act(original,{action:'confirm-parts',partsOwnerId:'a',partsPreparation:[{index:0,recipientId:'b'},{index:1,recipientId:'a'}]});
 const issued=act(prepared,{partsOwnerId:'a'});
 assert.deepEqual(issued.partsRequests[0].items.map(item=>item.recipientId),['b','a']);
 assert.deepEqual(issued.partsRequests[0].recipientIds,['b','a']);
 const partial=act(prepared,{partsOwnerId:'a',partsIssue:[{index:1,recipientId:'a'}]});
 const completed=act(partial,{partsOwnerId:'a'});
 assert.equal(completed.partsRequests[0].items[0].recipientId,'b');
 assert.deepEqual(completed.partsRequests[0].items[1],partial.partsRequests[0].items[1]);
});
test('implicit issue rejects a prepared recipient removed from the team instead of silently changing the recipient',()=>{
 const original=task();delete original.partsRequirement;
 original.partsRequests=[{...parts(),ownerId:'a',ownerName:a.name,preparedAt:'ready',items:parts().items.map(item=>({...item,preparedAt:'ready',recipientId:'b'}))}];
 original.technicianIds=['a'];
 const before=structuredClone(original);
 assert.throws(()=>act(original,{partsOwnerId:'a'}),e=>e.status===400);
 assert.deepEqual(original,before);
});
