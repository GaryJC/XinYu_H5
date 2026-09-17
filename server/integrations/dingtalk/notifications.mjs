import { getDingTalkAccessToken } from './accessToken.mjs';
export function notificationConfiguration(env=process.env) {
  const mode=env.DISPATCH_NOTIFICATION_MODE || 'disabled';
  if(!['disabled','mock','dingtalk'].includes(mode)) throw new Error('DISPATCH_NOTIFICATION_MODE 配置无效');
  if(mode==='mock' && env.APP_ENV!=='development' && env.APP_ENV!=='test') throw new Error('模拟通知仅允许开发和测试环境');
  if(mode==='dingtalk') {
    if(!env.DINGTALK_AGENT_ID || !env.DINGTALK_APP_KEY || !env.DINGTALK_APP_SECRET) throw new Error('钉钉工作通知配置不完整');
    if(!Number.isSafeInteger(Number(env.DINGTALK_AGENT_ID)) || Number(env.DINGTALK_AGENT_ID)<=0) throw new Error('DINGTALK_AGENT_ID 必须是有效应用编号');
    const url=new URL(env.DISPATCH_APP_URL || '');
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('DISPATCH_APP_URL 必须是不含凭据的 HTTP 或 HTTPS 应用地址');
  }
  return mode;
}
export function messageBody(notification, recipient, env=process.env) {
  const data=notification.payload;
  const url=new URL(env.DISPATCH_APP_URL);
  url.searchParams.set('dispatchOrder',data.orderId);
  const due=data.dueAt?new Date(data.dueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未设置';
  const escape=value=>String(value||'').replace(/[\\`*_{}\[\]<>#|]/g,' ');
  return {agent_id:Number(env.DINGTALK_AGENT_ID),userid_list:recipient,to_all_user:false,
    msg:{msgtype:'markdown',markdown:{title:`${notification.kind} · ${data.plate}`,
      text:`### ${escape(notification.kind)} · ${escape(data.plate)}\n\n${escape(data.dispatchNo || data.orderId)}\n\n${escape(data.summary)}\n\n预计完工：${due}${data.reason?`\n\n${escape(data.reason)}`:''}\n\n[查看维修任务](${url.toString()})`}}};
}
export async function sendWorkNotification(notification, recipient, {env=process.env,fetcher=fetch,token=getDingTalkAccessToken}={}) {
  const mode=notificationConfiguration(env);
  if(mode==='mock') return {status:'accepted',taskId:`mock-${notification.id}`};
  if(mode!=='dingtalk') return {status:'failed',error:'通知发送尚未启用',retryable:false};
  if(!recipient) return {status:'failed',error:'员工未绑定钉钉账号，请先登录应用',retryable:false};
  let accessToken;
  try { accessToken=await token(); } catch { return {status:'failed',error:'获取钉钉凭据失败',retryable:true}; }
  try {
    const url=new URL('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2');
    url.searchParams.set('access_token',accessToken);
    const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(messageBody(notification,recipient,env)),signal:AbortSignal.timeout(10000)});
    const payload=await response.json().catch(()=>null);
    if(response.status===429) return {status:'failed',error:'钉钉限流',retryable:true};
    if(!response.ok || !payload || payload.errcode===undefined) return {status:'unknown',error:'钉钉返回结果不确定，请核对平台记录'};
    if(payload.errcode) return {status:'failed',error:`钉钉错误 ${payload.errcode}：${payload.errmsg || '发送失败'}`,retryable:[88,90018].includes(Number(payload.errcode))};
    if(!payload.task_id) return {status:'unknown',error:'钉钉未返回任务编号'};
    return {status:'accepted',taskId:String(payload.task_id)};
  } catch { return {status:'unknown',error:'发送请求超时或连接中断，可能已发送，不自动重发'}; }
}
export async function queryWorkNotification(notification, recipient, {env=process.env,fetcher=fetch,token=getDingTalkAccessToken}={}) {
  if(notification.task_id?.startsWith('mock-')) {
    return env.DISPATCH_NOTIFICATION_MODE==='mock' && ['development','test'].includes(env.APP_ENV)
      ? {status:'sent'} : {status:'unknown',error:'模拟任务不能作为生产发送结果'};
  }
  if(!notification.task_id) return {status:'unknown',error:'缺少平台任务编号，需人工核对'};
  try {
    const url=new URL('https://oapi.dingtalk.com/topapi/message/corpconversation/getsendresult');
    url.searchParams.set('access_token',await token());
    const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent_id:Number(env.DINGTALK_AGENT_ID),task_id:notification.task_id}),signal:AbortSignal.timeout(10000)});
    const payload=await response.json().catch(()=>null);
    if(!response.ok || !payload || payload.errcode || !payload.send_result) return {status:'unknown',error:'暂时无法查询发送结果'};
    const result=payload.send_result;
    const includes=(list,id)=>Array.isArray(list)?list.map(String).includes(String(id)):String(list||'').split(',').includes(String(id));
    if(includes(result.read_user_id_list,recipient) || includes(result.unread_user_id_list,recipient)) return {status:'sent'};
    if(['failed_user_id_list','invalid_user_id_list','forbidden_user_id_list'].some(key=>includes(result[key],recipient))) return {status:'failed',error:'钉钉明确返回收件人发送失败',retryable:false};
    return {status:'accepted',error:'等待钉钉发送结果'};
  } catch { return {status:'unknown',error:'发送结果查询超时，将继续查询'}; }
}
