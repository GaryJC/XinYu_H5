import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const { assertPaperPhotoIds, attachPaperPhotos, enqueuePaperNotifications } = await import('../server/repositories/paperOrderRepository.mjs');
const { enqueueLegacySyncEvent, buildLegacySyncPayload } = await import('../server/repositories/legacySyncOutboxRepository.mjs');
const { messageBody } = await import('../server/integrations/dingtalk/notifications.mjs');
const { readLegacyWorkOrder } = await import('../server/repositories/legacyWorkOrderRepository.mjs');
const { applyDispatchAction } = await import('../server/domain/dispatchPolicy.mjs');

test('paper creation requires distinct photograph IDs',()=>{
  for (const photoIds of [undefined,[],[''],[1],['same','same'],Array.from({length:51},(_,i)=>`${i}`)]) {
    assert.throws(()=>assertPaperPhotoIds({photoIds}),/纸质委托书照片/);
  }
  assert.deepEqual(assertPaperPhotoIds({photoIds:['one','two']}),['one','two']);
});
test('paper photographs must belong to the uploader or current order and be actual images',async()=>{
  const queries=[];
  await assert.rejects(()=>attachPaperPhotos({query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}},
    {id:'order',paperOrder:{photoIds:['someone-elses-file']}},'uploader'),/无权/);
  assert.match(queries[0].sql,/uploaded_by=\$3/);
  assert.match(queries[0].sql,/mime_type in/);
  assert.deepEqual(queries[0].params,[['someone-elses-file'],'order','uploader']);
});
test('pending paper orders never enqueue, imported paper orders never create again',async()=>{
  const client={query:()=>{throw new Error('must not enqueue');}};
  for (const mode of ['pending','runfeng']) await enqueueLegacySyncEvent(client,{paperOrder:{mode,photoIds:['photo']}},'created');
  const payload=buildLegacySyncPayload({order:{paperOrder:{mode:'dingtalk',photoIds:['photo']}}});
  assert.equal(payload.order.signatureExemption,'纸质委托书');
  assert.deepEqual(payload.order.paperOrder.photoIds,['photo']);
});
test('creation notifies every active advisor and manager across all shops, with per-recipient deduplication',async()=>{
  const inserts=[];
  await enqueuePaperNotifications({query:async(sql,params)=>{
    if(sql.startsWith('select')) {assert.match(sql,/active=true/);assert.doesNotMatch(sql,/shop_id/);assert.match(sql,/role in \('advisor','manager'\)/);return {rows:[{id:'advisor-a'},{id:'advisor-b'},{id:'manager'}]};}
    inserts.push({sql,params});return {rows:[]};
  }},{id:'paper',shop:{id:'shop-hq'},advisor:'顾问'});
  assert.equal(inserts.length,3);
  assert.deepEqual(inserts.map(row=>row.params[2]),['advisor-a','advisor-b','manager']);
  assert.ok(inserts.every(row=>/on conflict do nothing/.test(row.sql)));
});
test('paper notification opens the order detail instead of dispatch',()=>{
  const body=messageBody({kind:'纸质委托书已创建',payload:{orderId:'WT-TEST',paperOrder:true,summary:'测试'}},'user',
    {DISPATCH_APP_URL:'https://repair.example/app',DINGTALK_AGENT_ID:'123'});
  assert.match(body.msg.markdown.text,/paperOrder=WT-TEST/);
  assert.match(body.msg.markdown.text,/查看纸质委托书/);
  assert.doesNotMatch(body.msg.markdown.text,/dispatchOrder=|undefined/);
});
test('Runfeng paper import queries the exact dispatch number and rejects ambiguous or foreign H5 sources',async()=>{
  for (const headers of [[],[{pgd:'A123'},{pgd:'A123'}],[{pgd:'A123',bzxx:'H5:other'}]]) {
    await assert.rejects(()=>readLegacyWorkOrder({id:'paper',paperDispatchNo:'A123'},async run=>run(async(sql,configure)=>{
      const inputs={};configure({input:(key,type,value)=>inputs[key]=value},new Proxy({},{get:()=>()=>''}));
      assert.match(sql,/where RTRIM\(pgd\)=@dispatchNo/);assert.equal(inputs.dispatchNo,'A123');
      return {recordset:headers};
    })),/未找到|多个|不一致/);
  }
});
test('unresolved paper orders cannot be dispatched even by an administrator',()=>{
  assert.throws(()=>applyDispatchAction({shopId:'shop-hq',orderStatus:'待处理纸质委托书',stage:'待派工',version:0},
    {action:'assign',expectedVersion:0,requestId:'paper-test-request'},
    {id:'manager',role:'manager',active:true,shopId:'shop-hq'},[]),/派工操作/);
});

test('cross-shop paper recipients may read notified paper files but cannot edit or read ordinary cross-shop files',async()=>{
  const {assertFileReadAccess,assertFileAccess}=await import('../server/repositories/fileRepository.mjs');
  const user={id:'recipient',role:'advisor',name:'顾问',active:true,shopId:'other'};
  const file={order_id:'paper',shop_id:'owner',paper_order:{mode:'pending',photoIds:['photo']}};
  const database={query:async sql=>({rows:sql.includes('from dispatch_notifications')?[{exists:1}]:[file]})};
  await assert.doesNotReject(()=>assertFileReadAccess('photo',user,database));
  await assert.rejects(()=>assertFileAccess('photo',user,database),/其他门店/);
  await assert.rejects(()=>assertFileReadAccess('photo',user,{query:async()=>({rows:[{...file,paper_order:null}]})}),/其他门店/);
});
