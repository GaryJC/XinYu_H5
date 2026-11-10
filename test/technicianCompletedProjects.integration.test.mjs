import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {technicianCompletedProjects} from '../server/domain/technicianCompletedProjects.mjs';
import {pageResult} from '../server/domain/pagination.mjs';

const databaseUrl=process.env.COMPLETED_PROJECT_TEST_DATABASE_URL;
test('monthly project repository isolates owners and shops and counts each repair round once', {skip:!databaseUrl}, async () => {
  const url=new URL(databaseUrl);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  process.env.DATABASE_URL=databaseUrl;
  const {readCompletedProjectSnapshots}=await import('../server/repositories/technicianCompletedProjectsRepository.mjs');
  const client=new pg.Client({connectionString:databaseUrl});
  await client.connect();
  try {
    await client.query('begin');
    await client.query('create temporary table work_orders(id text,shop_id text,vehicle_plate text,dispatch_no text,created_at timestamptz default now()) on commit drop');
    await client.query('create temporary table dispatch_tasks(order_id text,technician_id text,data jsonb) on commit drop');
    await client.query('create temporary table repair_items(order_id text,client_item_id integer,name text,status text) on commit drop');
    await client.query('create temporary table dispatch_repair_rounds(order_id text,round_no integer,snapshot jsonb) on commit drop');
    const done=(id,owner)=>({id,name:'同名项目',responsibleId:owner,status:'已完工',inspectedAt:'2026-11-01T00:00:00Z'});
    async function seed(id,shop,data) {
      await client.query('insert into work_orders(id,shop_id,vehicle_plate,dispatch_no) values($1,$2,$1,$1)',[id,shop]);
      await client.query('insert into dispatch_tasks values($1,$2,$3)',[id,'A',data]);
    }
    const original={technicianIds:['A','B'],items:[done(1,'A'),done(2,'B')]};
    const current={repairRound:1,technicianIds:['B','C'],items:[done(1,'B'),{id:3,responsibleId:'C',status:'维修中'}]};
    await seed('rounds','shop',current);
    await seed('foreign','other-shop',original);
    await client.query('insert into dispatch_repair_rounds values($1,0,$2),($1,1,$3)',['rounds',original,current]);
    let rows=await readCompletedProjectSnapshots('shop','A',client);
    assert.deepEqual(technicianCompletedProjects(rows,'A','2026-11').map(p=>p.key),['rounds:0:1']);
    rows=await readCompletedProjectSnapshots('shop','B',client);
    assert.deepEqual(technicianCompletedProjects(rows,'B','2026-11').map(p=>p.key),['rounds:0:2','rounds:1:1']);
    assert.equal((await readCompletedProjectSnapshots('shop','unrelated',client)).length,0);
    await seed('partial','partial-shop',{stage:'维修中',orderStatus:'维修中',technicianIds:['A','B'],items:[done(1,'A'),done(2,'A'),{id:3,name:'乙未完工项目',responsibleId:'B',status:'维修中'}]});
    const ownCompleted=technicianCompletedProjects(await readCompletedProjectSnapshots('partial-shop','A',client),'A','2026-11');
    assert.equal(ownCompleted.length,2);
    assert.equal(technicianCompletedProjects(await readCompletedProjectSnapshots('partial-shop','B',client),'B','2026-11').length,0);
    // Null and omitted arrays both fall back to the one recorded technician.
    await seed('legacy','shop',{technicianIds:null,completedAt:'2026-11-02T00:00:00Z',items:[{id:7,name:'历史项目',status:'已完工'}]});
    rows=await readCompletedProjectSnapshots('shop','A',client);
    assert.ok(technicianCompletedProjects(rows,'A','2026-11').some(p=>p.orderId==='legacy'));
    await seed('many','shop',{technicianIds:['A'],items:Array.from({length:25},(_,index)=>done(index,'A'))});
    const projects=technicianCompletedProjects(await readCompletedProjectSnapshots('shop','A',client),'A','2026-11');
    const first=pageResult(projects,{page:1,pageSize:20}),second=pageResult(projects,{page:2,pageSize:20});
    assert.equal(first.total,27);assert.equal(second.total,27);
    assert.equal(new Set([...first.items,...second.items].map(p=>p.key)).size,27);
  } finally {
    await client.query('rollback');await client.end();
  }
});
