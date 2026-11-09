import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const value=process.env.RELEASE_TEST_ADMIN_URL;
if(!value)throw new Error('RELEASE_TEST_ADMIN_URL is required; release database tests must not be skipped');
const url=new URL(value);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Release tests require an isolated local PostgreSQL server');
const environment=Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(environment,{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock',RUNFENG_REPAIR_WRITEBACK_ENABLED:'false'});
const files=[];
for(const file of (await readdir('test')).sort()) {
  if(!file.endsWith('.test.mjs'))continue;
  const source=await readFile(`test/${file}`,'utf8');
  const names=[...source.matchAll(/process\.env\.([A-Z_]*TEST_(?:ADMIN_URL|DATABASE_URL))/g)].map(match=>match[1]);
  if(!names.length)continue;
  files.push(`test/${file}`);
  for(const name of names)environment[name]=value;
}
const admin=new pg.Client({connectionString:value,connectionTimeoutMillis:5000});
const name=`optimization_release_${randomUUID().replaceAll('-','')}`;
await admin.connect();
try {
  await admin.query(`create database "${name}"`);
  const isolated=new URL(value);isolated.pathname=`/${name}`;
  environment.COMPLETED_PROJECT_TEST_DATABASE_URL=isolated.toString();
  const output=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{env:environment,stdio:['ignore','pipe','pipe']});
    let text='';child.stdout.on('data',chunk=>{text+=chunk;process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
    child.on('error',reject);child.on('exit',code=>code===0?resolve(text):reject(new Error(`Release integration tests failed (${code})`)));
  });
  if(!/# skipped 0\s/.test(output))throw new Error('Release integration tests contained skipped cases');
  console.log(`Verified ${files.length} PostgreSQL suites; SQL Server and real notification sending remain disabled.`);
} finally {
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.end();
}
