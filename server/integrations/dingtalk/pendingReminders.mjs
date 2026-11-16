const escape=value=>String(value||'').replace(/[\\`*_{}\[\]<>#|\r\n]/g,' ');
export function pendingMessageBody(notification,recipient,env){
 const url=new URL(env.DISPATCH_APP_URL);url.search='';url.searchParams.set('personalTasks','true');
 const corp=env.DINGTALK_CORP_ID||env.VITE_DINGTALK_CORP_ID;if(corp)url.searchParams.set('corpid',corp);
 const lines=notification.payload.items.slice(0,8).map(i=>`- ${escape(i.kind)} · ${escape(i.title)}（${i.level===1?'升级提醒':i.level>=2?'每日汇总':'超时未处理'}） · 已等待 ${i.waitingMinutes} 个工作分钟${i.error?'：'+escape(i.error).slice(0,180):''}`);
 return {agent_id:Number(env.DINGTALK_AGENT_ID),userid_list:recipient,to_all_user:false,msg:{msgtype:'markdown',markdown:{title:'待办处理提醒',text:`### 待办处理提醒\n\n${lines.join('\n\n')}\n\n共 ${notification.payload.items.length} 项待处理，请及时查看。\n\n[打开我的事项](${url})`}}};
}
