import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyDispatchAction, validateDispatchRequest, dispatchMetric } from '../server/domain/dispatchPolicy.mjs';
import { canEditDispatchDue } from '../shared/dispatchDuePolicy.mjs';
const now='2026-10-22T04:00:00.000Z';
const task={orderId:'order',shopId:'shop',orderStatus:'已委托',stage:'待开工',version:7,dueAt:'2026-10-21T04:00:00.000Z',urgent:true,note:'保留原备注',technicianId:'worker',technicianIds:['worker'],items:[{id:1,name:'维修项目',status:'待开工',responsibleId:'worker'}],partsRequirement:{mode:'none',items:[],photoIds:[]}};
const actor=role=>({id:role==='technician'?'worker':role,name:role,role,active:true,shopId:'shop'});
const input=(extra={})=>({action:'update-due',expectedVersion:task.version,requestId:randomUUID(),dueAt:'2026-10-23T18:00:00+08:00',...extra});
const apply=(user,patch={},body=input())=>applyDispatchAction({...structuredClone(task),...patch},body,user,[],now);

test('advisors, managers and inspectors can change only the due date',()=>{
  for(const role of ['advisor','manager','inspector']) {
    const result=apply(actor(role));
    assert.equal(canEditDispatchDue(task,actor(role)),true);
    assert.deepEqual(result,{...task,dueAt:'2026-10-23T10:00:00.000Z',version:8});
    assert.equal(task.dueAt,'2026-10-21T04:00:00.000Z');
  }
});
test('worker, warehouse and outsourcing roles cannot change the due date',()=>{
  for(const role of ['technician','warehouse','outsourcing']) {
    assert.equal(canEditDispatchDue(task,actor(role)),false);
    assert.throws(()=>apply(actor(role)),error=>error.status===403);
  }
});
test('cross-shop and inactive users are rejected; secondary inspector roles work',()=>{
  for(const user of [{...actor('inspector'),active:false},{...actor('manager'),shopId:'elsewhere'}]) {
    assert.equal(canEditDispatchDue(task,user),false);
    assert.throws(()=>apply(user),error=>error.status===403);
  }
  const user={...actor('technician'),roles:['technician','inspector']};
  assert.equal(canEditDispatchDue(task,user),true);
  assert.equal(apply(user).version,8);
});
test('unsigned, completed and unreconciled tasks cannot be edited',()=>{
  for(const patch of [{orderStatus:'草稿'},{orderStatus:'待客户签字'},{orderStatus:'待处理纸质委托书'},{orderStatus:'完成'},{stage:'维修完成'},{needsReview:true}]) {
    assert.equal(canEditDispatchDue({...task,...patch},actor('inspector')),false);
    assert.throws(()=>apply(actor('inspector'),patch),error=>error.status===409);
  }
  for(const stage of ['待派工','待接单','待开工','维修中','暂停','待检验','回审']) {
    const items=stage==='待检验'?task.items.map(item=>({...item,status:'待检验'})):task.items;
    assert.equal(apply(actor('inspector'),{stage,items}).stage,stage);
  }
});
test('missing, invalid and timezone-free dates or unrelated changes are rejected',()=>{
  for(const dueAt of [undefined,'','2026-10-23T18:00','bad','2026-02-30T18:00:00+08:00','2026-10-23T24:00:00+08:00']) {
    assert.throws(()=>validateDispatchRequest(input({dueAt})),error=>error.status===400);
  }
  for(const extra of [{urgent:false},{note:'篡改备注'},{technicianId:'other'},{repairItems:[]}]) {
    assert.throws(()=>apply(actor('inspector'),{},input(extra)),error=>error.status===400);
  }
});
test('inspectors do not gain general dispatch update privileges and stale versions fail',()=>{
  assert.throws(()=>apply(actor('inspector'),{},input({action:'update',urgent:false})),error=>error.status===403);
  assert.throws(()=>apply(actor('manager'),{},input({expectedVersion:6})),error=>error.status===409);
});
test('new due time is used by overdue metrics, including Beijing day boundaries',()=>{
  assert.equal(dispatchMetric(task,'overdue',undefined,undefined,new Date(now)),true);
  const next=apply(actor('advisor'),{},input({dueAt:'2026-10-23T00:00:00+08:00'}));
  assert.equal(next.dueAt,'2026-10-22T16:00:00.000Z');
  assert.equal(dispatchMetric(next,'overdue',undefined,undefined,new Date(now)),false);
});
