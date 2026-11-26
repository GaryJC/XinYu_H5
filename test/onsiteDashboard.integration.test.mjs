import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { onsiteOrders } from '../server/domain/onsiteDashboard.mjs';

const url = process.env.ONSITE_TEST_ADMIN_URL;

test('SQL scopes live work, supports historical repair rows and counts vehicle use by Beijing departure month', {skip:!url}, async () => {
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
  process.env.DATABASE_URL = url;
  const { readOnsiteData } = await import('../server/repositories/onsiteDashboardRepository.mjs');
  const { onsiteDashboard } = await import('../server/services/onsiteDashboardService.mjs');
  const actor = {role:'manager', active:true, shopId:'primary'};
  for (const [user,query,status] of [[null,{},401],[{...actor,role:'advisor'},{},403],
    [{...actor,active:false},{},403],[{...actor,shopId:''},{},403],[actor,{category:'other'},400],
    [actor,{page:'0'},400],[actor,{pageSize:'101'},400]]) {
    await assert.rejects(onsiteDashboard(user,query), error => error.status===status);
  }
  const client = new pg.Client({connectionString:url});
  await client.connect();
  try {
    await client.query(`begin;
      create temp table work_orders(id text primary key, shop_id text, status text, vehicle_plate text, dispatch_no text, created_at timestamptz default '2026-11-01');
      create temp table dispatch_tasks(order_id text primary key,shop_id text,stage text,technician_id text,data jsonb);
      create temp table repair_items(order_id text,client_item_id int,item_no int,name text,status text,finish_at text);
      create temp table users(id text,name text,shop_id text);
      create temp table vehicle_trip_requests(shop_id text,departure_at timestamptz,proxy_returned_by text);
      insert into work_orders(id,shop_id,status) values ('unsigned','primary','待客户签字'),('draft','primary','草稿'),
        ('paper','primary','待处理纸质委托书'),('settled','primary','待结算'),('finished','primary','维修中'),('reopened','primary','完成'),
        ('foreign','other','维修中'),('legacy','primary','维修中'),('mismatch','primary','维修中');
      insert into work_orders(id,shop_id,status,created_at) values ('future','primary','维修中','2026-11-27T00:00:00Z');
      insert into dispatch_tasks values ('finished','primary','维修完成',null,'{}'),
        ('reopened','primary','待派工',null,'{"items":[]}'),('legacy','primary','待检验','u','{"dueAt":"2026-11-25T00:00:00Z"}'),
        ('mismatch','other','待检验',null,'{"items":[{"name":"外店项目","status":"待检验"}]}');
      insert into repair_items values ('legacy',1,1,'历史项目','待检验','2026-11-22T00:00:00Z');
      insert into users values ('u','本店员工','primary'),('outside','其他员工','other');
      insert into vehicle_trip_requests values ('primary','2026-10-31T15:59:59Z',null),('primary','2026-10-31T16:00:00Z',null),
        ('primary','2026-11-30T15:59:59Z','manager'),('primary','2026-11-30T16:00:00Z','manager'),('primary',null,null),
        ('other','2026-11-25T00:00:00Z','manager');`);
    const now = new Date('2026-11-26T00:00:00Z');
    const {orders,people,vehicle} = await readOnsiteData('primary',now,'2026-11',client);
    assert.deepEqual(orders.map(row=>row.orderId).sort(),['legacy','mismatch','reopened','unsigned']);
    assert.deepEqual(people,[{id:'u',name:'本店员工'}]);
    assert.deepEqual(vehicle,{month:'2026-11',tripCount:2,missedReturnCount:1});
    const result = onsiteOrders(orders,people,now,'inspection',1,20);
    assert.deepEqual(result.counts,{aged:4,overdue:1,parts:0,inspection:1});
    assert.deepEqual(result.items[0].projects,[{name:'历史项目',ownerName:'本店员工',waitingSince:'2026-11-22T00:00:00.000Z'}]);
  } finally {
    await client.query('rollback');
    await client.end();
  }
});
