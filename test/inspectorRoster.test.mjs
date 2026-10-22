import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1/unused';
const {listInspectorRoleMembers,syncInspectorRoster}=await import('../server/integrations/dingtalk/inspectorRoster.mjs');
const {validateRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
test('role and member pagination deduplicates members and requires complete responses',async()=>{
 const calls=[];
 const fetcher=async(url,input)=>{const body=JSON.parse(input.body);calls.push(body);let result;
 if(url.pathname.endsWith('/list')) result=body.offset===0?{list:[{roles:[{id:7,name:'检验员'}]}],hasMore:true}:{list:[{roles:[{id:8,name:'检验员'}]}],hasMore:false};
 else result=body.offset===0?{list:[{userid:'a'}],hasMore:true}:{list:[{userid:'b'}],hasMore:false};
 return {ok:true,json:async()=>({errcode:0,result})};};
 assert.deepEqual((await listInspectorRoleMembers({fetcher,token:async()=>''})).ids,['a','b']);assert.equal(calls.length,6);
 await assert.rejects(()=>listInspectorRoleMembers({token:async()=>'',fetcher:async()=>({ok:true,json:async()=>({errcode:0,result:{list:[],hasMore:true}})})}));
});
test('roster preserves existing store and disabled status; removed members do not receive notifications',async()=>{
 const saved=[],queries=[];
 const deps={list:async()=>({ids:['new','disabled','elsewhere'],accessToken:''}),profile:async({userId})=>({userId,name:userId,active:true,departmentIds:[],roles:[{id:'7',name:'检验员'}]}),find:async id=>id==='new'?undefined:{id,shopId:id==='elsewhere'?'other':'shop-hq',active:id!=='disabled'},snapshot:async()=>{},upsert:async({profile,mapping,existingUser})=>{saved.push(mapping);return {id:profile.userId,active:profile.active&&existingUser?.active!==false,role:mapping.role,shopId:mapping.shopId};},database:{query:async(...args)=>queries.push(args)}};
 assert.deepEqual(await syncInspectorRoster('shop-hq',deps),['new']);assert.equal(saved[2].shopId,'other');assert.deepEqual(queries[0][1],['shop-hq',['new']]);
 let updates=0;
 await assert.rejects(()=>syncInspectorRoster('shop-hq',{...deps,profile:async()=>{throw new Error('network');},database:{query:async()=>updates++}}));assert.equal(updates,0);
});
test('repair photos reject MIME spoofing, missing request identity and excessive bytes',()=>{
 assert.throws(()=>validateRepairPhoto({requestId:'short',mimeType:'image/png',imageBase64:'abc'}));
 assert.throws(()=>validateRepairPhoto({requestId:'valid-request',mimeType:'image/jpeg',imageBase64:Buffer.from('<script>').toString('base64')}));
 assert.throws(()=>validateRepairPhoto({requestId:'valid-request',mimeType:'image/png',imageBase64:'A'.repeat(13*1024*1024)}));
});

test('scheduler roster selects only service advisors and managers and preserves store and disabled status',async()=>{
 const {listDingTalkRoleMembers}=await import('../server/integrations/dingtalk/inspectorRoster.mjs');
 const result=await listDingTalkRoleMembers(['advisor','manager'],{token:async()=>'',fetcher:async(url,request)=>({ok:true,json:async()=>({errcode:0,result:url.pathname.endsWith('/list')?{list:[{roles:[{id:1,name:'派单员'},{id:2,name:'调度员'},{id:3,name:'服务顾问'},{id:4,name:'门店管理员'},{id:5,name:'检验员'}]}],hasMore:false}:{list:[{userid:String(JSON.parse(request.body).role_id)}],hasMore:false}})})});
 assert.deepEqual(result.ids,['3','4']);
 const {syncSchedulerRoster}=await import('../server/integrations/dingtalk/schedulerRoster.mjs');
 const profiles=['服务顾问','门店管理员','服务顾问','服务顾问'].map((name,index)=>({userId:String(index),active:true,roles:[{id:String(index),name}]}));
 const audience=await syncSchedulerRoster('s',{list:async()=>({ids:['0','1','2','3'],accessToken:''}),profile:async({userId})=>profiles[Number(userId)],find:async id=>id==='0'?undefined:{id,active:id!=='2',shopId:id==='3'?'other':'s'},snapshot:async()=>{},upsert:async({profile,mapping,existingUser})=>({id:profile.userId,role:mapping.role,shopId:mapping.shopId,active:profile.active&&existingUser?.active!==false})});
 assert.deepEqual(audience,['0','1']);
});

test('inspection role discovery includes managers and deduplicates dual memberships',async()=>{
 const result=await listInspectorRoleMembers({token:async()=>'',fetcher:async(url,input)=>{
  const {role_id}=JSON.parse(input.body);
  return {ok:true,json:async()=>({errcode:0,result:url.pathname.endsWith('/list')
   ?{list:[{roles:[{id:1,name:'检验员'},{id:2,name:'门店管理员'},{id:3,name:'服务顾问'}]}]}
   :{list:(role_id===1?['inspector','dual']:['manager','dual']).map(userid=>({userid}))}})};
 }});
 assert.deepEqual(result.ids,['inspector','dual','manager']);
});

test('inspection audience includes active local managers without granting inspector membership',async()=>{
 const queries=[];
 const profiles=[
  {userId:'manager',roles:[{name:'门店管理员'}]},
  {userId:'dual',roles:[{name:'门店管理员'},{name:'检验员'}]},
  {userId:'disabled',roles:[{name:'门店管理员'}]},
  {userId:'other',roles:[{name:'门店管理员'}]},
  {userId:'revoked',roles:[{name:'服务顾问'}]}
 ].map(p=>({...p,active:true}));
 const ids=await syncInspectorRoster('s',{
  list:async()=>({ids:profiles.map(p=>p.userId),accessToken:''}),
  profile:async({userId})=>profiles.find(p=>p.userId===userId),
  find:async id=>({id,shopId:id==='other'?'elsewhere':'s',active:id!=='disabled'}),snapshot:async()=>{},
  upsert:async({profile,mapping,existingUser})=>({id:profile.userId,...mapping,active:existingUser.active}),
  database:{query:async(...args)=>queries.push(args)}
 });
 assert.deepEqual(ids,['manager','dual']);
 assert.deepEqual(queries[0][1],['s',['dual']]);
});
