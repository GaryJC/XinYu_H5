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
test('inspection independence and current claim determine personal todo eligibility',()=>{
 const t={...task,stage:'待检验',technicianIds:['worker'],participantIds:['previous'],items:[{id:1,status:'待检验',responsibleId:'worker'}]};
 assert.equal(personalOrderTodos(t,person('worker',['technician','inspector'])).length,0);
 assert.equal(personalOrderTodos(t,person('previous',['inspector'])).length,0);
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
