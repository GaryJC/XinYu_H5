import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
const adminUrl=process.env.PROCUREMENT_TEST_ADMIN_URL;
test('procurement PostgreSQL, supplier isolation, concurrency, reports and notification persistence',{skip:!adminUrl,timeout:120000},async t=>{
  const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Only an isolated local test database is allowed');
  const connectionsClosed=[];
  const admin=new pg.Client({connectionString:adminUrl}),name=`codex_procurement_${Date.now()}_${process.pid}`;let pool,server,uploadRoot;
  await admin.connect();
  try{
    await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
    process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';process.env.DISPATCH_NOTIFICATION_MODE='mock';
    const database=await import('../server/database/pool.mjs');pool=database.pool;
    pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
    for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
    const people=[{id:'manager',name:'管理员',role:'manager',shopId:'shop-hq',active:true},{id:'warehouse',name:'仓管',role:'warehouse',shopId:'shop-hq',active:true},{id:'advisor',name:'顾问',role:'advisor',shopId:'shop-hq',active:true},{id:'outside',name:'别店',role:'manager',shopId:'other',active:true}];
    for(const u of people)await pool.query('insert into users(id,name,role,shop_id,active,dingtalk_user_id) values($1,$2,$3,$4,$5,$6)',[u.id,u.name,u.role,u.shopId,u.active,`ding-${u.id}`]);
    const [manager,warehouse,advisor,outside]=people;
    const s=await import('../server/services/procurementService.mjs'),repo=await import('../server/repositories/procurementRepository.mjs');
    const {handleSupplierPortal,handleProcurement}=await import('../server/routes/procurementRouter.mjs');
    const {sendJson}=await import('../server/http/response.mjs');
    const suppliers=[];
    for(let n=0;n<6;n++)suppliers.push(await s.updateSupplier(warehouse,null,{name:`供应商${n}`,contactName:`联系人${n}`,phone:`1380000000${n}`,categories:'制动',note:'内部信息',active:true}));
    const future=days=>new Date(Date.now()+days*86400000).toISOString();
    const body=()=>({partName:'刹车片',vin:'LSVAB1234A1234567',category:'制动',specification:'P-1',brand:'原厂',quantity:2,unit:'件',deliveryAddress:'门店',deliveryBy:future(3),paymentTerms:'含税发票',qualityRequirements:'全新',imageUrls:[],supplierIds:suppliers.slice(0,5).map(v=>v.id),deadline:null,requestId:randomUUID()});
    const quote=(price,invitationId)=>({invitationId,requestId:randomUUID(),unitPriceFen:price,freightFen:0,deliveryAt:future(2),meetsRequirements:true,declined:false,note:'可供货'});
    let created,sessions=[];
    await t.test('exclusive equal roles, cross-store denial, supplier archives and idempotent publication',async()=>{
      await assert.rejects(()=>s.listSuppliers(advisor),e=>e.status===403);
      assert.equal((await s.listSuppliers(outside)).length,0);
      const input=body(),results=await Promise.all([s.publishTender(manager,input),s.publishTender(manager,input)]);
      created=results.find(r=>r.links.length);assert.equal(created.links.length,5);assert.equal(results[0].tender.id,results[1].tender.id);
      assert.equal((await s.tenderDetail(warehouse,created.tender.id)).tender.id,created.tender.id);
      await assert.rejects(()=>s.tenderDetail(outside,created.tender.id),e=>e.status===404);
      await assert.rejects(()=>s.publishTender(warehouse,{...input,supplierIds:[randomUUID()],requestId:randomUUID()}),e=>e.status===400);
      assert.equal((await s.listTenders(manager)).length,1);
      assert.equal((await pool.query('select count(*) from procurement_notification_jobs')).rows[0].count,'1');
      await assert.rejects(()=>s.publishTender(manager,{...input,partName:'其他配件'}),e=>e.status===409);
    });
    await t.test('nameplate uploads are private, idempotent, scoped to shop and supplier invitation',async()=>{
      uploadRoot=await fs.mkdtemp(path.join(os.tmpdir(),'procurement-photo-'));process.env.LOCAL_UPLOAD_ROOT=uploadRoot;
      const photos=await import('../server/services/procurementPhotoService.mjs');
      const input={requestId:randomUUID(),mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='};
      await assert.rejects(()=>photos.uploadProcurementPhoto(advisor,input),e=>e.status===403);
      const uploaded=await Promise.all([photos.uploadProcurementPhoto(manager,input),photos.uploadProcurementPhoto(manager,input)]);
      assert.equal(uploaded[0].id,uploaded[1].id);
      const id=uploaded[0].id;
      const otherId=(await photos.uploadProcurementPhoto(manager,{...input,requestId:randomUUID()})).id;
      await assert.rejects(()=>s.publishTender(outside,{...body(),otherPhotoIds:[otherId]}),e=>e.status===403);
      await assert.rejects(()=>photos.procurementPhoto(outside,id),e=>e.status===403);
      await assert.rejects(()=>s.publishTender(outside,{...body(),nameplatePhotoIds:[id]}),e=>e.status===403);
      assert.ok((await photos.procurementPhoto(warehouse,id)).body.length);
      const withPhoto=await s.publishTender(manager,{...body(),nameplatePhotoIds:[id],otherPhotoIds:[otherId],vehicleModel:'NKR77'});
      const supplier=suppliers.find(v=>v.name===withPhoto.links[0].supplierName);
      const session=(await s.verifyPortal({token:withPhoto.links[0].token,phone:supplier.phone,identity:supplier.name},'photo-ip')).session;
      await s.authorizePortalPhoto(session,id);
      await s.authorizePortalPhoto(session,otherId);
      assert.deepEqual((await s.portal(session)).terms.otherPhotoIds,[otherId]);
      const unrelated=(await s.verifyPortal({token:created.links[0].token,phone:supplier.phone,identity:supplier.name},'unrelated-ip')).session;
      await assert.rejects(()=>s.authorizePortalPhoto(unrelated,id),e=>e.status===403);
      await assert.rejects(()=>s.authorizePortalPhoto(unrelated,otherId),e=>e.status===403);
      const tender=withPhoto.tender;
      await s.tenderAction(manager,tender.id,{action:'revoke-link',invitationId:tender.invitations.find(i=>i.supplierId===supplier.id).id});
      await assert.rejects(()=>s.authorizePortalPhoto(session,id),e=>e.status===401);
      await s.tenderAction(manager,tender.id,{action:'cancel',reason:'测试结束'});
    });
    await t.test('supplier information matching, sessions and zero competitor disclosure',async()=>{
      for(let n=0;n<created.links.length;n++){
        const link=created.links[n],supplier=suppliers.find(v=>v.name===link.supplierName);
        const verified=await s.verifyPortal({token:link.token,phone:supplier.phone,identity:supplier.name},`ip-${n}`);sessions.push({session:verified.session,supplier});
      }
      const own=await s.portal(sessions[0].session);
      assert.equal(own.kind,'quote');assert.equal(own.supplierName,sessions[0].supplier.name);
      const matching=created.links.find(l=>l.supplierName===sessions[0].supplier.name);
      assert.equal((await s.resumePortal(sessions[0].session,{token:matching.token})).supplierName,sessions[0].supplier.name);
      const other=created.links.find(l=>l.supplierName!==sessions[0].supplier.name);
      await assert.rejects(()=>s.resumePortal(sessions[0].session,{token:other.token}),e=>e.status===401);
      assert.doesNotMatch(JSON.stringify(own),/内部信息|token_hash|phone|invitations/);
      await assert.rejects(()=>s.verifyPortal({token:created.links[0].token,phone:'13999999999',identity:'冒充'},'wrong'),e=>e.status===403);
      await assert.rejects(()=>s.quote(sessions[0].session,quote(10000,randomUUID())),e=>e.status===409);
      for(let n=0;n<sessions.length;n++){const own=await s.portal(sessions[n].session);await s.quote(sessions[n].session,quote(10000+n*1000,own.invitationId));}
      assert.equal((await s.portal(sessions[0].session)).quotes.length,1);
      const internal=(await s.tenderDetail(warehouse,created.tender.id)).tender;
      assert.equal(internal.invitations.filter(i=>i.quotes.length).length,5,'internal live prices visible before close');
    });
    await t.test('versioned quotes are idempotent under concurrency, single winner cannot be overridden',async()=>{
      const own=await s.portal(sessions[0].session),input=quote(9000,own.invitationId);
      await Promise.all([s.quote(sessions[0].session,input),s.quote(sessions[0].session,input)]);
      assert.equal((await s.portal(sessions[0].session)).quotes.length,2);
      await assert.rejects(()=>s.quote(sessions[0].session,{...input,unitPriceFen:1}),e=>e.status===409);
      await s.tenderAction(warehouse,created.tender.id,{action:'close'});
      await assert.rejects(()=>s.quote(sessions[0].session,quote(8000,own.invitationId)),e=>e.status===409);
      const outcomes=await Promise.allSettled([s.tenderAction(manager,created.tender.id,{action:'settle'}),s.tenderAction(warehouse,created.tender.id,{action:'settle'})]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      assert.equal((await s.tenderDetail(manager,created.tender.id)).tender.winnerId,sessions[0].supplier.id);
      assert.match((await s.portal(sessions[0].session)).result,/已中标/);assert.match((await s.portal(sessions[1].session)).result,/未中标/);
    });
    await t.test('deadline rejects late quotes before worker runs; early completion is allowed; missed and failed counts',async()=>{
      const timed=await s.publishTender(warehouse,{...body(),deadline:future(1),requestId:randomUUID()});
      const early=await s.publishTender(manager,{...body(),deadline:future(1)});
      assert.equal((await s.tenderAction(warehouse,early.tender.id,{action:'close'})).tender.status,'closed','a configured deadline still allows early completion');
      const supplier=suppliers.find(v=>v.name===timed.links[0].supplierName),v=await s.verifyPortal({token:timed.links[0].token,phone:supplier.phone,identity:supplier.contactName},'deadline');
      const own=await s.portal(v.session);
      await pool.query("update procurement_tenders set deadline=now()-interval '1 second' where id=$1",[timed.tender.id]);
      await assert.rejects(()=>s.quote(v.session,quote(1,own.invitationId)),e=>e.status===409);
      assert.equal((await s.portal(v.session)).status,'closed');
      assert.equal((await s.tenderAction(warehouse,timed.tender.id,{action:'settle'})).tender.status,'failed');
    });
    await t.test('anonymized report snapshot, preview/publication, expiry, revocation and feedback',async()=>{
      // Create five comparable completed tenders with >=5 distinct competitors in aggregate.
      for(let n=0;n<5;n++){
        const all=await s.publishTender(manager,{...body(),supplierIds:suppliers.map(v=>v.id),requestId:randomUUID()});
        for(const inv of all.tender.invitations){const q=quote(inv.supplierId===suppliers[0].id?12000:10000,inv.id);await repo.submitQuote(pool,inv.id,{...q,totalFen:q.unitPriceFen*2});}
        await s.tenderAction(manager,all.tender.id,{action:'close'});
        await s.tenderAction(warehouse,all.tender.id,{action:'settle',winnerId:suppliers[1].id,reason:'同价选择交期更好'});
      }
      const range={from:new Date(Date.now()-86400000).toISOString(),to:future(1)};
      const r=await s.createReport(manager,{supplierId:suppliers[0].id,...range,note:'请改善价格'});
      assert.equal(r.publishedAt,null);assert.ok(r.snapshot.benchmark.gapBand);
      assert.doesNotMatch(JSON.stringify(r.snapshot),/供应商[1-5]|phone|priceIndex|totalFen|invitations/);
      const snapshot=r.snapshot,published=await s.reportAction(warehouse,r.id,{action:'publish'});
      const v=await s.verifyPortal({token:published.link.token,phone:suppliers[0].phone,identity:suppliers[0].name},'report');
      assert.equal((await s.portal(v.session)).kind,'report');
      assert.deepEqual((await s.portal(v.session)).report,snapshot);
      await assert.rejects(()=>s.quote(v.session,quote(1,randomUUID())),e=>e.status===401);
      await s.feedback(v.session,{reportId:r.id,feedback:'愿意重新议价'});
      assert.ok((await s.reportDetail(manager,r.id)).activity.some(a=>a.action==='报告反馈'));
      await assert.rejects(()=>s.reportDetail(outside,r.id),e=>e.status===404);
      await s.reportAction(manager,r.id,{action:'revoke'});
      await assert.rejects(()=>s.portal(v.session),e=>e.status===401);
      await assert.rejects(()=>s.verifyPortal({token:published.link.token,phone:suppliers[0].phone,identity:suppliers[0].name},'report'),e=>e.status===403);
      assert.deepEqual((await s.reportDetail(manager,r.id)).snapshot,snapshot);
      const analysis=await s.analytics(warehouse,range.from,range.to);assert.equal(analysis.awarded,6);assert.equal(analysis.failed,1);
    });
    await t.test('reissued links invalidate existing sessions and expired links are rejected',async()=>{
      const inv=created.tender.invitations.find(i=>i.supplierId===sessions[0].supplier.id);
      const r=await s.tenderAction(manager,created.tender.id,{action:'reissue-link',invitationId:inv.id});
      await assert.rejects(()=>s.portal(sessions[0].session),e=>e.status===401);
      const v=await s.verifyPortal({token:r.link.token,phone:sessions[0].supplier.phone,identity:sessions[0].supplier.name},'reissue');
      assert.equal((await s.portal(v.session)).kind,'quote');
      await pool.query('update procurement_links set expires_at=now()-interval \'1 second\' where token_hash=$1',[s.hashToken(r.link.token)]);
      await assert.rejects(()=>s.portal(v.session),e=>e.status===401);
    });
    await t.test('published requirements and deadline editing preserve quote history and require reconfirmation',async()=>{
      const input={...body(),supplierIds:[suppliers[0].id],deadline:future(1)};
      const published=await s.publishTender(warehouse,input);
      const verified=await s.verifyPortal({token:published.links[0].token,phone:suppliers[0].phone,identity:suppliers[0].name},'amend');
      const own=await s.portal(verified.session),q=quote(10000,own.invitationId);
      const before=Number((await pool.query('select count(*) from procurement_notification_jobs')).rows[0].count);
      await Promise.all([s.quote(verified.session,q),s.quote(verified.session,q)]);
      const after=Number((await pool.query('select count(*) from procurement_notification_jobs')).rows[0].count);
      assert.equal(after-before,1,'retries enqueue one submission notification only');
      const notice=(await pool.query('select payload from procurement_notification_jobs where tender_id=$1 order by created_at desc',[published.tender.id])).rows[0].payload;
      assert.match(notice.title,/已提交报价/);assert.match(notice.summary,/200.00/);
      let current=(await s.tenderDetail(manager,published.tender.id)).tender;
      assert.equal('deliveryAddress' in current.data,false,'new tenders no longer require or return a delivery address');
      await assert.rejects(()=>s.tenderAction(advisor,current.id,{...current.data,action:'update',deadline:future(2),expectedVersion:current.version}),e=>e.status===403);
      await assert.rejects(()=>s.tenderAction(outside,current.id,{...current.data,action:'update',deadline:future(2),expectedVersion:current.version}),e=>e.status===404);
      const stale=current.version;
      current=(await s.tenderAction(manager,current.id,{...current.data,action:'update',deadline:future(2),expectedVersion:current.version})).tender;
      assert.equal(current.termsVersion,1);assert.equal(current.invitations[0].quotes[0].termsVersion,1);
      await assert.rejects(()=>s.tenderAction(warehouse,current.id,{...current.data,action:'update',deadline:null,expectedVersion:stale}),e=>e.status===409);
      current=(await s.tenderAction(warehouse,current.id,{...current.data,quantity:3,specification:'新规格 P-2',action:'update',deadline:current.deadline,expectedVersion:current.version})).tender;
      assert.equal(current.termsVersion,2);assert.equal(current.invitations[0].quotes.length,1,'history retained');
      const portal=await s.portal(verified.session);assert.equal(portal.terms.quantity,3);assert.equal(portal.termsVersion,2);
      await assert.rejects(()=>s.quote(verified.session,quote(10000,own.invitationId)),e=>e.status===409);
      const {validQuote}=await import('../server/domain/procurement.mjs');assert.equal(validQuote(current,current.invitations[0]),false,'old terms must not be awarded');
      await s.quote(verified.session,{...quote(10000,own.invitationId),termsVersion:2});
      current=(await s.tenderDetail(manager,current.id)).tender;
      assert.equal(current.invitations[0].quotes[0].totalFen,30000);assert.equal(validQuote(current,current.invitations[0]),true);
      current=(await s.tenderAction(manager,current.id,{action:'close'})).tender;
      await assert.rejects(()=>s.tenderAction(warehouse,current.id,{...current.data,action:'update',deadline:null,expectedVersion:current.version}),e=>e.status===409);
      current=(await s.tenderAction(warehouse,current.id,{...current.data,action:'update',deadline:null,expectedVersion:current.version,reopen:true})).tender;
      assert.equal(current.status,'open');assert.equal(current.closedAt,null);assert.equal(current.termsVersion,2);
      await s.tenderAction(manager,current.id,{action:'close'});
      current=(await s.tenderAction(manager,current.id,{action:'settle'})).tender;
      assert.equal(current.winnerId,suppliers[0].id);
      await assert.rejects(()=>s.tenderAction(warehouse,current.id,{...current.data,action:'update',deadline:null,expectedVersion:current.version}),e=>e.status===409);
      const events=(await s.tenderDetail(manager,current.id)).audit.filter(a=>a.action==='修改询价');
      assert.equal(events.length,3);assert.equal(events.find(e=>e.detail.after.data.quantity===3&&e.detail.before.data.quantity===2).detail.before.data.specification,'P-1');
    });
    await t.test('durable manager/warehouse fanout, lease claim exclusivity and safe delivery',async()=>{
      const worker=await import('../server/workers/procurementWorker.mjs'),notifications=await import('../server/repositories/procurementNotificationRepository.mjs');
      while(await worker.resolveProcurementRecipients()){}
      const recipients=(await pool.query('select distinct recipient_id from procurement_notifications order by recipient_id')).rows.map(r=>r.recipient_id);assert.deepEqual(recipients,['manager','warehouse']);
      const claims=await Promise.all([notifications.claimDelivery(),notifications.claimDelivery()]);assert.notEqual(claims[0].id,claims[1].id);
      for(const row of claims)await notifications.finishDelivery(row,{status:'failed',error:'test',retryable:false});
      assert.equal(await worker.deliverProcurementNotification(),true);
      assert.ok((await pool.query("select 1 from procurement_notifications where status='accepted'")).rowCount);
    });
    await t.test('HTTP public entry works without employee login, rejects CSRF, limits guessing and scopes internal routes',async()=>{
      server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{if(await handleSupplierPortal(req,res,url))return;if(await handleProcurement(req,res,url,people.find(p=>p.id===req.headers['x-test-user'])))return;sendJson(res,404,{});}catch(e){sendJson(res,e.status||500,{error:e.message});}});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(`${root}/api/procurement/tenders`,{headers:{'x-test-user':'advisor'}})).status,403);
      assert.equal((await fetch(`${root}/api/procurement/tenders`,{headers:{'x-test-user':'warehouse'}})).status,200);
      assert.equal((await fetch(`${root}/api/supplier-portal/me`)).status,401);
      const link=created.links[1],supplier=suppliers.find(v=>v.name===link.supplierName),body={token:link.token,phone:supplier.phone,identity:supplier.name};
      const req=extra=>fetch(`${root}/api/supplier-portal/verify`,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
      assert.equal((await req({origin:'https://evil.example'})).status,403);
      const verified=await req({});assert.equal(verified.status,200);assert.match(verified.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
      const own=await fetch(`${root}/api/supplier-portal/me`,{headers:{cookie:verified.headers.get('set-cookie').split(';')[0]}});assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'no-store');
      let limited=false;for(let n=0;n<25;n++){const response=await req({});if(response.status===429){limited=true;break;}}assert.ok(limited);
    });
    await t.test('simplified inquiry can publish with omitted unit, quality and payment requirements',async()=>{
      const input=body();delete input.unit;delete input.qualityRequirements;delete input.paymentTerms;
      const result=await s.publishTender(manager,input);
      assert.equal(result.tender.data.unit,'件');assert.equal(result.tender.data.paymentTerms,'');assert.equal(result.tender.data.qualityRequirements,'');
      const detail=await s.tenderDetail(manager,result.tender.id);
      assert.equal(detail.tender.data.paymentTerms,'');
    });
  } finally {
    if(uploadRoot)await fs.rm(uploadRoot,{recursive:true,force:true});
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(pool){await pool.end();await Promise.all(connectionsClosed);}
    await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
  }
});
