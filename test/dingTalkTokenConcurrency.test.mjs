import test from 'node:test';
import assert from 'node:assert/strict';
test('concurrent token refresh uses one fetch; failed refresh can recover',async()=>{
 const originalFetch=globalThis.fetch,key=process.env.DINGTALK_APP_KEY,secret=process.env.DINGTALK_APP_SECRET;
 process.env.DINGTALK_APP_KEY='test';process.env.DINGTALK_APP_SECRET='test';
 let calls=0,release;globalThis.fetch=async(_url,options)=>{calls++;assert.ok(options.signal);await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>({access_token:'token',expires_in:7200})};};
 try {
  const {getDingTalkAccessToken}=await import('../server/integrations/dingtalk/accessToken.mjs?singleflight');
  const a=getDingTalkAccessToken(),b=getDingTalkAccessToken();assert.equal(calls,1);release();assert.deepEqual(await Promise.all([a,b]),['token','token']);await getDingTalkAccessToken();assert.equal(calls,1);
  const fresh=await import('../server/integrations/dingtalk/accessToken.mjs?recovery');
  globalThis.fetch=async()=>{throw new Error('offline');};await assert.rejects(()=>fresh.getDingTalkAccessToken(),/offline/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({access_token:'recovered'})});assert.equal(await fresh.getDingTalkAccessToken(),'recovered');
 } finally {globalThis.fetch=originalFetch;if(key===undefined)delete process.env.DINGTALK_APP_KEY;else process.env.DINGTALK_APP_KEY=key;if(secret===undefined)delete process.env.DINGTALK_APP_SECRET;else process.env.DINGTALK_APP_SECRET=secret;}
});
test('a stalled DingTalk token fetch aborts at the ten-second deadline without replay',{timeout:15000},async()=>{
 const original=globalThis.fetch,key=process.env.DINGTALK_APP_KEY,secret=process.env.DINGTALK_APP_SECRET;
 process.env.DINGTALK_APP_KEY='test';process.env.DINGTALK_APP_SECRET='test';let calls=0;
 globalThis.fetch=async(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 const keep=setTimeout(()=>{},12000);
 try {const {getDingTalkAccessToken}=await import('../server/integrations/dingtalk/accessToken.mjs?deadline');const start=Date.now();const result=await Promise.allSettled([getDingTalkAccessToken(),getDingTalkAccessToken()]);assert.equal(calls,1);assert.ok(Date.now()-start>=9500);for(const item of result){assert.equal(item.status,'rejected');assert.equal(item.reason.name,'TimeoutError');}}
 finally {clearTimeout(keep);globalThis.fetch=original;if(key===undefined)delete process.env.DINGTALK_APP_KEY;else process.env.DINGTALK_APP_KEY=key;if(secret===undefined)delete process.env.DINGTALK_APP_SECRET;else process.env.DINGTALK_APP_SECRET=secret;}
});
