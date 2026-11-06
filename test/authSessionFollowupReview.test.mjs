import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import * as rolePolicy from '../shared/roles.mjs';
import * as repairCompletion from '../shared/repairCompletion.mjs';
import * as pendingRepairLimits from '../shared/pendingRepairLimits.mjs';

const tokenKey='repair-h5-auth-token';
function load(path,dependencies={},globals={}) {
  const source=process.env.AUTH_REVIEW_BASELINE==='true'
    ? execFileSync('git',['show',`HEAD:${path}`],{encoding:'utf8'})
    : readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(output,{exports,Error,URL,URLSearchParams,Event,CustomEvent,console,performance,Date,Promise,...globals,
    require(name){assert.ok(name in dependencies,`Unexpected import ${name}`);return dependencies[name];}});
  return exports;
}
function deferred() {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function browser(initial='token-a') {
  const values=new Map(initial?[[tokenKey,initial]]:[]);
  const window=new EventTarget();
  window.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const storage=(key=tokenKey)=>{const event=new Event('storage');Object.assign(event,{key,storageArea:window.localStorage});window.dispatchEvent(event);};
  return {window,storage,setToken:token=>token?values.set(tokenKey,token):values.delete(tokenKey)};
}
function transport(initial='token-a') {
  const b=browser(initial),calls=[],pending=[];
  const api=load('client/src/shared/api/httpClient.ts',{}, {window:b.window,fetch:(path,options)=>{
    calls.push({path,options});const wait=deferred();pending.push(wait);return wait.promise;
  }});
  return {...b,api,calls,pending};
}
function json(value,status=200) {return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}

test('cross-tab identity change blocks an old form before fetch, even before the storage event',async()=>{
  const h=transport();h.setToken('token-b');
  await assert.rejects(h.api.request('/api/work-orders',{method:'POST',body:{customer:'old-user-draft'}}),/登录身份已变更/);
  assert.equal(h.calls.length,0);
  await assert.rejects(h.api.request('/api/work-orders',{method:'POST'}),/登录身份已变更/);
  assert.equal(h.calls.length,0);
  const restore=h.api.request('/api/auth/me',{restoreSession:true});
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer token-b');
  h.pending[0].resolve(json({id:'user-b'}));await restore;h.api.confirmAuthSession();
  const next=h.api.request('/api/work-orders');h.pending[1].resolve(json([]));await next;
  assert.equal(h.calls[1].options.headers.Authorization,'Bearer token-b');
});

test('a storage event clears image cache and blocks business requests until identity restoration',async()=>{
  const h=transport();const first=h.api.requestCachedImage('/api/files/photo');h.pending[0].resolve(new Response('private-a'));await first;
  h.setToken('token-b');h.storage();
  await assert.rejects(h.api.requestCachedImage('/api/files/photo'),/登录身份已变更/);
  assert.equal(h.calls.length,1);
  h.api.confirmAuthSession();
  const next=h.api.requestCachedImage('/api/files/photo');h.pending[1].resolve(new Response('private-b'));
  assert.equal(await (await next).text(),'private-b');assert.equal(h.calls[1].options.headers.Authorization,'Bearer token-b');
});

for(const [method,path] of [['request','/api/work-orders'],['requestBlob','/api/export'],['requestCachedImage','/api/files/photo']]) {
  test(`${method} rejects a late response from the previous identity`,async()=>{
    const h=transport();const old=h.api[method](path);h.api.setAuthToken('token-b');
    h.pending[0].resolve(method==='request'?json({private:'a'}):new Response('private-a'));
    await assert.rejects(old,/登录身份已变更/);assert.equal(h.api.getAuthToken(),'token-b');
  });
  test(`${method} expires only the session whose current request returned 401`,async()=>{
    const h=transport();const events=[];h.window.addEventListener('repair-h5-auth-token-changed',e=>events.push(e.detail));
    const old=h.api[method](path);h.api.setAuthToken('token-b');h.pending[0].resolve(json({error:'expired a'},401));
    await assert.rejects(old);assert.equal(h.api.getAuthToken(),'token-b');assert.equal(h.window.localStorage.getItem(tokenKey),'token-b');
    const current=h.api[method](path);h.pending[1].resolve(json({error:'expired b'},401));await assert.rejects(current,e=>e.status===401);
    assert.equal(h.api.getAuthToken(),'');assert.equal(h.window.localStorage.getItem(tokenKey),null);assert.equal(events.at(-1),'expired');
  });
}

test('403 and public 401 do not log out an authenticated user; requests are never retried',async()=>{
  const h=transport();const forbidden=h.api.request('/api/dispatch');h.pending[0].resolve(json({error:'forbidden'},403));
  await assert.rejects(forbidden,e=>e.status===403);assert.equal(h.api.getAuthToken(),'token-a');
  const publicRequest=h.api.request('/api/public',{skipAuth:true});h.pending[1].resolve(json({error:'bad public token'},401));
  await assert.rejects(publicRequest,e=>e.status===401);assert.equal(h.api.getAuthToken(),'token-a');assert.equal(h.calls.length,2);
});

test('the same token causes no identity reset and no request cancellation',async()=>{
  const h=transport();let changes=0;h.window.addEventListener('repair-h5-auth-token-changed',()=>{changes++;});
  const pending=h.api.request('/api/work-orders');h.api.setAuthToken('token-a');h.storage();
  h.pending[0].resolve(json({ok:true}));assert.equal((await pending).ok,true);assert.equal(changes,0);
});

test('an old identity confirmation cannot unlock a newer token before its own me response',async()=>{
  const h=transport();const first=h.api.request('/api/auth/me',{restoreSession:true});h.pending[0].resolve(json({id:'user-a'}));await first;
  h.setToken('token-b');assert.equal(h.api.confirmAuthSession(),false);
  for(let i=0;i<2;i++)await assert.rejects(h.api.request('/api/work-orders',{method:'POST',body:{oldDraft:true}}),/登录身份已变更/);
  assert.equal(h.calls.length,1);
  const next=h.api.request('/api/auth/me',{restoreSession:true});h.pending[1].resolve(json({id:'user-b'}));await next;assert.equal(h.api.confirmAuthSession(),true);
  const post=h.api.request('/api/work-orders',{method:'POST'});h.pending[2].resolve(json({ok:true}));await post;
  assert.equal(h.calls[2].options.headers.Authorization,'Bearer token-b');
});

function hooks() {
  const slots=[];let cursor=0,dirty=true,pending=[],renderHook,value;
  const react={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const nextValue=typeof next==='function'?next(slots[i].value):next;if(!Object.is(nextValue,slots[i].value)){slots[i].value=nextValue;dirty=true;}}];},
    useRef(initial){const i=cursor++;return (slots[i]??={current:initial});},
    useMemo(fn){return fn();},
    useEffect(effect,deps){const i=cursor++,previous=slots[i];if(!previous||!deps||deps.some((d,j)=>!Object.is(d,previous.deps[j]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
  };
  function render(){cursor=0;dirty=false;value=renderHook();const effects=pending;pending=[];effects.forEach(effect=>effect());}
  return {react,start(fn){renderHook=fn;render();},async flush(){for(let i=0;i<12;i++){await Promise.resolve();if(dirty)render();}},get value(){if(dirty)render();return value;}};
}
function workbench() {
  const h=hooks(),b=browser(),resets={ocr:0,identity:0,prePhotos:0,paperPhotos:0},loginCalls=[];
  const globals={window:b.window,location:{href:'http://localhost/',search:''},navigator:{userAgent:'Chrome'}};
  const http=load('client/src/shared/api/httpClient.ts',{}, {...globals,fetch:()=>{throw new Error('Unexpected fetch');}});
  const domain=load('client/src/features/work-orders/domain/workOrderDomain.ts',{
    '../../dispatch/dispatchAvailability':{dispatchEnabled:false},'./repairItems':{filterEmptyRepairItems:items=>items.filter(i=>i.name.trim())},
    '../../../../../shared/repairCompletion.mjs':repairCompletion,'../../../../../shared/pendingRepairLimits.mjs':pendingRepairLimits
  });
  const draft=load('client/src/features/work-orders/hooks/useWorkOrderDraft.ts',{react:h.react,'../domain/workOrderDomain':domain});
  let restoredUser={id:'user-a',name:'顾问甲',role:'advisor',shopId:'shop-hq'};
  const api={me:async()=>restoredUser,dashboard:async()=>({total:0,statusCounts:{}}),users:async()=>[],departments:async()=>[],
    async loginForDevelopment(persona){const wait=deferred();loginCalls.push({persona,...wait});const user=await wait.promise;http.setAuthToken(`token-${user.id}`);return {user};}};
  const dependencies={
    react:h.react,'../dispatch/dispatchApi':{dispatchApi:{}},'./archiveFilters':{defaultArchiveFilters:()=>({search:'',sort:'newest'})},
    '../../shared/ui/useActionFeedback':{useActionFeedback:()=>({warning(){},success(){},error(){}})},
    '../vehicle-license-history/useVehicleLicenseHistory':{useVehicleLicenseHistory:()=>({busy:false})},
    '../../../../shared/workOrderEditPolicy.mjs':{isUnsignedOrderEditable:()=>true},
    './useArchiveFilters':{useArchiveFilters:()=>{const [items,setItems]=h.react.useState([]);return {items,setItems,filteredOrders:items,filters:{search:''},refresh:async()=>{},setFilters(){}};}},
    '../../../../shared/roles.mjs':rolePolicy,
    '../work-orders/hooks/usePaperOrderPhotos':{usePaperOrderPhotos:()=>({reset(){resets.paperPhotos++;},isUploading:()=>false})},
    '../work-orders/domain/vehicleLicenseException':{},'../../shared/api/requestId':{createRequestId:()=> 'request-id'},
    '../pre-repair-photos/usePreRepairPhotos':{usePreRepairPhotos:()=>({reset(){resets.prePhotos++;},isUploading:()=>false})},
    '../pre-repair-photos/photoSlots':{},'../work-orders/domain/workOrderDomain':domain,'../work-orders/domain/repairItems':{},
    '../work-orders/domain/permissions':{canCreateOrder:()=>true},'../../integrations/dingtalk/auth':{},
    '../../shared/api/httpClient':http,'../work-orders/api/workOrderApi':{workOrderApi:api},'../work-orders/hooks/useWorkOrderDraft':draft,
    '../work-orders/hooks/createWorkOrderWorkflowActions':{createWorkOrderWorkflowActions:()=>({})},
    '../vehicle-license-ocr/useVehicleLicenseOcr':{useVehicleLicenseOcr:()=>({ocrState:{vehicleLicense:{status:'未识别'}},resetOcr(){resets.ocr++;}})},
    '../vehicle-identity/useVehicleIdentityRecognition':{useVehicleIdentityRecognition:()=>({lookupDraftVehicle(){},resetVehicleIdentityRecognition(){resets.identity++;}})},
    './workbenchConfig':{navItems:[{label:'委托开单',roles:['advisor','manager']}],primaryNavByRole:{advisor:'委托开单',manager:'委托开单'}},
    '../dispatch/dispatchAvailability':{dispatchEnabled:false,isDispatchNavigation:()=>false}
  };
  // The baseline has no subscription API; all other dependencies still execute its real controller.
  const {useWorkbenchController}=load('client/src/features/workbench/useWorkbenchController.ts',dependencies,globals);
  h.start(useWorkbenchController);
  return {...b,h,http,resets,loginCalls,domain,setRestoredUser:user=>{restoredUser=user;}};
}

test('switching test identity clears selected customer, vehicle, photos and recognition state',async()=>{
  const h=workbench();await h.h.flush();
  const order={...h.domain.createEmptyDraft('顾问甲'),id:'order-a',customer:{name:'客户甲'},vehicle:{plate:'鲁A10001',vin:'A'.repeat(17)},inspection:{vehicleLicenseFileId:'photo-a'}};
  h.h.value.selectOrder(order);await h.h.flush();assert.equal(h.h.value.selectedOrder.id,'order-a');
  const resetBefore=h.resets.ocr;
  const login=h.h.value.loginForDevelopment('manager');h.loginCalls[0].resolve({id:'user-b',name:'管理员乙',role:'manager'});await login;await h.h.flush();
  assert.equal(h.h.value.currentUser.id,'user-b');assert.equal(h.h.value.selectedOrder,undefined);
  assert.equal(h.h.value.draft.customer.name,'');assert.equal(h.h.value.draft.vehicle.plate,'');assert.equal(h.h.value.draft.inspection.vehicleLicenseFileId,undefined);
  assert.equal(h.h.value.draft.advisor,'管理员乙');assert.ok(h.resets.ocr>resetBefore);assert.ok(h.resets.identity>0);
});

test('concurrent test login attempts cannot change identity out of response order',async()=>{
  const h=workbench();await h.h.flush();const first=h.h.value.loginForDevelopment('manager');const second=h.h.value.loginForDevelopment('advisor');
  assert.equal(h.loginCalls.length,1);h.loginCalls[0].resolve({id:'user-b',name:'管理员乙',role:'manager'});await Promise.all([first,second]);await h.h.flush();
  assert.equal(h.h.value.currentUser.id,'user-b');
});

test('cross-tab storage restores the matching identity and clears its predecessor draft',async()=>{
  const h=workbench();await h.h.flush();h.h.value.updateCustomer('name','客户甲');await h.h.flush();
  h.setRestoredUser({id:'user-b',name:'管理员乙',role:'manager'});h.setToken('token-b');h.storage();await h.h.flush();
  assert.equal(h.h.value.currentUser.id,'user-b');assert.equal(h.h.value.draft.customer.name,'');assert.equal(h.h.value.draft.advisor,'管理员乙');
});

test('a new token for the same verified identity preserves an unfinished editor and selected order',async()=>{
  const h=workbench();await h.h.flush();
  const order={...h.domain.createEmptyDraft('顾问甲'),id:'order-a',customer:{name:'客户甲'},vehicle:{plate:'鲁A10001',vin:'A'.repeat(17)},inspection:{vehicleLicenseFileId:'photo-a'}};
  h.h.value.selectOrder(order);h.h.value.setActiveNav('委托开单');await h.h.flush();
  const ocrResets=h.resets.ocr,identityResets=h.resets.identity;
  const wait=deferred();h.setRestoredUser(wait.promise);h.setToken('renewed-token-a');h.storage();await h.h.flush();
  assert.equal(h.h.value.currentUser,undefined);
  await assert.rejects(h.http.request('/api/work-orders',{method:'POST'}),/登录身份已变更/);
  wait.resolve({id:'user-a',name:'顾问甲',role:'advisor',shopId:'shop-hq',lastLoginAt:'new login'});await h.h.flush();
  assert.equal(h.h.value.currentUser.id,'user-a');assert.equal(h.h.value.selectedOrder.id,'order-a');
  assert.equal(h.h.value.draft.customer.name,'客户甲');assert.equal(h.h.value.draft.vehicle.plate,'鲁A10001');
  assert.equal(h.h.value.draft.inspection.vehicleLicenseFileId,'photo-a');assert.equal(h.h.value.activeNav,'委托开单');
  assert.equal(h.resets.ocr,ocrResets);assert.equal(h.resets.identity,identityResets);
});

test('renewal with changed permissions clears the previous editing context',async()=>{
  const h=workbench();await h.h.flush();h.h.value.updateCustomer('name','客户甲');await h.h.flush();
  h.setRestoredUser({id:'user-a',name:'顾问甲',role:'advisor',shopId:'shop-hq',roles:['advisor','inspector']});
  h.setToken('changed-role-token');h.storage();await h.h.flush();
  assert.equal(h.h.value.currentUser.id,'user-a');assert.equal(h.h.value.draft.customer.name,'');
});

test('failed identity restoration discards the previous editor and stays logged out',async()=>{
  const h=workbench();await h.h.flush();h.h.value.updateCustomer('name','客户甲');await h.h.flush();
  const wait=deferred();h.setRestoredUser(wait.promise.then(()=>{throw new Error('session lookup unavailable');}));h.setToken('token-b');h.storage();
  wait.resolve();await h.h.flush();assert.equal(h.h.value.currentUser,undefined);assert.equal(h.h.value.draft.customer.name,'');
  assert.match(h.h.value.apiError,/session lookup unavailable/);
});

test('expiration clears the authenticated workbench and all draft data',async()=>{
  const h=workbench();await h.h.flush();h.h.value.updateCustomer('name','客户甲');await h.h.flush();
  h.window.dispatchEvent(new CustomEvent('repair-h5-auth-token-changed',{detail:'expired'}));await h.h.flush();
  assert.equal(h.h.value.currentUser,undefined);assert.equal(h.h.value.draft.customer.name,'');assert.match(h.h.value.apiError,/登录已失效/);
});
