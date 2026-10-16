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
