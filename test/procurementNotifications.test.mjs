import test from 'node:test';
import assert from 'node:assert/strict';
import { procurementMessageBody } from '../server/integrations/dingtalk/procurementNotifications.mjs';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {deliverProcurementNotification,resolveProcurementRecipients}=await import('../server/workers/procurementWorker.mjs');
test('notification contains an internal deep link only, with correct enterprise and report context',()=>{
  const msg=procurementMessageBody({payload:{title:'报告已发布',reportId:'report-1'}},'manager',{DISPATCH_APP_URL:'https://repair.example/?dispatchOrder=old#secret',DINGTALK_AGENT_ID:'123',DINGTALK_CORP_ID:'ding-id'});
  const url=new URL(msg.msg.markdown.text.match(/\]\(([^)]+)\)/)[1]);
  assert.equal(url.searchParams.get('procurementReport'),'report-1');assert.equal(url.searchParams.get('corpid'),'ding-id');assert.equal(url.hash,'');assert.equal(url.searchParams.has('dispatchOrder'),false);
  assert.doesNotMatch(JSON.stringify(msg),/token|supplier-portal/);
});
test('delivery revalidates store and equal roles, and never blindly resends an uncertain request',async()=>{
  for(const [role,shopId,allowed] of [['manager','s',true],['warehouse','s',true],['advisor','s',false],['manager','other',false]]){
    let sent=0,finished;const row={id:'n',recipient_id:'u',shop_id:'s',payload:{},previous_status:'pending'};
    await deliverProcurementNotification({claim:async()=>row,recipient:async()=>({active:true,role,shopId,dingtalk_user_id:'d'}),send:async()=>{sent++;return {status:'accepted',taskId:'1'};},finish:async(_,result)=>{finished=result;}});
    assert.equal(sent,allowed?1:0);assert.equal(finished.status,allowed?'accepted':'failed');
  }
  let sends=0,queries=0;
  await deliverProcurementNotification({claim:async()=>({previous_status:'unknown',task_id:'1'}),recipient:async()=>({}),send:async()=>{sends++;},query:async()=>{queries++;return {status:'sent'};},finish:async()=>{}});
  assert.equal(sends,0);assert.equal(queries,1);
});
test('recipient resolution requests both manager and warehouse role rosters',async()=>{
  let options,ids;
  await resolveProcurementRecipients({claim:async()=>({shop_id:'s'}),sync:async(_,o)=>{options=o;return ['a','b'];},resolve:async(_,resolved)=>{ids=resolved;},fail:async()=>assert.fail('unexpected failure'),env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'a',DINGTALK_APP_SECRET:'b',DISPATCH_APP_URL:'https://repair.example/'}});
  assert.deepEqual(options.roleKeys,['manager','warehouse']);assert.deepEqual(ids,['a','b']);
});

test('staff notification includes submitted quote summary without public supplier tokens',()=>{
  const msg=procurementMessageBody({payload:{title:'供应商A已提交报价：刹车片',summary:'含税含运费总价：¥200.00',tenderId:'tender-1'}},'warehouse',{DISPATCH_APP_URL:'https://repair.example/',DINGTALK_AGENT_ID:'123'});
  assert.match(msg.msg.markdown.text,/200.00/);assert.match(msg.msg.markdown.text,/procurementTender=tender-1/);
  assert.doesNotMatch(msg.msg.markdown.text,/supplier#|token_hash/);
});
