import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import {readHistoryCandidates,completeHistoricalOrders} from '../server/repositories/legacyHistoryCompletionRepository.mjs';
const adminUrl=process.env.HISTORY_TEST_ADMIN_URL;
test('history completion commits status/audit, preserves original times, rejects repeat/active work and rolls back', {skip:!adminUrl}, async()=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const name=`history_test_${process.pid}_${Date.now()}`;const admin=new pg.Client({connectionString:adminUrl});await admin.connect();let db;
 try{
 await admin.query(`create database "${name}"`);url.pathname='/'+name;db=new pg.Client({connectionString:url.toString()});await db.connect();
 for(const f of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) await db.query(await fs.readFile('supabase/migrations/'+f,'utf8'));
 await db.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_status,dispatch_no,department_code,legacy_document_no,vehicle_plate,created_at) values('WT-1','已委托','顾问','待派工','待检验','环保处理','synced','A1','A',10,'鲁B12345','2026-10-20')`);
 await db.query("insert into repair_items(order_id,client_item_id,item_no,name) values('WT-1',1,1,'维修')");
 const headers=[{pgd:'A1',wd:'',dh:10,department:'A',plate:'鲁B12345',approved:'1',arrival:'2026.10.20'}];const cutoff='2026-10-21T03:15:00Z';
 await db.query('begin');let orders=await readHistoryCandidates(db,['WT-1'],true);
 await completeHistoricalOrders(db,orders,headers,cutoff,'rollback-test');await db.query('rollback');
 assert.equal((await db.query("select status from work_orders where id='WT-1'")).rows[0].status,'已委托');assert.equal((await db.query('select count(*) from audit_logs')).rows[0].count,'0');
 await db.query("insert into dispatch_tasks(order_id,shop_id,stage) values('WT-1','shop-hq','待派工')");
 orders=await readHistoryCandidates(db,['WT-1']);assert.equal(orders[0].has_activity,true);await assert.rejects(()=>completeHistoricalOrders(db,orders,headers,cutoff,'blocked'));
 await db.query("delete from dispatch_tasks where order_id='WT-1'");
 await db.query('begin');orders=await readHistoryCandidates(db,['WT-1'],true);await completeHistoricalOrders(db,orders,headers,cutoff,'success');await db.query('commit');
 const w=(await db.query("select status,legacy_approved from work_orders where id='WT-1'")).rows[0];assert.deepEqual(w,{status:'完成',legacy_approved:true});
 assert.deepEqual((await db.query('select status,start_at,finish_at,inspector from repair_items')).rows[0],{status:'已完工',start_at:'',finish_at:'',inspector:'待检验'});
 assert.equal((await db.query('select count(*) from audit_logs')).rows[0].count,'1');assert.equal((await db.query('select count(*) from legacy_sync_outbox')).rows[0].count,'0');
 orders=await readHistoryCandidates(db,['WT-1']);await assert.rejects(()=>completeHistoricalOrders(db,orders,headers,cutoff,'repeat'));
 await db.query("update work_orders set status='已委托' where id='WT-1'");
 await db.query("update repair_items set status='待派工' where order_id='WT-1'");
 await db.query('alter table work_orders drop column legacy_approved');
 orders=await readHistoryCandidates(db,['WT-1']);await completeHistoricalOrders(db,orders,headers,cutoff,'older-schema');
 assert.equal((await db.query("select status from work_orders where id='WT-1'")).rows[0].status,'完成');
 }finally{await db?.end();await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();}
});
