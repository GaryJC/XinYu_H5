import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const url=process.env.RELIABILITY_TEST_ADMIN_URL;
test('interactive transactions bound lock waits, reset deadlines and preserve rollback errors',{skip:!url,timeout:40000},async()=>{
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname));
 const admin=new pg.Client({connectionString:url});await admin.connect();
 const name=`reliability_${process.pid}_${Date.now()}`;let pool;
 try {
  await admin.query(`create database "${name}"`);const isolated=new URL(url);isolated.pathname=`/${name}`;process.env.DATABASE_URL=isolated.toString();
  const db=await import('../server/database/pool.mjs');pool=db.pool;
  await db.transaction(async client=>{assert.equal((await client.query('show lock_timeout')).rows[0].lock_timeout,'3s');assert.equal((await client.query('show statement_timeout')).rows[0].statement_timeout,'15s');});
  await db.transaction(async client=>{assert.equal((await client.query('show lock_timeout')).rows[0].lock_timeout,'0');assert.equal((await client.query('show statement_timeout')).rows[0].statement_timeout,'0');},{interactive:false});
  await pool.query('create table locks(id integer primary key,value integer);insert into locks values(1,0)');
  const holder=await pool.connect();
  try {
   await holder.query('begin');await holder.query('update locks set value=1 where id=1');
   await assert.rejects(()=>db.transaction(client=>client.query('update locks set value=2 where id=1')),error=>error.code==='55P03');
  } finally {await holder.query('rollback');holder.release();}
  assert.equal((await pool.query('select value from locks')).rows[0].value,0);
  const held=await Promise.all(Array.from({length:pool.options.max},()=>pool.connect()));
  try {await assert.rejects(()=>pool.connect(),/timeout/i);} finally {held.forEach(client=>client.release());}
  await assert.rejects(()=>db.transaction(client=>client.query('select pg_sleep(20)')),error=>error.code==='57014');
  assert.equal((await pool.query('select 1 as value')).rows[0].value,1);
  const original=new Error('original callback failure');
  await assert.rejects(()=>db.transaction(async client=>{const pid=(await client.query('select pg_backend_pid() as pid')).rows[0].pid;await admin.query('select pg_terminate_backend($1)',[pid]);throw original;}),error=>error===original);
  assert.equal((await pool.query('select 1 as value')).rows[0].value,1);
 } finally {await pool?.end();await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();}
});
