import { createServer } from 'node:net';
export async function selectApiPort(value,{host='0.0.0.0',attempts=30}={}) {
  const initial=Number(value);
  if(!Number.isInteger(initial)||initial<1||initial>65535)throw new Error('API_PORT 必须是有效端口');
  for(let port=initial;port<=Math.min(65535,initial+attempts-1);port++) {
    const available=await new Promise((resolve,reject)=>{
      const server=createServer();server.unref();
      server.once('error',error=>{if(error.code==='EADDRINUSE')resolve(false);else reject(error);});
      server.listen(port,host,()=>server.close(()=>resolve(true)));
    });
    if(available)return String(port);
  }
  throw new Error(`从 ${initial} 开始的 ${attempts} 个开发 API 端口均被占用，请设置 API_PORT`);
}
