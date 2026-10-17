import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/unused';
const {parseStockSearch,searchWarehouseStock,warehouseStockOptions}=await import('../server/services/warehouseStockService.mjs');
import {assertDispatchAccess} from '../server/domain/dispatchPolicy.mjs';
import {buildRunfengPartsQuery,escapeStockSearch,findRunfengParts,listRunfengWarehouses} from '../server/repositories/runfengStockRepository.mjs';
const actor={id:'warehouse',role:'warehouse',active:true,shopId:'s'};
const task={shopId:'s',orderStatus:'待派工',partsRequirement:{mode:'list',items:[{name:'机油',quantity:1,unit:'升'}]}};
const deps={configured:()=>true,getTask:async(_db,id,user)=>{assert.equal(id,'o');assertDispatchAccess(task,user);return task;},findParts:async filters=>({items:[],hasMore:false})};

test('stock search validates bounded keywords, tokens, warehouse IDs and boolean filters',()=>{
 assert.deepEqual(parseStockSearch({query:' 机油  5W30 '}),{query:'机油  5W30',tokens:['机油','5W30'],warehouseId:undefined,inStockOnly:true});
 assert.equal(parseStockSearch({query:'滤芯',warehouseId:'13',inStockOnly:'false'}).warehouseId,13);
 for(const input of [{},{query:[]},{query:' '},{query:'x'.repeat(81)},{query:'1 2 3 4 5 6 7'},{query:'机油',warehouseId:'11 OR 1=1'},{query:'机油',warehouseId:'0'},{query:'机油',warehouseId:'2147483648'},{query:'机油',inStockOnly:'yes'}])assert.throws(()=>parseStockSearch(input),e=>e.status===400);
});
test('only authorized active warehouse or manager can search an accessible parts order',async()=>{
 for(const user of [{...actor,active:false},{...actor,role:'technician'},{...actor,role:'advisor'},{...actor,shopId:'other'}])await assert.rejects(()=>searchWarehouseStock(user,'o',{query:'机油'},deps),e=>e.status===403);
 let lookups=0;const result=await searchWarehouseStock(actor,'o',{query:'机油',inStockOnly:'false'},{...deps,findParts:async filters=>{lookups++;assert.equal(filters.inStockOnly,false);return {items:[],hasMore:false};}});
 assert.equal(lookups,1);assert.equal(result.source,'润丰');assert.equal(result.query,'机油');assert.ok(Number.isFinite(Date.parse(result.queriedAt)));
 await warehouseStockOptions({...actor,role:'manager'},'o',{...deps,listWarehouses:async()=>[]});
 for(const order of [{...task,partsRequirement:undefined},{...task,orderStatus:'草稿'},{...task,orderStatus:'待客户签字'}])await assert.rejects(()=>searchWarehouseStock(actor,'o',{query:'机油'},{...deps,getTask:async()=>order}),e=>e.status===409);
});
test('missing Runfeng configuration never falls back and connection errors disclose no details',async()=>{
 let queried=false;
 await assert.rejects(()=>searchWarehouseStock(actor,'o',{query:'机油'},{...deps,configured:()=>false,findParts:async()=>{queried=true;}}),e=>e.status===503);
 assert.equal(queried,false);
 for(const run of [()=>searchWarehouseStock(actor,'o',{query:'机油'},{...deps,findParts:async()=>{throw new Error('server and credential details');}}),()=>warehouseStockOptions(actor,'o',{...deps,listWarehouses:async()=>{throw new Error('private details');}})])await assert.rejects(run,e=>e.status===502&&!/details/.test(e.message));
});
test('SQL Server 2000 search binds literal wildcard terms and never interpolates user input',async()=>{
 const query="机油 %_[' OR 1=1";
 let recorded;
 const result=await findRunfengParts({query,tokens:[query],warehouseId:13,inStockOnly:true},async(statement,configure)=>{
  const params={};configure({input:(key,_type,value)=>{params[key]=value;}},{Int:'Int',Bit:'Bit',NVarChar:n=>`NVarChar(${n})`});recorded={statement,params};return {recordset:[]};
 });
 assert.deepEqual(result,{items:[],hasMore:false});assert.equal(recorded.params.warehouse_id,13);assert.equal(recorded.params.in_stock_only,true);
 assert.equal(recorded.params.term0,`%${escapeStockSearch(query)}%`);assert.equal(escapeStockSearch('%_['),'~%~_~[');
 assert.ok(!recorded.statement.includes(query));assert.match(recorded.statement,/select top 31/);assert.match(recorded.statement,/s\.jcsl>0/);assert.match(recorded.statement,/w\.bm=s\.bm and w\.mc=s\.ck/);
 assert.doesNotMatch(recorded.statement,/\b(insert|update|delete|merge|offset)\b/i);
 assert.throws(()=>buildRunfengPartsQuery(7));assert.throws(()=>buildRunfengPartsQuery('1'));
});
test('bounded results retain units, department, warehouse, location and unknown versus zero quantity',async()=>{
 const statements=[];
 const result=await findRunfengParts({query:'机油',tokens:['机油'],inStockOnly:false},async(statement,configure)=>{
  const params={};configure({input:(key,_type,value)=>{params[key]=value;}},{Int:'Int',Bit:'Bit',NVarChar:n=>n,VarChar:n=>n});statements.push({statement,params});
  return {recordset:statements.length===1?Array.from({length:31},(_,i)=>({code:`H${i} `,name:'机油 ',specification:'5W30 ',unit:'桶 ',reference_code:'REF',manufacturer:'厂家',models:'车型'})):[{code:'H0',department_code:'A ',department_name:'机电一部 ',warehouse:'配件库 ',location:'A-2 ',quantity:0},{code:'h0 ',department_code:'F',department_name:'市南分厂',warehouse:'配件库',location:'B-1',quantity:null}]};
 });
 assert.equal(result.hasMore,true);assert.equal(result.items.length,30);assert.equal(result.items[0].unit,'桶');assert.equal(result.items[0].stocks[0].quantity,0);assert.equal(result.items[0].stocks[0].location,'A-2');assert.equal(result.items[0].stocks[1].quantity,null);
 assert.equal(Object.keys(statements[1].params).filter(k=>k.startsWith('code')).length,30);assert.match(statements[1].statement,/sum\(s\.jcsl\)/);assert.equal(result.items[1].stocks.length,0);
});
test('same named warehouses keep their distinct department and ID',async()=>{
 const result=await listRunfengWarehouses(async()=>({recordset:[{id:11,department_code:'A ',department_name:'机电一部',name:'配件库 '},{id:13,department_code:'F',department_name:'市南分厂',name:'配件库'}]}));
 assert.equal(result[0].name,result[1].name);assert.notEqual(result[0].departmentCode,result[1].departmentCode);assert.notEqual(result[0].id,result[1].id);
});
