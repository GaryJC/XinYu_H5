import test from 'node:test';
import assert from 'node:assert/strict';
import {sortDispatchTasks} from '../server/domain/dispatchTaskSort.mjs';
import {pageResult} from '../server/domain/pagination.mjs';
const actor={id:'a'};
const make=(orderId,assignedAt,dueAt,extra={})=>({orderId,assignedAt,dueAt,stage:'维修中',items:[],technicianIds:['a'],...extra});
const tasks=[make('late','2026-11-03T00:00:00Z','2026-11-04T00:00:00Z',{urgent:true}),make('early','2026-11-01T00:00:00Z','2026-11-06T00:00:00Z'),make('middle','2026-11-02T00:00:00Z','2026-11-05T00:00:00Z'),make('missing',undefined,undefined),make('invalid','invalid','invalid')];
const ids=rows=>rows.map(t=>t.orderId);
test('personal lists default to dispatch number and support both directions and date fields',()=>{
 const before=structuredClone(tasks);
 const numbered=[{dispatchNo:'A9'},{dispatchNo:''},{dispatchNo:'B2'},{dispatchNo:'A100'}];
 for(const query of [{},{personal:'true'}])assert.deepEqual(sortDispatchTasks(numbered,actor,query).map(t=>t.dispatchNo),['A100','A9','B2','']);
 for(const [sort,expected] of [['assigned-asc',['early','middle','late']],['assigned-desc',['late','middle','early']],['due-asc',['late','middle','early']],['due-desc',['early','middle','late']]]) {
  assert.deepEqual(ids(sortDispatchTasks(tasks,actor,{sort})),[...expected,'missing','invalid']);
 }
 assert.deepEqual(tasks,before);
 assert.deepEqual(sortDispatchTasks(tasks,actor,{}),tasks);
 assert.throws(()=>sortDispatchTasks(tasks,actor,{sort:'bad'}),e=>e.status===400);
});
test('review and rework priority precede date sorting across pages; additional repairs remain ordinary',()=>{
 const many=Array.from({length:23},(_,i)=>make(`w${i}`,'2026-11-01T00:00:00Z'));
 const review=make('review','2026-11-05T00:00:00Z',undefined,{stage:'回审',rework:true});
 const rework=make('rework','2026-11-04T00:00:00Z',undefined,{repairRound:1});
 const additional=make('additional','2026-11-06T00:00:00Z',undefined,{repairRound:1,roundKind:'additional'});
 const sorted=sortDispatchTasks([...many,additional,rework,review],actor,{personal:'true',stage:'待处理',sort:'assigned-asc'});
 assert.deepEqual(ids(sorted),['review','rework',...ids(many),'additional']);
 assert.deepEqual(ids(pageResult(sorted,{page:'1',pageSize:'20'}).items.slice(0,2)),['review','rework']);
 assert.equal(sortDispatchTasks([review,rework,additional],actor,{personal:'true',stage:'进行中',sort:'assigned-asc'})[0],rework);
});

test('dispatch number order applies across stages before pagination, with unnumbered rows last', () => {
  const rows = ['A9', null, 'B10', 'A100', 'B002', 'A010'].map((dispatchNo, i) => ({
    ...make(String(i)), dispatchNo, stage: i % 2 ? '回审' : '维修中'
  }));
  const secondPage = sort => {
    const sorted = sortDispatchTasks(rows, actor, {personal:'true', stage:'待处理', sort});
    return pageResult(sorted, {page:2, pageSize:3}).items.map(t => t.dispatchNo);
  };
  assert.deepEqual(secondPage(undefined), ['A9', 'B002', null]);
  assert.deepEqual(secondPage('dispatch-asc'), ['B10', 'A100', null]);
});
