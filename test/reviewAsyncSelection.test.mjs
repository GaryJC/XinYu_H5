import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {hasAnyRole,hasRole} from '../shared/roles.mjs';

function hook(file,name,api,props=[]) {
 const compiled=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const slots=[];let cursor=0;
 const exports={};
 const react={
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useRef(initial){const index=cursor++;return slots[index]??=( {current:initial} );},
  useCallback(fn){return fn;},useEffect(){}
 };
 vm.runInNewContext(compiled,{exports,Error,URL,URLSearchParams,location:{href:'https://example.com/',search:''},history:{replaceState(){}},require(id){
  if(id==='react')return react;
  if(id.endsWith('roles.mjs'))return {hasAnyRole,hasRole};
  if(id.endsWith('requestId'))return {createRequestId:()=> 'review-request'};
  if(id.endsWith('dispatchApi'))return {dispatchApi:api};
  if(id.endsWith('procurementApi'))return {procurementApi:api};
  if(id.endsWith('workOrderApi'))return {workOrderApi:api};
  if(id.endsWith('prepareOcrImage'))return {prepareOcrImage:async()=>({imageBase64:'image'})};
  throw new Error(id);
 }});
 return ()=>{cursor=0;return exports[name](...props);};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const user={id:'m',role:'manager',shopId:'s',active:true};

test('late dispatch mutation response cannot replace newly selected task',async()=>{
 const gate=deferred(),calls=[];
 const api={detail:async id=>{calls.push(id);return {task:{orderId:id,version:1}};},action:()=>gate.promise,tasks:async()=>[],people:async()=>({}),summaries:async()=>[]};
 const render=hook('../client/src/features/dispatch/useDispatchController.ts','useDispatchController',api,[user,'派工台','A']);
 await render().refreshDetail();
 const saving=render().act({action:'update-due',dueAt:'2026-11-01T00:00:00Z'});
 render().select('B');await render().refreshDetail();
 gate.resolve();await saving;
 assert.equal(render().selectedId,'B');assert.equal(render().detail.task.orderId,'B');
});

test('closing a task while its request is pending leaves no stale detail',async()=>{
 const gate=deferred();
 const api={detail:()=>gate.promise};
 const render=hook('../client/src/features/dispatch/useDispatchController.ts','useDispatchController',api,[user,'派工台','A']);
 const loading=render().refreshDetail();render().select();
 gate.resolve({task:{orderId:'A',version:1}});await loading;
 assert.equal(render().selectedId,undefined);assert.equal(render().detail,undefined);
});

test('late procurement action cannot overwrite the newly opened tender or its links',async()=>{
 const gate=deferred();
 const api={detail:async id=>({id}),action:()=>gate.promise,suppliers:async()=>[],tenders:async()=>[],reports:async()=>[]};
 const render=hook('../client/src/features/procurement/useProcurement.ts','useProcurement',api);
 await render().openTender('A');const saving=render().action({action:'reissue-link'});
 await render().openTender('B');gate.resolve({id:'A',link:{token:'old'}});await saving;
 assert.equal(render().selectedId,'B');assert.equal(render().detail.id,'B');assert.equal(render().links.length,0);
});

test('closing a loaded dispatch detail clears it immediately and prevents stale actions',async()=>{
 let actions=0;
 const render=hook('../client/src/features/dispatch/useDispatchController.ts','useDispatchController',{detail:async id=>({task:{orderId:id,version:1}}),action:async()=>{actions++;}},[user,'派工台','A']);
 await render().refreshDetail();const old=render();old.select();
 assert.equal(render().detail,undefined);
 assert.equal(await old.act({action:'send-review'}),false);assert.equal(actions,0);
});

test('two reads of the same tender keep the most recent response',async()=>{
 const slow=deferred();let count=0;
 const render=hook('../client/src/features/procurement/useProcurement.ts','useProcurement',{detail:async()=>++count===1?slow.promise:{id:'A',version:2}});
 const old=render().openTender('A');await render().openTender('A');
 slow.resolve({id:'A',version:1});await old;
 assert.equal(render().detail.version,2);
});

test('vehicle lookup for an old draft must not populate a newly opened draft',async()=>{
 const gate=deferred();let draft={vehicle:{plate:''},customer:{}};
 const render=hook('../client/src/features/vehicle-identity/useVehicleIdentityRecognition.ts','useVehicleIdentityRecognition',{lookupVehicle:()=>gate.promise},[{setDraft:update=>{draft=update(draft);}}]);
 const loading=render().lookupVehicleIdentifier('plate','OLD');render().resetVehicleIdentityRecognition();draft={vehicle:{plate:'NEW'},customer:{}};
 gate.resolve({found:true,status:'found',vehicle:{plate:'OLD',vin:'old-vin',organization:{name:'旧客户',code:'old'}}});await loading;
 assert.equal(draft.vehicle.plate,'NEW');assert.equal(draft.customer.name,undefined);assert.equal(render().vehicleHistory,undefined);
});

test('new vehicle lookup wins when an older request finishes later',async()=>{
 const gate=deferred();let draft={vehicle:{plate:''},customer:{}};
 const api={lookupVehicle:async({plate})=>plate==='OLD'?gate.promise:{found:true,status:'found',vehicle:{plate:'NEW'}}};
 const render=hook('../client/src/features/vehicle-identity/useVehicleIdentityRecognition.ts','useVehicleIdentityRecognition',api,[{setDraft:update=>{draft=update(draft);}}]);
 const old=render().lookupVehicleIdentifier('plate','OLD');await render().lookupVehicleIdentifier('plate','NEW');
 gate.resolve({found:true,status:'found',vehicle:{plate:'OLD'}});await old;
 assert.equal(draft.vehicle.plate,'NEW');assert.equal(render().vehicleHistory.vehicle.plate,'NEW');
});

test('late plate OCR cannot start a lookup or modify a reset draft',async()=>{
 const gate=deferred();let draft={vehicle:{plate:''},customer:{}},queries=0;
 const api={recognizeLicensePlate:()=>gate.promise,lookupVehicle:async()=>{queries++;return {found:false};}};
 const render=hook('../client/src/features/vehicle-identity/useVehicleIdentityRecognition.ts','useVehicleIdentityRecognition',api,[{setDraft:update=>{draft=update(draft);}}]);
 const scan=render().scanVehicleIdentifier('plate',{});await Promise.resolve();render().resetVehicleIdentityRecognition();draft={vehicle:{plate:'NEW'},customer:{}};
 gate.resolve({value:'OLD'});await scan;
 assert.equal(draft.vehicle.plate,'NEW');assert.equal(queries,0);assert.equal(render().identifierRecognition.plate.status,'未识别');
});

test('selecting the already opened task keeps its loaded detail',async()=>{
 const render=hook('../client/src/features/dispatch/useDispatchController.ts','useDispatchController',{detail:async id=>({task:{orderId:id,version:1}})},[user,'派工台','A']);
 await render().refreshDetail();render().select('A');assert.equal(render().detail.task.orderId,'A');
});
