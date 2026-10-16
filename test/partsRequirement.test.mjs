import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validatePartsRequirement} from '../server/domain/partsRequirement.mjs';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const tech={id:'t',name:'维修工',role:'technician',active:true,shopId:'s'};
const waiting=()=>({orderId:'o',shopId:'s',stage:'待接单',orderStatus:'待派工',version:1,technicianIds:['t'],items:[{id:1,name:'维修',status:'待开工'},{id:2,name:'已通过项目',status:'已完工',startAt:'2026-10-01',inspectedBy:'i'}]});
const input=(partsRequirement)=>({action:'accept',expectedVersion:1,requestId:randomUUID(),partsRequirement});
test('acceptance records parts and starts pending projects without overwriting inspected projects',()=>{
 const task=waiting(),original=structuredClone(task),now='2026-10-15T12:00:00Z';
 assert.throws(()=>applyDispatchAction(task,input(undefined),tech,[tech],now),e=>e.status===400);
 const next=applyDispatchAction(task,input({mode:'list',items:[{name:' 机油 ',quantity:4,unit:'升'}],photoIds:[],recordedBy:'forged'}),tech,[tech],now);
 assert.deepEqual(task,original);assert.equal(next.stage,'维修中');assert.equal(next.acceptedAt,now);assert.equal(next.firstStartedAt,now);assert.equal(next.items[0].startAt,now);assert.deepEqual(next.items[1],task.items[1]);assert.equal(next.partsRequirement.recordedBy,'t');assert.equal(next.partsRequirement.items[0].name,'机油');
});
test('parts modes enforce meaningful lists, quantities and photo selections',()=>{
 for(const value of [null,{}, {mode:'none',items:[{name:'机油',quantity:1,unit:'升'}]}, {mode:'list',items:[]},{mode:'list',items:[{name:' ',quantity:1,unit:'个'}]},{mode:'list',items:[{name:'机油',quantity:0,unit:'升'}]},{mode:'list',items:[{name:'机油',quantity:'1',unit:'升'}]},{mode:'photo',photoIds:[]},{mode:'photo',photoIds:['a','a']}])assert.throws(()=>validatePartsRequirement(value),e=>e.status===400);
 assert.deepEqual(validatePartsRequirement({mode:'none'}),{mode:'none',items:[],photoIds:[]});
 assert.equal(validatePartsRequirement({mode:'photo',photoIds:['f']}).photoIds[0],'f');
});
test('legacy accepted tasks can submit without a second start operation and retain passed inspection history',()=>{
 const task={...waiting(),stage:'待开工',acceptedAt:'2026-10-01T12:00:00Z'};
 const next=applyDispatchAction(task,{action:'submit-order',expectedVersion:1,requestId:randomUUID()},tech,[tech],'2026-10-15T12:00:00Z');
 assert.equal(next.stage,'待检验');assert.equal(next.items[0].status,'待检验');assert.deepEqual(next.items[1],task.items[1]);
});

const warehouse={id:'w',name:'仓管',role:'warehouse',active:true,shopId:'s'};
const request=(task,action,extra={})=>({action,expectedVersion:task.version,requestId:randomUUID(),...extra});
const withParts=()=>applyDispatchAction(waiting(),input({mode:'list',items:[{name:'机油',quantity:4,unit:'升'}]}),tech,[tech]);
test('warehouse confirmation records real identity and time without changing repair or inventory',()=>{
 const task=withParts(),before=structuredClone(task),now='2026-10-16T12:00:00Z';
 const next=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[],now);
 assert.deepEqual(task,before);assert.equal(next.partsRequirement.confirmedBy,'w');assert.equal(next.partsRequirement.confirmedName,'仓管');assert.equal(next.partsRequirement.confirmedAt,now);
 assert.deepEqual(next.items,task.items);assert.equal(next.stage,task.stage);assert.equal(next.version,task.version+1);
 assert.throws(()=>applyDispatchAction(next,request(next,'confirm-parts'),warehouse,[]),e=>e.status===409);
 assert.throws(()=>applyDispatchAction(next,request(task,'confirm-parts'),warehouse,[]),e=>e.status===409);
});
test('only active same-shop warehouse can confirm; warehouse cannot repair or schedule',()=>{
 const task=withParts();
 for(const actor of [tech,{...warehouse,active:false},{...warehouse,shopId:'other'},{...warehouse,role:'manager'}]) assert.throws(()=>applyDispatchAction(task,request(task,'confirm-parts'),actor,[]),e=>e.status===403);
 for(const action of ['record-parts','submit-order','update','start-order','pick']) assert.throws(()=>applyDispatchAction(task,request(task,action),warehouse,[]),e=>e.status===403);
 const noParts={...task,partsRequirement:{mode:'none',items:[],photoIds:[]}};
 assert.throws(()=>applyDispatchAction(noParts,request(noParts,'confirm-parts'),warehouse,[]),e=>e.status===409);
});
test('changing an application resets confirmation and ignores forged audit fields',()=>{
 const task=withParts();const confirmed=applyDispatchAction(task,request(task,'confirm-parts'),warehouse,[]);
 const next=applyDispatchAction(confirmed,request(confirmed,'record-parts',{partsRequirement:{...confirmed.partsRequirement,items:[{name:'滤芯',quantity:1,unit:'个'}]}}),tech,[]);
 assert.equal(next.partsRequirement.confirmedAt,undefined);assert.equal(next.partsRequirement.confirmedBy,undefined);assert.equal(next.partsRequirement.recordedBy,tech.id);
 assert.ok(confirmed.partsRequirement.confirmedAt);
});
