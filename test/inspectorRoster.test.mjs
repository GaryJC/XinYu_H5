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
