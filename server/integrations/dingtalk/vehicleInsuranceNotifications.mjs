export function insuranceMessageBody(notification,recipient,env=process.env){
 const p=notification.payload,escape=v=>String(v||'').replace(/[\\`*_{}\[\]<>#|\r\n]/g,' ');
 const title=notification.milestone<0?'车辆保险已到期，请续保':notification.milestone===0?'车辆保险今日到期，请续保':'车辆保险即将到期，请续保';
 const url=new URL(env.DISPATCH_APP_URL);url.search='';const corp=env.DINGTALK_CORP_ID||env.VITE_DINGTALK_CORP_ID;if(corp)url.searchParams.set('corpid',corp);
 return {agent_id:Number(env.DINGTALK_AGENT_ID),userid_list:recipient,to_all_user:false,msg:{msgtype:'markdown',markdown:{title:`${title} · ${escape(p.plate)}`,text:`### ${title}\n\n车辆：${escape(p.plate)}\n\n保险到期日：${escape(p.end_date)}\n\n请续保后在车辆管理中更新保险记录。保险过期车辆不能出车。\n\n[打开车辆管理应用](${url})`}}};
}
