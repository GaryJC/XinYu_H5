import test from 'node:test';
import assert from 'node:assert/strict';
import {sortDispatchTasks} from '../server/domain/dispatchTaskSort.mjs';
import {pageResult} from '../server/domain/pagination.mjs';
const actor={id:'a'};
const make=(orderId,assignedAt,dueAt,extra={})=>({orderId,assignedAt,dueAt,stage:'维修中',items:[],technicianIds:['a'],...extra});
const tasks=[make('late','2026-11-03T00:00:00Z','2026-11-04T00:00:00Z',{urgent:true}),make('early','2026-11-01T00:00:00Z','2026-11-06T00:00:00Z'),make('middle','2026-11-02T00:00:00Z','2026-11-05T00:00:00Z'),make('missing',undefined,undefined),make('invalid','invalid','invalid')];
const ids=rows=>rows.map(t=>t.orderId);
test('personal lists default to oldest assignment and support both directions and date fields',()=>{
 const before=structuredClone(tasks);
 assert.deepEqual(ids(sortDispatchTasks(tasks,actor,{personal:'true'})),['early','middle','late','missing','invalid']);
 for(const [sort,expected] of [['assigned-asc',['early','middle','late']],['assigned-desc',['late','middle','early']],['due-asc',['late','middle','early']],['due-desc',['early','middle','late']]]) {
  assert.deepEqual(ids(sortDispatchTasks(tasks,actor,{sort})),[...expected,'missing','invalid']);
 }
 assert.deepEqual(tasks,before);
 assert.equal(sortDispatchTasks(tasks,actor,{}),tasks);
 assert.throws(()=>sortDispatchTasks(tasks,actor,{sort:'bad'}),e=>e.status===400);
});
test('review and rework priority precede date sorting across pages; additional repairs remain ordinary',()=>{
 const many=Array.from({length:23},(_,i)=>make(`w${i}`,'2026-11-01T00:00:00Z'));
 const review=make('review','2026-11-05T00:00:00Z',undefined,{stage:'回审',rework:true});
 const rework=make('rework','2026-11-04T00:00:00Z',undefined,{repairRound:1});
 const additional=make('additional','2026-11-06T00:00:00Z',undefined,{repairRound:1,roundKind:'additional'});
 const sorted=sortDispatchTasks([...many,additional,rework,review],actor,{personal:'true',stage:'待处理'});
 assert.deepEqual(ids(sorted),['review','rework',...ids(many),'additional']);
 assert.deepEqual(ids(pageResult(sorted,{page:'1',pageSize:'20'}).items.slice(0,2)),['review','rework']);
 assert.equal(sortDispatchTasks([review,rework,additional],actor,{personal:'true',stage:'进行中'})[0],rework);
});
