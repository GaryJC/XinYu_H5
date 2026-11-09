import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,get} from 'node:http';
import {drainServer} from '../server/http/drainServer.mjs';
test('real HTTP shutdown drains a slow response before closing pools and permits restart',{skip:process.env.DEPLOYMENT_PM2_TEST!=='true',timeout:10000},async()=>{
 let started,finish;const ready=new Promise(resolve=>started=resolve);let poolsClosed=false,stopped=false;
 const server=createServer((_req,res)=>{res.writeHead(200);res.write('before-');finish=()=>res.end('after');started();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const request=new Promise((resolve,reject)=>{get(`http://127.0.0.1:${port}`,{agent:false},res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve(body));}).on('error',reject);});
 try {
  await ready;const draining=drainServer(server,[()=>{stopped=true;}],[()=>{poolsClosed=true;}]);
  assert.equal(stopped,true);assert.equal(poolsClosed,false);
  finish();assert.equal(await request,'before-after');await draining;assert.equal(poolsClosed,true);
  const restarted=createServer((_req,res)=>res.end('healthy'));
  try {await new Promise(resolve=>restarted.listen(port,'127.0.0.1',resolve));assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'healthy');}
  finally {restarted.closeAllConnections();await new Promise(resolve=>restarted.close(resolve));}
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
