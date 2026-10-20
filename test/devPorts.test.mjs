import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { selectApiPort } from '../scripts/devPorts.mjs';
test('dev port selection preserves existing services and selects an available port',{skip:process.env.DEV_PORTS_SOCKET_TEST!=='true'},async()=>{
  const existing=createServer();await new Promise(resolve=>existing.listen(0,'0.0.0.0',resolve));
  try {
    const occupied=existing.address().port;
    const selected=await selectApiPort(String(occupied));
    assert.notEqual(Number(selected),occupied);assert.ok(existing.listening);
    await assert.rejects(()=>selectApiPort(String(occupied),{attempts:1}),/均被占用/);
  }finally{await new Promise(resolve=>existing.close(resolve));}
});
test('dev port validation rejects invalid port settings',async()=>{
  for(const value of ['0','65536','not-a-port','8787.5'])await assert.rejects(()=>selectApiPort(value),/API_PORT/);
});
