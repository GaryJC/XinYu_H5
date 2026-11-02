import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTechnicianMembership} from '../server/integrations/dingtalk/technicianRoster.mjs';
import {hasRole} from '../shared/roles.mjs';
const env={APP_ENV:'production'};
const worker={id:'local',dingtalkUserId:'ding',role:'technician',roles:['technician'],active:true};
test('removed technician loses assignment eligibility without changing stored history',async()=>{
 const [result]=await verifyTechnicianMembership([worker],{env,list:async()=>({ids:[]})});
 assert.equal(hasRole(result,'technician'),false);assert.equal(hasRole(worker,'technician'),true);assert.equal(result.id,worker.id);
});
test('live membership preserves technicians and retains other roles for removed members',async()=>{
 const people=[worker,{...worker,id:'other',dingtalkUserId:'removed',role:'manager',roles:['manager','technician']}];
 const result=await verifyTechnicianMembership(people,{env,list:async keys=>{assert.deepEqual(keys,['technician']);return {ids:['ding']};}});
 assert.equal(hasRole(result[0],'technician'),true);assert.equal(hasRole(result[1],'technician'),false);assert.equal(hasRole(result[1],'manager'),true);
});
test('roster failures do not fall back to stale membership in production',async()=>{
 await assert.rejects(verifyTechnicianMembership([worker],{env,list:async()=>{throw Error('roster unavailable');}}),/roster unavailable/);
});
test('a second check observes removal after a candidate list was opened',async()=>{
 let ids=['ding'];const options={env,list:async()=>({ids})};
 assert.equal(hasRole((await verifyTechnicianMembership([worker],options))[0],'technician'),true);
 ids=[];assert.equal(hasRole((await verifyTechnicianMembership([worker],options))[0],'technician'),false);
});
test('explicit local mock mode never requests a real DingTalk token even with configured keys',async()=>{
 for(const APP_ENV of ['development','test']){
  const options={env:{APP_ENV,DISPATCH_NOTIFICATION_MODE:'mock',DINGTALK_APP_KEY:'placeholder',DINGTALK_APP_SECRET:'placeholder'},list:async()=>{throw Error('unexpected real request');}};
  assert.deepEqual(await verifyTechnicianMembership([worker],options),[worker]);
 }
});
test('production cannot bypass live verification through mock notification mode',async()=>{
 await assert.rejects(verifyTechnicianMembership([worker],{env:{APP_ENV:'production',DISPATCH_NOTIFICATION_MODE:'mock'},list:async()=>{throw Error('invalid credentials');}}),/invalid credentials/);
});
test('development using real DingTalk continues verifying memberships',async()=>{
 const [result]=await verifyTechnicianMembership([worker],{env:{APP_ENV:'development',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_APP_KEY:'configured'},list:async()=>({ids:[]})});
 assert.equal(hasRole(result,'technician'),false);
});
