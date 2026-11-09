import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1/unused';
const {listDingTalkRoleMembers}=await import('../server/integrations/dingtalk/inspectorRoster.mjs');
const {getDingTalkUserProfile}=await import('../server/integrations/dingtalk/organization.mjs');
const {syncManagerRoster}=await import('../server/integrations/dingtalk/managerRoster.mjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=result=>({ok:true,json:async()=>({errcode:0,result})});

test('concurrent notification roles share catalog pages and common memberships; later reads are fresh',async()=>{
 const counts={catalog:0,members:0};
 const fetcher=async(url,input)=>{
  await flush();const {role_id,offset}=JSON.parse(input.body);
  if(url.pathname.endsWith('/list')){counts.catalog++;return response(offset===0?{list:[{roles:[{id:1,name:'门店管理员'}]}],hasMore:true}:{list:[{roles:[{id:2,name:'服务顾问'},{id:1,name:'门店管理员'}]}]});}
  counts.members++;return response({list:[{userid:`ding-${role_id}`}]});
 };
 const options={fetcher,token:async()=> 'token',coalesce:true};
 const [manager,scheduler]=await Promise.all([listDingTalkRoleMembers(['manager'],options),listDingTalkRoleMembers(['advisor','manager'],options)]);
 assert.deepEqual(manager.ids,['ding-1']);assert.deepEqual(scheduler.ids,['ding-1','ding-2']);
 assert.deepEqual(counts,{catalog:2,members:2},'two catalog pages plus two distinct roles, instead of seven calls');
 await listDingTalkRoleMembers(['manager'],options);assert.deepEqual(counts,{catalog:4,members:3});
});

test('fresh command membership lookup cannot join an older notification read',async()=>{
 let release,calls=0;
 const fetcher=async url=>{
  if(url.pathname.endsWith('/list')){
   calls++;if(calls===1){await new Promise(resolve=>{release=resolve;});return response({list:[{roles:[{id:1,name:'维修工'}]}]});}
   return response({list:[]});
  }
  return response({list:[{userid:'old-worker'}]});
 };
 const options={fetcher,token:async()=> 'token'};
 const old=listDingTalkRoleMembers(['technician'],{...options,coalesce:true});await flush();
 const fresh=await listDingTalkRoleMembers(['technician'],options);assert.deepEqual(fresh.ids,[]);assert.equal(calls,2);
 release();assert.deepEqual((await old).ids,['old-worker']);
});

test('profile coalescing isolates credentials, transports and employees; login bypasses it',async()=>{
 const pending=[];let calls=0;
 const fetcher=async(url,input)=>{calls++;return new Promise(resolve=>pending.push(()=>resolve(response({userid:JSON.parse(input.body).userid,name:'员工',role_list:[{id:1,name:'门店管理员'}]}))));};
 const read=(overrides={})=>getDingTalkUserProfile({userId:'a',accessToken:'one',fetcher,coalesce:true,...overrides});
 const a=read(),b=read(),token=read({accessToken:'two'}),user=read({userId:'b'}),transport=read({fetcher:(...args)=>fetcher(...args)}),login=getDingTalkUserProfile({userId:'a',accessToken:'one',fetcher});
 await flush();assert.equal(calls,5,'only a and b may share');for(const release of pending.splice(0))release();
 const results=await Promise.all([a,b,token,user,transport,login]);results[0].roles.length=0;assert.equal(results[1].roles.length,1,'callers do not share mutable normalized profiles');
 const later=read();await flush();assert.equal(calls,6);pending.shift()();await later;
});

test('failed shared reads are removed and the next lookup retries without stale fallback',async()=>{
 let calls=0,fail=true;
 const fetcher=async()=>{calls++;await flush();if(fail)throw Error('offline');return response({userid:'a',role_list:[]});};
 const read=()=>getDingTalkUserProfile({userId:'a',accessToken:'token',fetcher,coalesce:true});
 const results=await Promise.allSettled([read(),read()]);assert.equal(calls,1);assert.ok(results.every(r=>r.status==='rejected'));
 fail=false;assert.deepEqual((await read()).roles,[]);assert.equal(calls,2);
});
test('malformed role responses fail every waiter and are not retained',async()=>{
 let calls=0,fail=true;
 const fetcher=async()=>{calls++;await flush();return fail?{ok:true,json:async()=>{throw Error('invalid JSON');}}:response({list:[]});};
 const read=()=>listDingTalkRoleMembers(['manager'],{fetcher,token:async()=> 'token',coalesce:true});
 await Promise.all([assert.rejects(read(),/获取钉钉角色失败/),assert.rejects(read(),/获取钉钉角色失败/)]);assert.equal(calls,1);
 fail=false;assert.deepEqual((await read()).ids,[]);assert.equal(calls,2);
});

test('malformed or mismatched employee profiles reject every waiter and never become an empty active user',async()=>{
 for(const invalid of [null,{}, {errcode:0}, {errcode:0,result:[]}, {errcode:0,result:{}}, {errcode:0,result:{userid:'different'}}]) {
  let calls=0,fail=true;
  const fetcher=async()=>{calls++;await flush();return {ok:true,json:async()=>fail?invalid:{errcode:0,result:{userid:'a',name:'员工',role_list:[]}}};};
  const read=()=>getDingTalkUserProfile({userId:'a',accessToken:'token',fetcher,coalesce:true});
  await Promise.all([assert.rejects(read(),/员工详情失败/),assert.rejects(read(),/员工详情失败/)]);
  assert.equal(calls,1);fail=false;assert.equal((await read()).userId,'a');assert.equal(calls,2);
 }
 const fetcher=async()=>({ok:true,json:async()=>{throw Error('invalid JSON');}});
 await assert.rejects(getDingTalkUserProfile({userId:'a',accessToken:'token',fetcher}),/员工详情失败/);
});

test('concurrent manager notification discovery still validates local role, shop and active state separately',async()=>{
 let calls=0;const profiles=[];
 const options={token:async()=> 'token',fetcher:async url=>{calls++;await flush();return response(url.pathname.endsWith('/list')?{list:[{roles:[{id:1,name:'门店管理员'}]}]}:{list:['yes','disabled','other','revoked'].map(userid=>({userid}))});},
  profile:async input=>{profiles.push(input);return {userId:input.userId,active:true,roles:[{name:input.userId==='revoked'?'服务顾问':'门店管理员'}]};},find:async()=>undefined,snapshot:async()=>{},
  upsert:async({profile,mapping})=>({id:profile.userId,active:profile.userId!=='disabled',shopId:profile.userId==='other'?'elsewhere':mapping.shopId,roles:['manager']})};
 const result=await Promise.all([syncManagerRoster('s',options),syncManagerRoster('s',options)]);
 assert.deepEqual(result,[['yes'],['yes']]);assert.equal(calls,2);assert.ok(profiles.every(p=>p.coalesce===true));
});
