import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

// Only an explicitly selected local server; every run owns and removes its database.
const adminUrl=process.env.WORKFLOW_TEST_ADMIN_URL;
test('signature recovery and handover transactions',{skip:!adminUrl,timeout:120000},async t=>{
  const url=new URL(adminUrl);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const name=`codex_workflow_test_${process.pid}_${Date.now()}`;
  const admin=new pg.Client({connectionString:adminUrl,connectionTimeoutMillis:5000});let pool;
  const connectionsClosed=[];
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
    process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';process.env.RUNFENG_REPAIR_WRITEBACK_ENABLED='false';
    ({pool}=await import('../server/database/pool.mjs'));
    pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
    for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
    const people=[{id:'m',name:'管理员',role:'manager'},{id:'t',name:'原技师',role:'technician'},{id:'u',name:'新技师',role:'technician'},{id:'i',name:'检验员',role:'inspector'}].map(p=>({...p,shopId:'shop-hq',active:true}));
    for(const p of people)await pool.query("insert into users(id,name,role,shop_id,active,legacy_employee_code,legacy_employee_name,legacy_employee_department,legacy_employee_bound_at) values($1,$2,$3,$4,true,$5,$6,'test',now())",[p.id,p.name,p.role,p.shopId,p.id,p.name]);
    const [manager,tech,nextTech,inspector]=people;
    const db=await import('../server/db.mjs');
    async function seed(id,status='草稿') {
      const front=randomUUID(),rear=randomUUID(),signature=randomUUID();
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,vehicle_plate,vehicle_vin,vehicle_mileage,vehicle_model,vehicle_model_legacy_code,customer_name,customer_legacy_code,customer_phone,department_code,department_name,inspection)
        values($1,$2,'管理员','待派工','待检验','客户带走','沪ATEST','LSVAB1234A1234567','1000','测试车型','MODEL','测试客户','CUSTOMER','13800000000','01','维修部',$3)`,[id,status,JSON.stringify({preRepairPhotos:{front45:front,rear45:rear}})]);
      for(const [n,label] of [[1,'检查'],[2,'维修']])await pool.query("insert into repair_items(order_id,client_item_id,item_no,name) values($1,$2::bigint,$2::integer,$3)",[id,n,label]);
      for(const [file,kind] of [[front,'repair_order_photo'],[rear,'repair_order_photo'],[signature,'signature_image']])await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,$3,'local','','fixture','image/png',8,'m')",[file,id,kind]);
      return signature;
    }
    await t.test('valid sessions are reused; concurrent recovery creates one session and revokes old tokens',async()=>{
      await seed('renew');const first=await db.createSignatureTokenForOrder('renew',manager.name);
      const reused=await db.createSignatureTokenForOrder('renew',manager.name);assert.equal(reused.signatureToken,first.signatureToken);
      await pool.query("update signature_tokens set expires_at=now()-interval '1 second' where order_id='renew'");
      const [a,b]=await Promise.all([db.createSignatureTokenForOrder('renew',manager.name),db.createSignatureTokenForOrder('renew',manager.name)]);
      assert.equal(a.signatureToken,b.signatureToken);assert.notEqual(a.signatureToken,first.signatureToken);
      assert.equal(await db.findWorkOrderByToken(first.signatureToken),undefined);
      const {rows:[counts]}=await pool.query("select count(*) filter(where not used and (expires_at is null or expires_at>clock_timestamp())) as active from signature_tokens where order_id='renew'");assert.equal(counts.active,'1');
      const {rows:[expiry]}=await pool.query("select expires_at is null as valid from signature_tokens where token=$1",[a.signatureToken]);assert.equal(expiry.valid,true);
      await assert.rejects(()=>db.signWorkOrderByToken(first.signatureToken,'客户',null),e=>e.status===404);
    });
    await t.test('missing sessions recover and renewal racing signature submits exactly once',async()=>{
      const file=await seed('race','待客户签字');
      const session=await db.createSignatureTokenForOrder('race',manager.name);
      const results=await Promise.allSettled([db.createSignatureTokenForOrder('race',manager.name),db.signWorkOrderByToken(session.signatureToken,'测试客户',file)]);
      assert.equal(results[1].status,'fulfilled');
      if(results[0].status==='fulfilled')assert.equal(results[0].value.signatureToken,session.signatureToken);
      else assert.equal(results[0].reason.status,409);
      assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='race'")).rows[0].count,'0');
      const pending=await db.findWorkOrderById(pool,'race');assert.equal(pending.customerSignatureReview.state,'pending');assert.equal(pending.status,'待客户签字');
      await Promise.all([db.confirmCustomerSignature('race',manager),db.confirmCustomerSignature('race',manager)]);
      assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='race'")).rows[0].count,'1');
      await assert.rejects(()=>db.createSignatureTokenForOrder('race',manager.name),e=>e.status===409);
      await assert.rejects(()=>db.signWorkOrderByToken(session.signatureToken,'测试客户',file),e=>e.status===409);
    });
    await t.test('expired-token signing cannot race recovery into a valid signature',async()=>{
      const file=await seed('expired','待客户签字'),old=randomUUID();
      await pool.query("insert into signature_tokens(token,order_id,expires_at) values($1,'expired',now()-interval '1 day')",[old]);
      const [sign,recover]=await Promise.allSettled([db.signWorkOrderByToken(old,'客户',file),db.createSignatureTokenForOrder('expired',manager.name)]);
      assert.equal(sign.status,'rejected');assert.equal(sign.reason.status,404);assert.equal(recover.status,'fulfilled');
      assert.equal((await db.findWorkOrderByToken(recover.value.signatureToken)).status,'待客户签字');
    });
    await t.test('public mobile signature, resend, notification audience and staff approval gate',async()=>{
      const {createServer}=await import('node:http');
      const path=await import('node:path');const os=await import('node:os');
      const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'customer-signature-'));
      process.env.LOCAL_UPLOAD_ROOT=uploads;process.env.FILE_STORAGE_PROVIDER='local';
      const {default:sharp}=await import('sharp');
      const png=`data:image/png;base64,${(await sharp({create:{width:200,height:80,channels:3,background:'#222'}}).png().toBuffer()).toString('base64')}`;
      const {handleApiRequest}=await import('../server/routes/apiRouter.mjs');
      const server=createServer(async(req,res)=>{try{await handleApiRequest(req,res,new URL(req.url,'http://localhost'));}catch(e){res.statusCode=e.status||500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      async function post(route,body) {
        const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
      }
      try {
        for(const [id,name,shop] of [['a','负责顾问','shop-hq'],['b','其他顾问','shop-hq'],['c','外店管理员','other']]) {
          await pool.query("insert into users(id,name,role,shop_id,active) values($1,$2,$3,$4,true)",[id,name,id==='c'?'manager':'advisor',shop]);
        }
        await seed('remote');await pool.query("update work_orders set advisor='负责顾问' where id='remote'");
        await pool.query("insert into work_order_dispatch_plans(order_id,technician_id,assigned_by,due_at) values('remote','t','m',now()+interval '1 day')");
        const first=await db.createSignatureTokenForOrder('remote',manager.name);
        assert.match(first.signatureToken,/^sig_[a-f0-9]{64}$/);
        const renewed=await db.createSignatureTokenForOrder('remote',manager.name,{renew:true});
        assert.notEqual(first.signatureToken,renewed.signatureToken);
        const root='/api/public/customer-signature',token=renewed.signatureToken;
        assert.equal((await post(`${root}/session`,{token:first.signatureToken})).status,404);
        assert.equal((await post(`${root}/session`,{token:'sig_legacy_weak'})).status,404);
        const session=await post(`${root}/session`,{token});
        assert.equal(session.status,200);assert.equal(session.cache,'no-store');
        assert.equal(session.body.order.vehicle.plate,'沪ATEST');
        assert.equal(session.body.order.customer,undefined);assert.equal(session.body.order.files,undefined);assert.equal(session.body.order.advisor,undefined);
        assert.equal((await post(`${root}/sign`,null)).status,404);
        assert.equal((await post(`${root}/sign`,{token,imageBase64:png,confirmed:false})).status,400);
        assert.equal((await post(`${root}/sign`,{token,imageBase64:'data:image/png;base64,PHN2Zz4=',confirmed:true})).status,400);
        const signed=await Promise.all([post(`${root}/sign`,{token,imageBase64:png,confirmed:true,orderId:'wrong'}),post(`${root}/sign`,{token,imageBase64:png,confirmed:true})]);
        assert.deepEqual(signed.map(r=>r.status).sort(),[200,409]);
        assert.deepEqual((await post(`${root}/session`,{token})).body,{state:'signed'});
        const order=await db.findWorkOrderById(pool,'remote');
        assert.equal(order.status,'待客户签字');assert.equal(order.customerSignatureReview.state,'pending');assert.ok(order.customerSignatureFileId);
        assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='remote'")).rows[0].count,'0');
        assert.equal((await pool.query("select count(*) from dispatch_tasks where order_id='remote'")).rows[0].count,'0');
        const notices=(await pool.query("select * from dispatch_notifications where order_id='remote' and kind='需确认用户签字' order by recipient_id")).rows;
        assert.deepEqual(notices.map(r=>r.recipient_id),['a','m']);
        const {messageBody}=await import('../server/integrations/dingtalk/notifications.mjs');
        const message=messageBody(notices[0],'customer-advisor',{DISPATCH_APP_URL:'https://example.com/',DINGTALK_AGENT_ID:'1'});
        assert.match(message.msg.markdown.text,/workOrder=remote/);assert.match(message.msg.markdown.text,/确认/);
        assert.equal((await post('/api/work-orders/remote/confirm-customer-signature',{})).status,401);
        await assert.rejects(()=>db.confirmCustomerSignature('remote',{...manager,id:'b',role:'advisor',name:'其他顾问'}),e=>e.status===403);
        await assert.rejects(()=>db.confirmCustomerSignature('remote',{...manager,shopId:'other'}),e=>e.status===403);

        await assert.rejects(()=>db.transitionWorkOrder('remote','待派工',manager.name,'绕过确认'),e=>e.status===409);
        const extraToken='sig_'+'e'.repeat(64);
        await pool.query("insert into signature_tokens(token,order_id,expires_at) values($1,'remote',now()+interval '1 day')",[extraToken]);
        await assert.rejects(()=>db.signWorkOrderByToken(extraToken,'覆盖签名',order.customerSignatureFileId),e=>e.status===409);
        const {validateSignatureReviewRecipient}=await import('../server/repositories/customerSignatureReviewRepository.mjs');
        assert.equal(await validateSignatureReviewRecipient(notices[1],manager,pool),true);
        const resign=await db.createSignatureTokenForOrder('remote',manager.name,{renew:true});
        assert.equal(resign.signatures.customer,undefined);
        assert.equal(resign.customerSignatureReview,undefined);
        assert.equal((await post(`${root}/session`,{token})).status,404);
        assert.equal((await post(`${root}/session`,{token:resign.signatureToken})).body.expiresAt,null);
        assert.equal(await validateSignatureReviewRecipient(notices[1],manager,pool),false);
        assert.equal((await post(`${root}/sign`,{token:resign.signatureToken,imageBase64:png,confirmed:true})).status,200);
        const resigned=await db.findWorkOrderById(pool,'remote');
        const newNotices=(await pool.query("select * from dispatch_notifications where order_id='remote' and kind='需确认用户签字' and status='pending' order by recipient_id")).rows;
        assert.deepEqual(newNotices.map(r=>r.recipient_id),['a','m']);
        assert.equal(await validateSignatureReviewRecipient(newNotices[0],{...manager,id:'a',role:'advisor'},pool),true);
        assert.equal(await validateSignatureReviewRecipient(notices[1],manager,pool),false);
        const approved=await Promise.all([db.confirmCustomerSignature('remote',{...manager,id:'a',role:'advisor',name:'负责顾问'}),db.confirmCustomerSignature('remote',manager)]);
        assert.equal(approved[0].customerSignatureReview.state,'confirmed');
        assert.equal(approved[0].customerSignatureFileId,resigned.customerSignatureFileId);
        assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='remote'")).rows[0].count,'1');
        assert.equal((await pool.query("select count(*) from dispatch_tasks where order_id='remote'")).rows[0].count,'1');
        assert.equal(await validateSignatureReviewRecipient(notices[1],manager,pool),false);
        await assert.rejects(()=>db.confirmCustomerSignature('renew',manager),e=>e.status===409);
      } finally {
        await new Promise(resolve=>server.close(resolve));await fs.rm(uploads,{recursive:true,force:true});
      }
    });
    await t.test('handover persists historical owners and writes the final mixed-team snapshot',async()=>{
      await seed('handover','已委托');
      const service=await import('../server/services/dispatchService.mjs');
      async function act(user,action,extra={}) {
        const {task}=await service.dispatchDetail(manager,'handover');
        return service.executeDispatchAction(user,'handover',{action,expectedVersion:task.version,requestId:randomUUID(),...extra});
      }
      await act(manager,'assign',{technicianIds:[tech.id],dueAt:new Date(Date.now()+86400000).toISOString()});
      await act(tech,'accept',{partsRequirement:{mode:'none'}});await act(tech,'finish',{itemId:1});
      await act(manager,'reassign',{technicianIds:[nextTech.id],reason:'换班',dueAt:new Date(Date.now()+86400000).toISOString()});
      await act(nextTech,'accept');
      await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,'handover','repair_progress_photo','local','','fixture','image/png',8,'u')",[randomUUID()]);
      await act(nextTech,'submit-order');await act(inspector,'claim-inspection');await act(inspector,'inspect');
      const detail=await service.dispatchDetail(manager,'handover');assert.equal(detail.task.stage,'维修完成');
      assert.deepEqual(detail.task.items.map(i=>i.responsibleId),['t','u']);
      const snapshot=(await pool.query("select snapshot from repair_writebacks where order_id='handover'")).rows[0].snapshot;
      assert.deepEqual(snapshot.items.map(i=>i.employeeCode),['t','u']);
      const event=detail.events.find(e=>e.action==='reassign');assert.equal(event.detail.previousItems[1].responsibleId,'t');assert.equal(event.detail.items[1].responsibleId,'u');
    });
    if(process.env.WORKFLOW_UI_TEST==='true')await t.test('mobile signing recovery and supplier quote through real browser forms',async()=>{
      const {createServer}=await import('node:http');
      const path=await import('node:path');const os=await import('node:os');
      const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'repair-ui-uploads-'));
      process.env.LOCAL_UPLOAD_ROOT=uploads;process.env.JWT_SECRET='workflow-ui-test-secret-at-least-32-characters';
      const {default:sharp}=await import('sharp');
      await fs.writeFile(path.join(uploads,'fixture'),await sharp({create:{width:120,height:80,channels:3,background:'#6688aa'}}).png().toBuffer());
      const {handleApiRequest}=await import('../server/routes/apiRouter.mjs');
      const {serveStatic}=await import('../server/http/staticFiles.mjs');
      const {createTokenForUser}=await import('../server/auth.mjs');
      const {createAuthSession}=await import('../server/repositories/userRepository.mjs');
      const inFlight=new Set();
      const server=createServer((req,res)=>{
        const work=(async()=>{try{const url=new URL(req.url,'http://localhost');if(!await handleApiRequest(req,res,url))await serveStatic(res,url.pathname,path.resolve('dist'));}catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.message}));}})();
        inFlight.add(work);void work.finally(()=>inFlight.delete(work));
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const base=`http://127.0.0.1:${server.address().port}`;
      const {chromium}=await import(process.env.DISPATCH_PLAYWRIGHT_MODULE||'playwright');
      const browser=await chromium.launch({headless:true,executablePath:process.env.DISPATCH_CHROME_PATH});
      const pages=[],errors=[];const artifacts='output/playwright/remote-signature-qa';await fs.mkdir(artifacts,{recursive:true});
      async function pageFor(route,authenticated=true,mobile=true) {
        const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
        const page=await context.newPage();pages.push(page);page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
        if(authenticated){const token=createTokenForUser(manager.id);await createAuthSession({token,userId:manager.id,expiresAt:new Date(Date.now()+3600000)});await page.addInitScript(token=>localStorage.setItem('repair-h5-auth-token',token),token);}
        await page.goto(`${base}${route}`);return page;
      }
      try {
        await seed('ui-signature','待客户签字');
        const old=randomUUID();await pool.query("insert into signature_tokens(token,order_id,expires_at) values($1,'ui-signature',now()-interval '1 day')",[old]);
        const signing=await pageFor('/');
        await signing.locator('.archive-order-card').filter({hasText:'ui-signature'}).click();
        await signing.getByRole('button',{name:'继续签字',exact:true}).click();
        const form=signing.getByRole('dialog',{name:'机动车维修委托确认',exact:true});
        await form.waitFor();assert.equal(await db.findWorkOrderByToken(old),undefined);
        await form.getByText('横屏签字',{exact:true}).click();
        const landscape=signing.getByRole('dialog',{name:'横屏签字',exact:true});
        const canvas=landscape.getByLabel('手写签名区域');await canvas.scrollIntoViewIfNeeded();
        const box=await canvas.boundingBox();assert.ok(box);
        await signing.mouse.move(box.x+box.width*.2,box.y+box.height*.4);await signing.mouse.down();
        await signing.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{steps:12});await signing.mouse.up();
        await landscape.getByRole('button',{name:'完成横屏签字',exact:true}).click();
        await form.getByRole('button',{name:'确认签字',exact:true}).click();
        await form.getByText('客户签字已保存，需确认用户签字。请关闭此弹窗，在委托单上核对并确认后进入后续流程。',{exact:true}).waitFor();
        assert.equal((await pool.query("select count(*) from signatures where order_id='ui-signature' and signer_type='customer'")).rows[0].count,'1');
        await signing.screenshot({path:`${artifacts}/mobile-signature.png`,fullPage:true});
        await form.getByRole('button',{name:/^完\s*成$/}).click();
        assert.equal(await signing.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

        await seed('ui-remote','待客户签字');
        await signing.reload();
        await signing.locator('.archive-order-card').filter({hasText:'ui-remote'}).click();
        await signing.getByRole('button',{name:'继续签字',exact:true}).click();
        const remoteForm=signing.getByRole('dialog',{name:'机动车维修委托确认',exact:true});
        const oldLink=await remoteForm.getByLabel('客户签字链接',{exact:true}).inputValue();
        await remoteForm.getByRole('button',{name:'重新发送链接',exact:true}).click();
        await signing.getByRole('button',{name:'生成新链接',exact:true}).click();
        await remoteForm.getByText('新链接已生成，旧链接已失效。请复制新链接并重新发送给客户。',{exact:true}).waitFor();
        const newLink=await remoteForm.getByLabel('客户签字链接',{exact:true}).inputValue();
        assert.notEqual(newLink,oldLink);
        const invalid=await pageFor(new URL(oldLink).pathname+new URL(oldLink).hash,false);
        await invalid.getByRole('alert').getByText(/签字链接不存在或已过期/).waitFor();
        const customer=await pageFor(new URL(newLink).pathname+new URL(newLink).hash,false);
        await customer.getByRole('heading',{name:'维修项目',exact:true}).waitFor();
        assert.equal(await customer.getByRole('button',{name:'确认签字并提交',exact:true}).isDisabled(),true);
        await customer.getByRole('button',{name:'横屏签字',exact:true}).click();
        const remoteLandscape=customer.getByRole('dialog',{name:'横屏签字',exact:true});
        const remoteCanvas=remoteLandscape.getByLabel('手写签名区域');const rect=await remoteCanvas.boundingBox();assert.ok(rect);
        await customer.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.3);await customer.mouse.down();
        await customer.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.7,{steps:16});await customer.mouse.up();
        await remoteLandscape.getByRole('button',{name:'完成横屏签字',exact:true}).click();
        await customer.screenshot({path:`${artifacts}/customer-signature-form.png`,fullPage:true});
        await customer.getByRole('checkbox').check();
        await customer.getByRole('button',{name:'确认签字并提交',exact:true}).click();
        await customer.getByText('签字已提交',{exact:true}).waitFor();
        assert.equal((await db.findWorkOrderById(pool,'ui-remote')).customerSignatureReview.state,'pending');
        assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='ui-remote'")).rows[0].count,'0');
        assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await customer.screenshot({path:`${artifacts}/customer-remote-signed.png`,fullPage:true});
        await customer.reload();await customer.getByText('签字已提交',{exact:true}).waitFor();
        await remoteForm.getByRole('button',{name:'刷新签字状态',exact:true}).click();
        await remoteForm.getByText('客户已完成签字，需确认用户签字。请关闭弹窗后核对并确认。',{exact:true}).waitFor();
        await remoteForm.getByRole('button',{name:/^完\s*成$/}).click();
        await signing.screenshot({path:`${artifacts}/staff-signature-pending.png`,fullPage:true});
        await signing.getByRole('button',{name:'确认用户签字',exact:true}).click();
        const [approvalResponse] = await Promise.all([
          signing.waitForResponse(response => response.url().endsWith('/confirm-customer-signature')),
          signing.getByRole('dialog',{name:'确认客户签名并继续流程？',exact:true}).getByRole('button',{name:'确认用户签字',exact:true}).click()
        ]);
        assert.equal(approvalResponse.status(),200,await approvalResponse.text());
        await signing.getByRole('button',{name:'确认用户签字',exact:true}).waitFor({state:'hidden'});
        assert.equal((await db.findWorkOrderById(pool,'ui-remote')).customerSignatureReview.state,'confirmed');
        assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='ui-remote'")).rows[0].count,'1');
        await signing.screenshot({path:`${artifacts}/staff-signature-approved.png`,fullPage:true});

        const procurement=await import('../server/services/procurementService.mjs');
        const supplier=await procurement.updateSupplier(manager,null,{name:'浏览器测试供应商',contactName:'测试联系人',phone:'13800000000',active:true});
        const tender=await procurement.publishTender(manager,{requestId:randomUUID(),supplierIds:[supplier.id],partName:'浏览器测试机油',category:'保养',specification:'5W-30',brand:'测试品牌',quantity:2,unit:'桶',deliveryBy:new Date(Date.now()+86400000*3).toISOString(),deadline:new Date(Date.now()+86400000).toISOString(),paymentTerms:'含税月结'});
        const portal=await pageFor(`/supplier#${tender.links[0].token}`,false);
        await portal.getByLabel('预留手机号',{exact:true}).fill('13800000000');
        await portal.getByLabel('联系人姓名或供应商名称',{exact:true}).fill('测试联系人');
        await portal.getByRole('button',{name:/^进\s*入$/}).click();
        await portal.getByLabel('含税单价（元）',{exact:true}).fill('100');
        await portal.getByLabel('运费（元）',{exact:true}).fill('10');
        await portal.getByRole('checkbox',{name:'确认满足本次配件规格、品牌、数量、质量及发票付款要求',exact:true}).check();
        await portal.getByRole('button',{name:'确认提交报价',exact:true}).click();
        const quote=portal.getByRole('dialog',{name:'确认提交此次报价？',exact:true});
        await quote.getByRole('button',{name:/^确\s*定$/}).click();
        await portal.getByText('报价已保存，以结束前最后一次提交为准。',{exact:true}).waitFor();
        let detail=await procurement.tenderDetail(manager,tender.tender.id);assert.equal(detail.tender.invitations[0].quotes[0].totalFen,21000);
        await portal.screenshot({path:`${artifacts}/mobile-supplier-quote.png`,fullPage:true});
        assert.equal(await portal.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        const buyer=await pageFor(`/?procurementTender=${tender.tender.id}`,true,false);
        await buyer.getByRole('button',{name:'提前结束报价',exact:true}).click();
        await buyer.getByRole('dialog',{name:'提前结束本次报价？',exact:true}).getByRole('button',{name:/^确\s*定$/}).click();
        await buyer.getByRole('button',{name:'确认中标',exact:true}).click();
        await Promise.all([buyer.waitForResponse(response=>response.url().endsWith(`/api/procurement/tenders/${tender.tender.id}/actions`)&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='settle'&&response.ok()),buyer.getByRole('dialog',{name:'确认最低有效价中标？',exact:true}).getByRole('button',{name:/^确\s*定$/}).click()]);
        await buyer.getByRole('button',{name:'确认中标',exact:true}).waitFor({state:'hidden'});
        detail=await procurement.tenderDetail(manager,tender.tender.id);assert.equal(detail.tender.winnerId,supplier.id);assert.equal(detail.tender.status,'awarded');
        await portal.getByText('刷新状态',{exact:true}).click();
        await portal.getByText(/您已中标，请联系采购员确认供货/).waitFor();
        await buyer.screenshot({path:`${artifacts}/desktop-procurement.png`,fullPage:true});
        assert.deepEqual(errors,[]);
      }catch(error){for(const [i,page] of pages.entries()){console.log('Workflow browser state:',await page.locator('body').innerText());await page.screenshot({path:`${artifacts}/failure-${i}.png`,fullPage:true});}throw error;}
      finally{await browser.close();await new Promise(resolve=>server.close(resolve));await Promise.allSettled([...inFlight]);await fs.rm(uploads,{recursive:true,force:true});}
    });
  } finally {
    if(pool)await pool.end();
    await Promise.all(connectionsClosed);
    await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
  }
});
