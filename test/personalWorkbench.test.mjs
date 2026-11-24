import test from 'node:test';import assert from 'node:assert/strict';
import {personalOrderTodos} from '../server/domain/personalWorkbench.mjs';
const person=(id,roles)=>({id,name:id,shopId:'s',active:true,role:roles[0],roles});
const task={orderId:'o',shopId:'s',advisor:'a',stage:'待派工',items:[],plate:'鲁B测试'};
test('personal todos isolate handler, shop, inactive and deduplicate multi-role work',()=>{
 assert.equal(personalOrderTodos(task,person('a',['advisor','manager'])).length,1);
 assert.equal(personalOrderTodos(task,person('b',['manager'])).length,0);
 assert.equal(personalOrderTodos(task,{...person('a',['advisor']),shopId:'else'}).length,0);
 assert.equal(personalOrderTodos(task,{...person('a',['advisor']),active:false}).length,0);
 assert.equal(personalOrderTodos({...task,stage:'维修完成'},person('a',['advisor']),{state:'pending'})[0].category,'签字待确认');
});
test('inspection membership and current claim determine personal todo eligibility',()=>{
 const t={...task,stage:'待检验',technicianIds:['worker'],participantIds:['previous'],items:[{id:1,status:'待检验',responsibleId:'worker'}]};
 assert.equal(personalOrderTodos(t,person('worker',['technician','inspector'])).length,1);
 assert.equal(personalOrderTodos(t,person('previous',['inspector'])).length,1);
 assert.equal(personalOrderTodos(t,person('inspect',['inspector']))[0].category,'待检验');
 assert.equal(personalOrderTodos({...t,inspectorId:'another'},person('inspect',['inspector'])).length,0);
 assert.equal(personalOrderTodos(t,person('admin',['manager'])).length,0);
});
test('own completed projects disappear even when teammates are still repairing',()=>{
 const t={...task,stage:'维修中',technicianIds:['one','two'],items:[{id:1,responsibleId:'one',status:'已完工'},{id:2,responsibleId:'two',status:'维修中'}]};
 assert.equal(personalOrderTodos(t,person('one',['technician'])).length,0);
 assert.equal(personalOrderTodos(t,person('two',['technician']))[0].category,'维修中');
});
test('declined acceptance moves the action to the current handler',()=>{
 const t={...task,stage:'待接单',technicianIds:['worker'],feedback:'无法接单'};
 assert.equal(personalOrderTodos(t,person('a',['advisor']))[0].category,'无法接单待处理');
 assert.equal(personalOrderTodos(t,person('worker',['technician'])).length,0);
 assert.equal(personalOrderTodos(t,person('other',['manager'])).length,0);
});

test('warehouse todos count individual pending applications using warehouse list eligibility',()=>{
 const parts=(ownerId,extra={})=>({ownerId,mode:'list',items:[{name:'配件'}],...extra});
 const t={...task,stage:'维修中',acceptedAt:'2026-11-16T00:00:00Z',partsRequirement:parts(undefined),partsRequests:[parts('one'),parts('two',{items:[{name:'已备',preparedAt:'now'},{name:'未备'}]}),parts('done',{preparedAt:'now'}),parts('none',{mode:'none'})]};
 const rows=personalOrderTodos(t,person('w',['warehouse']));
 assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.id)).size,3);
 assert.deepEqual(rows.map(row=>[row.targetId,row.partsOwnerId]),[['o',''],['o','one'],['o','two']]);
 const remaining=personalOrderTodos({...t,partsRequirement:undefined},person('w',['warehouse']));
 assert.deepEqual(remaining.map(r=>r.id),rows.slice(1).map(r=>r.id));
 for(const change of [{acceptedAt:undefined},{needsReview:true},{stage:'待检验'}])assert.equal(personalOrderTodos({...t,...change},person('w',['warehouse'])).length,0);
});
