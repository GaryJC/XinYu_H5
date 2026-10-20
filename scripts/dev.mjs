import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectApiPort } from './devPorts.mjs';

const requestedApiPort=process.env.API_PORT||'8787';
const viteHost=process.env.VITE_HOST||'0.0.0.0';
const vitePort=process.env.VITE_PORT||'5173';
const startLocalApi=process.env.START_LOCAL_API!=='false';
const apiPort=startLocalApi?await selectApiPort(requestedApiPort):requestedApiPort;
if(startLocalApi&&apiPort!==requestedApiPort)console.warn(`开发 API 端口 ${requestedApiPort} 已被占用，改用 ${apiPort}；未停止其他服务。`);
process.env.API_PORT=apiPort;
if(startLocalApi) {
  process.env.API_PROXY_TARGET=`http://localhost:${apiPort}`;
  process.env.APP_ENV='development';
  process.env.ENABLE_DEV_AUTH='true';
  process.env.JWT_SECRET||='repair-h5-local-development-only-secret';
} else process.env.API_PROXY_TARGET||=`http://localhost:${apiPort}`;
console.log(startLocalApi?`Development API: local ${process.env.API_PROXY_TARGET}`:`Development API: remote ${process.env.API_PROXY_TARGET}`);

const commands=[['../node_modules/vite/bin/vite.js',['--host',viteHost,'--port',vitePort]]];
if(startLocalApi)commands.unshift(['../server/server.mjs',[]]);
const children=[];
let stopping=false;
function shutdown(code=0) {
  if(stopping)return;stopping=true;process.exitCode=code;
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  const timer=setTimeout(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},5000);
  timer.unref();
}
for(const [entry,args] of commands) {
  const child=spawn(process.execPath,[...(entry==='../server/server.mjs'?['--watch']:[]),fileURLToPath(new URL(entry,import.meta.url)),...args],{stdio:'inherit'});
  children.push(child);
  child.on('error',error=>{console.error(`开发进程启动失败：${error.message}`);shutdown(1);});
  child.on('exit',(code,signal)=>{if(!stopping)shutdown(code||(!signal?0:1));});
}
process.on('SIGINT',()=>shutdown());
process.on('SIGTERM',()=>shutdown());
