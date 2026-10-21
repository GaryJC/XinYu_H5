import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../client/src/features/vehicle-license-ocr/useVehicleLicenseOcr.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(vehicle,result,answers=[]) {
  let draft={vehicle,customer:{},inspection:{}};
  const dialogs=[],lookups=[],records=[];const exports={};
  vm.runInNewContext(compiled,{exports,require(name){
    if(name==='react')return {useRef:current=>({current}),useEffect(){},useState:initial=>[initial,()=>{}]};
    if(name==='antd')return {Modal:{confirm(options){dialogs.push(options);answers.shift()?options.onOk():options.onCancel();}}};
    if(name.endsWith('prepareOcrImage'))return {prepareOcrImage:async()=>({})};
    if(name.endsWith('ocrUtils'))return {normalizeOcrDate:()=>'',formatVehicleLicenseSummary:()=>''};
    if(name.endsWith('workOrderApi'))return {workOrderApi:{uploadFile:async()=>({id:'license'}),recognizeVehicleLicense:async()=>result,createOcrRecord:async(...args)=>{records.push(JSON.parse(args[3]));return {id:'record'};}}};
    throw Error(name);
  }});
  const hook=exports.useVehicleLicenseOcr({actor:'顾问',draft,setDraft:update=>{draft=update(draft);},onRecognized:async value=>lookups.push(value)});
  return {hook,dialogs,lookups,records,get draft(){return draft;}};
}
test('conflicting plate and VIN retain existing identifiers unless explicitly accepted, including history lookup',async()=>{
  const h=setup({plate:'沪A12345',vin:'VIN-CORRECT'},{plate:'沪A12346',vin:'VIN-BLURRY',owner:'车主'},[false,false]);
  await h.hook.scanVehicleLicense({});
  assert.equal(h.dialogs.length,2);assert.match(h.dialogs[0].content,/沪A12345/);assert.match(h.dialogs[0].content,/沪A12346/);
  assert.equal(h.draft.vehicle.plate,'沪A12345');assert.equal(h.draft.vehicle.vin,'VIN-CORRECT');
  assert.equal(h.lookups[0].plate,'沪A12345');assert.equal(h.records[0].vin,'VIN-CORRECT');
});
test('employee can accept a corrected plate while retaining the existing VIN',async()=>{
  const h=setup({plate:'旧车牌',vin:'正确VIN'},{plate:'新车牌',vin:'错误VIN'},[true,false]);
  await h.hook.scanVehicleLicense({});assert.equal(h.draft.vehicle.plate,'新车牌');assert.equal(h.draft.vehicle.vin,'正确VIN');
});
test('empty identifiers fill automatically and equivalent casing does not trigger conflict',async()=>{
  const h=setup({plate:'',vin:' abc '},{plate:'沪A12345',vin:'ABC'});
  await h.hook.scanVehicleLicense({});assert.equal(h.dialogs.length,0);assert.equal(h.draft.vehicle.plate,'沪A12345');
});
test('reset while scanning discards the old OCR result',async()=>{
  const h=setup({plate:'正确',vin:''},{plate:'错误'});
  // A reset before scan completion invalidates the asynchronous generation.
  const pending=h.hook.scanVehicleLicense({});h.hook.resetOcr();await pending;
  assert.equal(h.dialogs.length,0);assert.equal(h.draft.vehicle.plate,'正确');assert.equal(h.lookups.length,0);
});
