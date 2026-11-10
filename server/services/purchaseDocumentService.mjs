import { Worker } from 'node:worker_threads';
import { requireAnyRole } from '../domain/accessPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { defaultRules,templateNames } from './purchaseDocuments/rules.mjs';
let running=0;
const activeUsers=new Set();
export function purchaseDocumentAccess(user){requireAnyRole(user,['advisor','manager']);if(!user.active||!user.shopId||!user.id)throw new HttpError(403,'账号已停用或未分配门店');}
export function purchaseDocumentConfig(user){purchaseDocumentAccess(user);return {defaults:defaultRules,templates:templateNames,maxUploadBytes:8*1024*1024};}
export async function processPurchaseDocuments(user,input,action){
 purchaseDocumentAccess(user);
 if(!['preview','generate'].includes(action))throw new HttpError(404,'接口不存在');
 if(running>=2||activeUsers.has(user.id))throw new HttpError(429,'文件正在处理中，请稍后重试');
 if(!Array.isArray(input.files))throw new HttpError(400,'请上传明细文件');
 running++;activeUsers.add(user.id);
 try{return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./purchaseDocuments/worker.mjs',import.meta.url),{workerData:{files:input.files,rules:input.rules,shopId:user.shopId,action},resourceLimits:{maxOldGenerationSizeMb:384}});
  let settled=false;
  const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();err?reject(err):resolve(value);};
  const timer=setTimeout(()=>finish(new HttpError(408,'处理超时，请减少文件数量后重试')),90000);
  worker.once('message',result=>finish(result.error?new HttpError(400,result.error):null,result));
  worker.once('error',()=>finish(new HttpError(400,'无法处理文件，请检查格式或减少文件数量')));
  worker.once('exit',()=>{if(!settled)finish(new HttpError(400,'文件处理已中断，请分批重试'));});
 });}finally{running--;activeUsers.delete(user.id);}
}
