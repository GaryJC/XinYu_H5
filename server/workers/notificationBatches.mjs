import {createHash} from 'node:crypto';
import {claimNotificationGroup,sealNotificationBatch,finishNotificationBatch} from '../repositories/notificationBatchRepository.mjs';
import {messageBody,sendWorkNotification,notificationConfiguration} from '../integrations/dingtalk/notifications.mjs';

export async function deliverNotificationGroup(source,{prepare,finish,buildMessage=messageBody,env=process.env,claim=()=>claimNotificationGroup(source),seal=(members,hash)=>sealNotificationBatch(source,members,hash),complete=(id,members,result)=>finishNotificationBatch(source,id,members,result),send=sendWorkNotification}={}){
 const rows=await claim();if(!rows.length)return false;
 const mode=notificationConfiguration(env),groups=new Map(),started=Date.now();
 const buildEnv=mode==='mock'?{...env,DISPATCH_APP_URL:env.DISPATCH_APP_URL||'http://localhost',DINGTALK_AGENT_ID:env.DINGTALK_AGENT_ID||'1'}:env;
 for(const row of rows){
  let prepared;
  try{prepared=await prepare(row);}catch{prepared={result:{status:'failed',error:'发送前校验失败',retryable:true}};}
  if(prepared.result){await finish(row,prepared.result);continue;}
  const recipient=prepared.recipient;
  if(typeof recipient!=='string'||!recipient.trim()||recipient.includes(',')){await finish(row,{status:'failed',error:'员工未绑定有效钉钉账号',retryable:false});continue;}
  try{
   const body=buildMessage(prepared.notification,'',buildEnv),key=JSON.stringify(body);
   const group=groups.get(key)||{body,members:[]};group.members.push({row,notification:prepared.notification,recipient});groups.set(key,group);
  }catch{await finish(row,{status:'failed',error:'通知内容生成失败',retryable:false});}
 }
 for(const [key,group] of groups){
  // Do not let a slow validation wave approach the 90-second delivery lease.
  if(Date.now()-started>15000){for(const {row} of group.members)await finish(row,{status:'failed',error:'本轮校验耗时过长，稍后重试',retryable:true});continue;}
  const fresh=[];
  for(const member of group.members){
   let checked;
   try{checked=await prepare(member.row);}catch{checked={result:{status:'failed',error:'发送前复核失败',retryable:true}};}
   if(checked.result){await finish(member.row,checked.result);continue;}
   let unchanged=false;
   try{unchanged=checked.recipient===member.recipient&&JSON.stringify(buildMessage(checked.notification,'',buildEnv))===key;}catch{}
   if(!unchanged){await finish(member.row,{status:'failed',error:'通知内容或账号已变化，重新校验后发送',retryable:true});continue;}
   fresh.push({...member,notification:checked.notification});
  }
  if(!fresh.length)continue;
  group.members=fresh;
  if(Date.now()-started>15000){for(const {row} of fresh)await finish(row,{status:'failed',error:'本轮校验耗时过长，稍后重试',retryable:true});continue;}
  let id;
  try{id=await seal(group.members,createHash('sha256').update(key).digest('hex'));}
  catch{for(const {row} of group.members)await finish(row,{status:'failed',error:'发送前租约或人员状态变化，稍后重试',retryable:true});continue;}
  const recipients=[...new Set(group.members.map(m=>m.recipient))].join(',');
  const notification={...group.members[0].notification,delivery_batch_id:id};
  let result;
  try{result=await send(notification,recipients,{env,source,buildMessage:(_n,ids)=>({...group.body,userid_list:ids})});}
  catch{result={status:'unknown',error:'批次发送结果不确定，需核对平台记录'};}
  // A failed commit leaves the whole batch unknown; never retry the cloud call.
  await complete(id,group.members,result);
 }
 return true;
}
