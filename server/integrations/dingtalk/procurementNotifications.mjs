export function procurementMessageBody(notification,recipient,env=process.env) {
  const p=notification.payload,url=new URL(env.DISPATCH_APP_URL);
  url.search='';url.hash='';
  const corpId=env.DINGTALK_CORP_ID?.trim()||env.VITE_DINGTALK_CORP_ID?.trim();if(corpId)url.searchParams.set('corpid',corpId);
  if(p.tenderId)url.searchParams.set('procurementTender',p.tenderId);
  if(p.reportId)url.searchParams.set('procurementReport',p.reportId);
  const summary=String(p.summary||'').replace(/[\\`*_{}\[\]<>#|]/g,' ');
  const title=String(p.title||'配件竞价通知').replace(/[\\`*_{}\[\]<>#|]/g,' ');
  return {agent_id:Number(env.DINGTALK_AGENT_ID),userid_list:recipient,to_all_user:false,msg:{msgtype:'markdown',markdown:{title,text:`### ${title}\n\n${summary}\n\n本门店管理员与仓管可查看实时报价、邀请链接及报告。\n\n[打开竞价后台](${url.toString()})`}}};
}
