import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyDispatchAction,assertDispatchAccess} from '../server/domain/dispatchPolicy.mjs';
const tech={id:'t',role:'technician',name:'维修工',active:true,shopId:'s'};
const inspector={id:'i',role:'inspector',name:'检验员',active:true,shopId:'s'};
const second={...inspector,id:'i2'};
const manager={...inspector,id:'m',role:'manager'};
const people=[tech,inspector,second,manager];
const task=()=>({orderId:'o',shopId:'s',technicianId:'t',technicianIds:['t'],stage:'待开工',version:0,items:[{id:1,name:'维修项目',status:'待开工'},{id:2,name:'已检验项目',status:'已完工',startAt:'old',finishAt:'old',inspectedBy:'i'}]});
const action=(t,a,u=tech,extra={})=>applyDispatchAction(t,{action:a,expectedVersion:t.version,requestId:randomUUID(),...(a==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...extra},u,people,'2026-10-14T10:00:00Z');
test('whole repair preserves passed projects and records actual actor before inspection claim',()=>{
 let t=action(task(),'start-order');assert.equal(t.items[0].status,'维修中');assert.equal(t.items[1].startAt,'old');
 t=action(t,'submit-order');assert.equal(t.stage,'待检验');assert.equal(t.inspectorId,undefined);assert.equal(t.items[0].finishedBy,'t');assert.equal(t.items[1].status,'已完工');
 assertDispatchAccess(t,inspector);assert.throws(()=>action(t,'inspect',inspector),e=>e.status===403);
 const claimed=action(t,'claim-inspection',inspector);assert.equal(claimed.inspectorId,'i');
 assert.throws(()=>action({...claimed,version:t.version},'claim-inspection',second));
 t=action(claimed,'inspect',inspector,{rejectedItemIds:[1],reason:'漏油'});assert.equal(t.reworkReason,'漏油');assert.equal(t.inspectorId,'i');
 t=action(t,'start-order');assert.equal(t.items[1].startAt,'old');assert.equal(t.items[0].status,'维修中');
 t=action(t,'submit-order');t=action(t,'claim-inspection',second);t=action(t,'inspect',second);assert.equal(t.stage,'维修完成');
});
test('ownership, current role, version, self-inspection and administrative reassignment are enforced',()=>{
 assert.throws(()=>action(task(),'start-order',inspector),e=>e.status===403);
 let t=action(action(task(),'start-order'),'submit-order');
 assert.throws(()=>action(t,'claim-inspection',{...inspector,shopId:'else'}),e=>e.status===403);
 assert.throws(()=>action(t,'claim-inspection',{...tech,role:'inspector'}),e=>e.status===403);
 const stale=t.version;t=action(t,'claim-inspection',inspector);
 assert.throws(()=>applyDispatchAction(t,{action:'claim-inspection',expectedVersion:stale,requestId:randomUUID()},second,people),e=>[403,409].includes(e.status));
 assert.throws(()=>action(t,'reassign-inspection',manager,{inspectorId:'i2'}),e=>e.status===400);
 assert.equal(action(t,'reassign-inspection',manager,{inspectorId:'i2',reason:'交班'}).inspectorId,'i2');
 assert.equal(action(t,'reassign-inspection',inspector,{inspectorId:'i2',reason:'检验交班'}).inspectorId,'i2');
 assert.throws(()=>action(task(),'submit-order'),e=>e.status===409);
 assert.equal(action(action(task(),'start-order'),'submit-order').stage,'待检验');
});

test('manager without inspector role can claim, reassign to self and complete inspection',()=>{
 const actor={...manager,inspectorRoleMember:false};
 const pending=action(action(task(),'start-order'),'submit-order');
 let claimed=action(pending,'claim-inspection',actor);
 assert.equal(claimed.inspectorId,actor.id);
 assert.equal(action(claimed,'inspect',actor).stage,'维修完成');
 claimed=action(pending,'claim-inspection',inspector);
 claimed=action(claimed,'reassign-inspection',actor,{inspectorId:manager.id,reason:'管理员接手'});
 assert.equal(claimed.inspectorId,manager.id);
 assert.equal(action(claimed,'inspect',actor).stage,'维修完成');
 for(const patch of [{technicianIds:[actor.id]},{participantIds:[actor.id]},{items:[{id:1,status:'待检验',responsibleId:actor.id}]}]) {
  assert.throws(()=>action({...pending,...patch},'claim-inspection',actor),e=>e.status===403);
 }
 for(const patch of [{active:false},{shopId:'other'}]) {
  assert.throws(()=>action(pending,'claim-inspection',{...actor,...patch}),e=>e.status===403);
 }
});
