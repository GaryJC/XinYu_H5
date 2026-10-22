import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
const adminUrl=process.env.PAPER_ORDER_TEST_ADMIN_URL;
test('paper order creation, notification, import and signature-free completion transactions', {skip:!adminUrl,timeout:120000},async t=>{
  const url=new URL(adminUrl);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  const name=`codex_paper_test_${process.pid}_${Date.now()}`;
  const admin=new pg.Client({connectionString:adminUrl});
  let pool;
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    url.pathname=`/${name}`;process.env.DATABASE_URL=url.toString();
    ({pool}=await import('../server/database/pool.mjs'));
    for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql') && f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
    const {createWorkOrder,updateWorkOrder,createSignatureTokenForOrder,findWorkOrderById}=await import('../server/db.mjs');
    const {resolvePaperOrder,submitPaperDingTalkOrder}=await import('../server/services/paperOrderService.mjs');
    const actor={id:'paper-manager',name:'纸质单管理员',role:'manager',active:true,shopId:'shop-hq'};
    const advisor={...actor,id:'paper-advisor',name:'纸质单顾问',role:'advisor'};
    await pool.query(`insert into users(id,name,role,shop_id) values($1,$2,'manager','shop-hq'),($3,$4,'advisor','shop-hq')`,[actor.id,actor.name,advisor.id,advisor.name]);
    const other={...advisor,id:'paper-other-advisor',name:'其他门店顾问',shopId:'other-shop'};
    await pool.query("insert into users(id,name,role,shop_id) values($1,$2,'advisor',$3)",[other.id,other.name,other.shopId]);
    let serial=0;
    async function makePaper() {
      const fileId=`paper-photo-${++serial}`;
      await pool.query(`insert into files(id,kind,storage_provider,bucket,object_key,mime_type,uploaded_by)
        values($1,'other','local','','test.jpg','image/jpeg',$2)`,[fileId,actor.id]);
      return createWorkOrder({paperOrder:{mode:'runfeng',photoIds:[fileId]},advisor:actor.name,shop:{id:actor.shopId}},actor.name,actor);
    }
    await t.test('ordinary electronic drafts remain valid without paper metadata',async()=>{
      const electronic=await createWorkOrder({advisor:actor.name,shop:{id:actor.shopId}},actor.name,actor);
      assert.equal(electronic.status,'草稿');assert.equal(electronic.paperOrder,undefined);
    });
    let order;
    await t.test('photo-only creation saves a tagged record and notifications atomically, with no dispatch or Runfeng outbox',async()=>{
      order=await makePaper();
      assert.equal(order.status,'待处理纸质委托书');assert.equal(order.paperOrder.mode,'pending');
      assert.equal(order.files.length,1);assert.equal(order.files[0].kind,'other');
      assert.equal(order.vehicle.plate,'');assert.equal(order.repairItems.length,0);
      assert.equal((await pool.query('select count(*) from legacy_sync_outbox')).rows[0].count,'0');
      assert.equal((await pool.query('select count(*) from dispatch_tasks')).rows[0].count,'0');
      const recipients=(await pool.query('select recipient_id from dispatch_notifications where order_id=$1',[order.id])).rows.map(r=>r.recipient_id);
      assert.ok(recipients.includes(actor.id));assert.ok(recipients.includes(advisor.id));assert.ok(recipients.includes(other.id));
      const {listWorkOrders}=await import('../server/db.mjs');
      const crossShop=await listWorkOrders(other.role,other);
      assert.ok(crossShop.some(row=>row.id===order.id));
      assert.ok(crossShop.every(row=>row.paperOrder));
      const {assertFileReadAccess,assertFileAccess}=await import('../server/repositories/fileRepository.mjs');
      await assert.doesNotReject(()=>assertFileReadAccess(order.files[0].id,other,pool));
      await assert.rejects(()=>assertFileAccess(order.files[0].id,other,pool),/其他门店/);
    });
    await t.test('additional pending-paper photos remain part of the paper document',async()=>{
      const {updateWorkOrderPhoto}=await import('../server/repositories/workOrderPhotoRepository.mjs');
      const {transaction}=await import('../server/database/pool.mjs');
      const original=order.paperOrder.photoIds[0];
      await pool.query("insert into files(id,kind,storage_provider,bucket,object_key,mime_type,uploaded_by) values('paper-extra','other','local','','extra.jpg','image/jpeg',$1)",[actor.id]);
      await transaction(client=>updateWorkOrderPhoto(client,order.id,{slot:'other',fileId:'paper-extra'},actor));
      order=await findWorkOrderById(pool,order.id);
      assert.deepEqual(order.paperOrder.photoIds,[original,'paper-extra']);
      assert.equal((await pool.query('select count(*) from legacy_sync_outbox where order_id=$1',[order.id])).rows[0].count,'0');
    });
    await t.test('missing or unauthorized photographs roll back both record and notification',async()=>{
      const before=(await pool.query('select count(*) from work_orders')).rows[0].count;
      for(const photoIds of [[],['missing']]) await assert.rejects(()=>createWorkOrder({paperOrder:{photoIds},shop:{id:actor.shopId}},actor.name,actor),/照片/);
      assert.equal((await pool.query('select count(*) from work_orders')).rows[0].count,before);
    });
    await t.test('any same-shop advisor may take the pending order, but other shops/roles cannot',async()=>{
      for(const user of [{...actor,shopId:'other'},{...actor,role:'technician'}]) await assert.rejects(()=>resolvePaperOrder(order.id,{mode:'dingtalk'},user),/无权/);
      order=await resolvePaperOrder(order.id,{mode:'dingtalk'},advisor);
      assert.equal(order.status,'草稿');assert.equal(order.advisor,advisor.name);
      await assert.rejects(()=>resolvePaperOrder(order.id,{mode:'dingtalk'},advisor),/已处理/);
      const supplemental=await createSignatureTokenForOrder(order.id,advisor.name);
      assert.equal(supplemental.signaturePurpose,'supplement');assert.equal(supplemental.status,'草稿');
      await assert.rejects(()=>submitPaperDingTalkOrder(order.id,advisor),/必填/);
    });
    await t.test('DingTalk completion requires normal form data but no signature or vehicle photos, emits exactly one outgoing create',async()=>{
      const filled={...order,department:{code:'A',name:'维修部'},vehicle:{plate:'鲁B12345',vin:'LSVAB1234A1234567',mileage:'1000',model:'测试车型',modelLegacyCode:'TEST'},
        customer:{name:'测试单位',legacyCode:'TESTORG',phone:'13000000000'},repairItems:[{id:1,name:'常规检查'}],paperOrder:undefined};
      order=await updateWorkOrder(filled,advisor.name,'补全纸质委托单',advisor);
      assert.equal(order.paperOrder.mode,'dingtalk');
      order=await submitPaperDingTalkOrder(order.id,advisor);
      assert.equal(order.status,'已委托');assert.deepEqual(order.signatures,{});assert.equal(order.legacySyncStatus,'pending');
      const outbox=(await pool.query('select payload from legacy_sync_outbox where order_id=$1',[order.id])).rows;
      assert.equal(outbox.length,1);assert.equal(outbox[0].payload.order.signatureExemption,'纸质委托书');
      await assert.rejects(()=>submitPaperDingTalkOrder(order.id,advisor),/只能提交/);
      assert.equal((await pool.query('select count(*) from legacy_sync_outbox where order_id=$1',[order.id])).rows[0].count,'1');
    });
    const snapshot={header:{reid:101,dh:201,pgd:'A123',ch:'鲁B12345',lc:'1234',jcrq:'20261017',jhrq:'20261018',wxnr:'润丰故障描述',fyhj:120,ssdw:'ORG',lxr:'联系人',lxdh:'13000000001',bm:'D',department_name:'机电部'},
      vehicle:{sbdm:'LSVAB1234A1234567',model_name:'润丰车型',model_code:'MODEL'},customer:{mc:'润丰单位',jydz:'润丰地址'},items:[{reid:301,hh:'润丰项目',je:120}]};
    await t.test('unsubmitted DingTalk drafts may switch to Runfeng, preserving photos and rolling back failed imports',async()=>{
      let draft=await makePaper();
      draft=await resolvePaperOrder(draft.id,{mode:'dingtalk'},advisor);
      draft=await updateWorkOrder({...draft,faultDescription:'保留到关联成功的草稿内容',repairItems:[{id:1,name:'草稿项目'}]},advisor.name,'保存草稿',advisor);
      const source=structuredClone(snapshot);source.header={...source.header,reid:102,dh:202,pgd:'A125'};
      const importOrder=user=>resolvePaperOrder(draft.id,{mode:'runfeng',dispatchNo:'A125'},user,{readSource:async()=>source});
      await assert.rejects(()=>importOrder({...advisor,name:'其他顾问'}),/自己负责/);
      await assert.rejects(()=>importOrder(other),/无权/);
      await assert.rejects(()=>resolvePaperOrder(draft.id,{mode:'runfeng',dispatchNo:'A125'},advisor,
        {readSource:async()=>{throw new Error('Runfeng unavailable');}}),/unavailable/);
      const unchanged=await findWorkOrderById(pool,draft.id);
      assert.equal(unchanged.paperOrder.mode,'dingtalk');assert.equal(unchanged.status,'草稿');
      assert.equal(unchanged.faultDescription,draft.faultDescription);
      assert.equal(unchanged.repairItems[0].name,'草稿项目');
      const imported=await importOrder(advisor);
      assert.equal(imported.paperOrder.mode,'runfeng');assert.equal(imported.dispatchNo,'A125');
      assert.equal(imported.status,'已委托');assert.equal(imported.legacySyncStatus,'synced');
      assert.deepEqual(imported.paperOrder.photoIds,draft.paperOrder.photoIds);
      assert.equal(imported.repairItems.length,1);assert.equal(imported.repairItems[0].name,'润丰项目');
      assert.equal((await pool.query('select count(*) from legacy_sync_outbox where order_id=$1',[draft.id])).rows[0].count,'0');
      await assert.rejects(()=>importOrder(advisor),/已处理/);
      await assert.rejects(()=>submitPaperDingTalkOrder(draft.id,advisor),/只能提交/);
      await assert.rejects(()=>resolvePaperOrder(order.id,{mode:'runfeng',dispatchNo:'A125'},actor,{readSource:async()=>source}),/已处理/);
    });
    let imported;
    await t.test('Runfeng import transfers identity, contact, department, items and fees while retaining the paper photo, without outbound sync',async()=>{
      imported=await makePaper();
      const source=async row=>{assert.equal(row.paperDispatchNo,'A123');return structuredClone(snapshot);};
      imported=await resolvePaperOrder(imported.id,{mode:'runfeng',dispatchNo:'a123'},actor,{readSource:source});
      assert.equal(imported.paperOrder.mode,'runfeng');assert.equal(imported.status,'已委托');assert.equal(imported.dispatchNo,'A123');
      assert.equal(imported.vehicle.vin,snapshot.vehicle.sbdm);assert.equal(imported.vehicle.model,'润丰车型');
      assert.equal(imported.customer.phone,'13000000001');assert.equal(imported.customer.name,'润丰单位');
      assert.equal(imported.department.name,'机电部');assert.equal(imported.repairItems[0].name,'润丰项目');assert.equal(imported.estimatedFee,120);
      assert.equal(imported.files[0].id,imported.paperOrder.photoIds[0]);assert.equal(imported.files[0].kind,'other');
      assert.equal(imported.legacySyncStatus,'synced');
      assert.equal((await pool.query('select count(*) from legacy_sync_outbox where order_id=$1',[imported.id])).rows[0].count,'0');
    });
    await t.test('imported paper corrections enqueue an update at revision one and ACK the original source',async()=>{
      const {updateCustomerVehicle}=await import('../server/services/customerVehicleUpdateService.mjs');
      assert.equal(imported.legacySyncRevision,0);
      imported=await updateCustomerVehicle(imported.id,{expectedRevision:0,contact:'更正联系人',phone:'13000000002',
        model:'润丰车型',modelLegacyCode:'MODEL',organization:'润丰单位',organizationLegacyCode:'ORG'},actor,
        {enabled:true,readReference:async kind=>({value:kind==='model'?'润丰车型':'润丰单位'})});
      assert.equal(imported.legacySyncRevision,1);assert.equal(imported.legacySyncStatus,'pending');
      assert.ok(imported.customerVehicleUpdatedAt);
      const events=(await pool.query('select * from legacy_sync_outbox where order_id=$1',[imported.id])).rows;
      assert.equal(events.length,1);assert.equal(events[0].event_type,'updated');
      assert.equal(events[0].legacy_dispatch_no,'A123');
      const claimed=(await pool.query("select * from claim_legacy_sync_events('paper-consumer',20)")).rows.find(row=>row.order_id===imported.id);
      assert.ok(claimed);
      assert.equal((await pool.query("select acknowledge_legacy_sync_event($1,'paper-consumer',101,201,'A123') as ok",[claimed.event_id])).rows[0].ok,true);
      imported=await findWorkOrderById(pool,imported.id);
      assert.equal(imported.legacySyncStatus,'synced');assert.equal(imported.customer.contact,'更正联系人');
    });
    await t.test('replacing a paper photograph updates the exemption reference and retains the original for audit',async()=>{
      const {updateWorkOrderPhoto}=await import('../server/repositories/workOrderPhotoRepository.mjs');
      const {transaction}=await import('../server/database/pool.mjs');
      const original=imported.paperOrder.photoIds[0];
      await pool.query("insert into files(id,kind,storage_provider,bucket,object_key,mime_type,uploaded_by) values('replacement','other','local','','new.jpg','image/jpeg',$1)",[actor.id]);
      await transaction(client=>updateWorkOrderPhoto(client,imported.id,{slot:'other',fileId:'replacement',replaceFileId:original},actor));
      imported=await findWorkOrderById(pool,imported.id);
      assert.deepEqual(imported.paperOrder.photoIds,['replacement']);
      assert.ok(imported.inspection.replacedPhotoIds.includes(original));
      assert.ok(imported.files.some(file=>file.id===original));
    });
    await t.test('duplicate source links, invalid data and source failures leave pending records untouched',async()=>{
      const pending=await makePaper();
      await assert.rejects(()=>resolvePaperOrder(pending.id,{mode:'runfeng',dispatchNo:'A123'},actor,{readSource:async()=>snapshot}),/已关联/);
      await assert.rejects(()=>resolvePaperOrder(pending.id,{mode:'runfeng',dispatchNo:'A124'},actor,{readSource:async()=>{throw new Error('Runfeng unavailable');}}),/unavailable/);
      assert.equal((await findWorkOrderById(pool,pending.id)).status,'待处理纸质委托书');
    });
    await t.test('concurrent resolutions produce a single winner',async()=>{
      const pending=await makePaper();
      const results=await Promise.allSettled([resolvePaperOrder(pending.id,{mode:'dingtalk'},actor),resolvePaperOrder(pending.id,{mode:'dingtalk'},advisor)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
    });
  } finally {
    if(pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
  }
});
