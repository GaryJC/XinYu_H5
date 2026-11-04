import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as util from 'node:util';
import * as domain from '../server/domain/procurement.mjs';
import * as winners from '../shared/procurementWinners.mjs';
import {HttpError} from '../server/http/HttpError.mjs';
import {localProxyClientAddress} from '../server/http/localProxyClientAddress.mjs';

function compiled(relative) {
 return ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}
function setup() {
 const invitationId=crypto.randomUUID(),supplierId=crypto.randomUUID(),tenderId=crypto.randomUUID();
 const raw={id:tenderId,shop_id:'s',status:'open',terms_version:1,deadline:null,data:{partName:'滤芯',quantity:2}};
 const supplier={id:supplierId,active:true,name:'供应商甲',contact_name:'联系人甲',phone:'13800000000'};
 const link={invitation_id:invitationId,supplier_id:supplierId,shop_id:'s',tender_id:tenderId};
 const quotes=[],requests=[],attempts=new Map();
 const repo={
  accessAttempt:async key=>{const count=(attempts.get(key)||0)+1;attempts.set(key,count);return count;},
  findLink:async()=>({...link,id:crypto.randomUUID(),expires_at:'2030-01-01T00:00:00Z'}),saveSession:async()=>{},
  sessionLink:async()=>link,lockTender:async()=>raw,supplierById:async()=>supplier,
  quoteRequest:async(_db,_inv,requestId)=>quotes.find(row=>row.data.requestId===requestId),
  databaseClock:async()=>new Date(),
  submitQuote:async(_db,_inv,input)=>{requests.push(input);const row={data:structuredClone(input)};quotes.unshift(row);return {saved:row};},
  audit:async()=>{},notificationFanout:async()=>{},notifyQuoteCompletion:async()=>{},
  readTenders:async()=>[{id:tenderId,status:raw.status,termsVersion:raw.terms_version,data:raw.data,deadline:null,invitations:[{id:invitationId,quotes:quotes.map(row=>row.data)}]}]
 };
 const service={};
 vm.runInNewContext(compiled('../server/services/procurementService.mjs'),{exports:service,Date,Error,Math,JSON,Buffer,require(id){
  if(id==='node:util')return util;
  if(id==='node:crypto')return crypto;
  if(id.endsWith('procurementWinners.mjs'))return winners;
  if(id.endsWith('pool.mjs'))return {pool:{},transaction:work=>work({})};
  if(id.endsWith('HttpError.mjs'))return {HttpError};
  if(id.endsWith('procurementRepository.mjs'))return repo;
  if(id.endsWith('domain/procurement.mjs'))return domain;
  return {};
 }});
 const slots=[],hook={},sent=[];let cursor=0,loseQuoteResponse=false,failRefresh=false;
 const api={verify:async()=>({ok:true}),resume:async()=>service.portal('session'),me:async()=>{if(failRefresh){failRefresh=false;throw new Error('refresh unavailable');}return service.portal('session');},quote:async input=>{sent.push(input);const result=await service.quote('session',input);if(loseQuoteResponse){loseQuoteResponse=false;throw new Error('response lost');}return result;}};
 vm.runInNewContext(compiled('../client/src/features/procurement/useSupplierPortal.ts'),{exports:hook,Error,JSON,location:{hash:'',pathname:'/supplier'},history:{replaceState(){}},sessionStorage:{getItem:()=>'',setItem(){}},require(id){
  if(id==='react')return {useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(){}};
  if(id.endsWith('useActionFeedback'))return {useActionFeedback:()=>({success(){},error(){}})};
  if(id.endsWith('procurementApi'))return {supplierPortalApi:api};
  throw new Error(id);
 }});
 return {service,raw,quotes,sent,requests,invitationId,supplier,attempts,loseNextQuoteResponse(){loseQuoteResponse=true;},failNextRefresh(){failRefresh=true;},render(){cursor=0;return hook.useSupplierPortal();},input:()=>({invitationId,termsVersion:1,requestId:crypto.randomUUID(),declined:false,unitPriceFen:10000,freightFen:0,deliveryAt:'2026-11-05T01:00:00Z',meetsRequirements:true,note:''})};
}

test('a deliberate repeat after prior success creates a new quote after another device changes the response',async()=>{
 const s=setup();await s.render().verify('13800000000','供应商甲');
 const first=s.input();await s.render().submit(first);
 await s.service.quote('session',{invitationId:s.invitationId,termsVersion:1,requestId:crypto.randomUUID(),declined:true,note:'无货'});
 assert.equal(s.quotes[0].data.declined,true);
 await s.render().submit({...first,requestId:crypto.randomUUID()});
 assert.equal(s.quotes[0].data.declined,false,'a confirmed new quote must replace the later decline');
 assert.notEqual(s.sent[0].requestId,s.sent[1].requestId);
});

test('an exact committed quote replay succeeds after the purchaser changes quantity',async()=>{
 const s=setup(),input=s.input();
 await s.service.quote('session',input);
 s.raw.data={...s.raw.data,quantity:3};s.raw.terms_version=2;
 assert.equal((await s.service.quote('session',input)).ok,true);
 assert.equal(s.requests.length,1);assert.equal(s.quotes[0].data.totalFen,20000);
});

test('an ambiguous quote response retains its original request ID and does not duplicate the saved quotation',async()=>{
 const s=setup();await s.render().verify('13800000000','供应商甲');
 const input=s.input();s.loseNextQuoteResponse();await s.render().submit(input);
 assert.equal(s.requests.length,1);assert.equal(s.render().error,'response lost');
 await s.render().submit({...input,requestId:crypto.randomUUID()});
 assert.equal(s.requests.length,1);assert.equal(s.sent[0].requestId,s.sent[1].requestId);
});

test('a successful quote retires its request ID before a failed state refresh',async()=>{
 const s=setup();await s.render().verify('13800000000','供应商甲');
 const input=s.input();s.failNextRefresh();await s.render().submit(input);
 assert.equal(s.requests.length,1);assert.equal(s.render().error,'refresh unavailable');
 await s.service.quote('session',{invitationId:s.invitationId,termsVersion:1,requestId:crypto.randomUUID(),declined:true,note:'无货'});
 await s.render().submit({...input,requestId:crypto.randomUUID()});
 assert.equal(s.quotes[0].data.declined,false);assert.notEqual(s.sent[0].requestId,s.sent[1].requestId);
});

function supplierRouter(service) {
 const router={};
 vm.runInNewContext(compiled('../server/routes/procurementRouter.mjs'),{exports:router,URL,process:{env:{APP_ENV:'test'}},require(id){
  if(id.endsWith('procurementService.mjs'))return service;
  if(id.endsWith('HttpError.mjs'))return {HttpError};
  if(id.endsWith('localProxyClientAddress.mjs'))return {localProxyClientAddress};
  if(id.endsWith('response.mjs'))return {readJson:async req=>req.body,sendJson:(_res,status)=>assert.equal(status,200)};
  return {};
 }});
 return router;
}

test('supplier verification behind the documented localhost proxy does not share all client rate limits',async()=>{
 const s=setup(),router=supplierRouter(s.service);
 for(let n=1;n<=61;n++) {
  const req={method:'POST',headers:{host:'repair.example','content-type':'application/json',origin:'https://repair.example','x-forwarded-for':`203.0.113.${n}`},socket:{remoteAddress:'127.0.0.1'},body:{token:`unique-invitation-${n}`,phone:s.supplier.phone,identity:s.supplier.name}};
  await router.handleSupplierPortal(req,{setHeader(){}},new URL('https://repair.example/api/supplier-portal/verify'));
 }
});

test('only loopback proxy addresses may use a fully valid forwarded chain and its final address',()=>{
 const address=(remote,forwarded)=>localProxyClientAddress({socket:{remoteAddress:remote},headers:{'x-forwarded-for':forwarded}});
 for(const remote of ['127.0.0.1','::1','::ffff:127.0.0.1']) {
  assert.equal(address(remote,'198.51.100.99, 203.0.113.7'),'203.0.113.7','a forged first address cannot select the limiter key');
  assert.equal(address(remote,'2001:db8::7'),'2001:db8::7');
  for(const forwarded of [undefined,'','203.0.113.7,','203.0.113.7,garbage','203.0.113.7, 999.0.0.1','garbage,203.0.113.7',['203.0.113.7'],'203.0.113.7:1234'])assert.equal(address(remote,forwarded),remote);
 }
 assert.equal(address('198.51.100.4','203.0.113.7'),'198.51.100.4');
 assert.equal(address('::ffff:198.51.100.4','203.0.113.7'),'::ffff:198.51.100.4');
});

test('the same supplier client is still rate-limited across different links and forged prefix addresses',async()=>{
 const s=setup(),router=supplierRouter(s.service);
 const verify=n=>router.handleSupplierPortal({method:'POST',headers:{host:'repair.example','content-type':'application/json','x-forwarded-for':`198.51.100.${n}, 203.0.113.7`},socket:{remoteAddress:'::ffff:127.0.0.1'},body:{token:`unique-invitation-${n}`,phone:s.supplier.phone,identity:s.supplier.name}},{setHeader(){}},new URL('https://repair.example/api/supplier-portal/verify'));
 for(let n=1;n<=60;n++)await verify(n);
 await assert.rejects(()=>verify(61),error=>error.status===429);
});
