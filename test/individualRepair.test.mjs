import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction,assertDispatchAccess} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'维修甲',role:'technician',shopId:'s',active:true},b={...a,id:'b',name:'维修乙'},w={...a,id:'w',name:'仓管',role:'warehouse'};
const people=[a,b,w];
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',acceptedAt:'accepted',version:1,technicianIds:['a','b'],items:[{id:1,name:'保养',status:'维修中',responsibleId:'a',responsibleName:a.name,startedBy:'a'},{id:2,name:'检查',status:'维修中',responsibleId:'b',responsibleName:b.name,startedBy:'b'}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,requestId:'individual-repair',expectedVersion:task.version,...extra},actor,people,'2026-10-22T01:00:00Z');
const parts=name=>({mode:'list',items:[{name,quantity:1,unit:'个'}],photoIds:[]});
test('each worker completes only their projects and last submission enters inspection',()=>{
 const original=base(),first=act(original,a,'submit-order',{note:'甲已完成'});
 assert.equal(first.stage,'维修中');assert.deepEqual(first.items[1],original.items[1]);assert.equal(first.items[0].finishedBy,'a');assert.equal(first.submittedAt,undefined);
 assert.throws(()=>act(first,a,'submit-order'),/已提交/);
 assert.throws(()=>act(first,a,'record-parts',{partsRequirement:parts('滤芯')}),/已提交/);
 const final=act(first,b,'submit-order',{note:'乙已完成'});
 assert.equal(final.stage,'待检验');assert.equal(final.items[1].finishedBy,'b');assert.match(final.submissionNote,/甲已完成/);assert.match(final.submissionNote,/乙已完成/);
 assert.deepEqual(original,base());
});
test('requests, preparation and issue stay separate; other worker pending parts do not block completion',()=>{
 const first=act(base(),a,'record-parts',{partsRequirement:parts('滤芯')});
 const second=act(first,b,'record-parts',{partsRequirement:parts('雨刮')});
 assert.equal(second.partsRequests.length,2);assert.deepEqual(second.partsRequests[0],first.partsRequests[0]);
 assert.doesNotThrow(()=>assertDispatchAccess(second,w));
 assert.throws(()=>act(second,a,'submit-order'),/确认配件备齐/);
 let next=act(second,w,'confirm-parts',{partsOwnerId:'a'});
 assert.equal(next.partsRequests.find(p=>p.ownerId==='b').preparedAt,undefined);

 assert.ok(next.partsRequests.find(p=>p.ownerId==='a').preparedAt);assert.equal(next.items[1].pickedAt,undefined);
 next=act(next,a,'submit-order');assert.equal(next.stage,'维修中');
 assert.throws(()=>act(next,b,'submit-order'),/确认配件备齐/);
 next=act(next,w,'confirm-parts',{partsOwnerId:'b'});
 assert.equal(act(next,b,'submit-order').stage,'待检验');
});
test('one worker cannot mutate another project or application, or bypass submission',()=>{
 const task=act(base(),b,'record-parts',{partsRequirement:parts('雨刮')});
 assert.throws(()=>act(task,a,'record-parts',{partsOwnerId:'b',partsRequirement:parts('滤芯')}),e=>e.status===403);
 for(const action of ['edit-repair-items','submit-order'])assert.throws(()=>act(task,a,action,{repairItems:task.items.map(i=>({id:i.id,name:i.name,responsibleId:i.responsibleId}))}),e=>e.status===403);
 for(const action of ['start','pick'])assert.throws(()=>act(task,a,action,{itemId:2}),e=>e.status===403);
 assert.throws(()=>act(task,a,'finish',{itemId:1}),/提交本人完工/);
 assert.throws(()=>act(task,a,'submit',{inspectorId:'w'}),/分别提交/);
 assert.throws(()=>act(task,w,'confirm-parts'),/没有待处理/);
 assert.throws(()=>act(task,w,'confirm-parts',{partsOwnerId:'missing'}),/不存在/);
 assert.throws(()=>act({...task,needsReview:true},a,'submit-order'),/核对/);
});
test('issue auto-starts only requester pending projects even while coworker is already working',()=>{
 const task=base();task.items[1].status='待开工';delete task.items[1].startedBy;
 let next=act(task,b,'record-parts',{partsRequirement:parts('雨刮')});
 next=act(next,w,'confirm-parts',{partsOwnerId:'b'});
 assert.equal(next.items[1].status,'维修中');assert.equal(next.items[1].startedBy,'b');assert.deepEqual(next.items[0],task.items[0]);
});
test('acceptance starts only accepter work; others can request later, and stale submissions conflict',()=>{
 const task={...base(),stage:'待接单',acceptedAt:undefined,items:base().items.map(i=>({...i,status:'待开工',startedBy:undefined}))};
 const next=act(task,a,'accept',{partsRequirement:{mode:'none'}});
 assert.equal(next.items[0].status,'维修中');assert.equal(next.items[1].status,'待开工');
 const updated=act(next,b,'record-parts',{partsRequirement:parts('雨刮')});assert.equal(updated.partsRequests.length,2);
 assert.throws(()=>act(updated,a,'submit-order',{expectedVersion:next.version}),/已更新/);
});
test('legacy shared material gate is preserved and new applications never overwrite it',()=>{
 const task={...base(),partsRequirement:{...parts('旧共同申请'),recordedBy:'a'}};
 const next=act(task,b,'record-parts',{partsRequirement:parts('乙新增')});
 assert.deepEqual(next.partsRequirement,task.partsRequirement);
 assert.throws(()=>act(next,a,'submit-order'),/历史共同配件/);
});
test('legacy item-level completions can still be submitted without resubmitting coworkers',()=>{
 const task={...base(),items:base().items.map(i=>({...i,status:'待检验',finishedBy:i.responsibleId}))};
 const next=act(task,a,'submit-order');assert.equal(next.stage,'待检验');assert.equal(next.items[1].finishedBy,'b');
});
