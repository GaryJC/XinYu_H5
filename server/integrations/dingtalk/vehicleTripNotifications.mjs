import {tripNotificationKinds} from '../../domain/vehicleTripNotifications.mjs';
export function vehicleTripMessageBody(notification,recipient,env=process.env) {
  const p=notification.payload,url=new URL(env.DISPATCH_APP_URL);
  for(const key of ['dispatchOrder','workOrder','paperOrder','procurementTender','procurementReport'])url.searchParams.delete(key);
  const corpId=env.DINGTALK_CORP_ID?.trim()||env.VITE_DINGTALK_CORP_ID?.trim();
  if(corpId)url.searchParams.set('corpid',corpId);
  url.searchParams.set('vehicleTrip',p.id);
  const escape=value=>String(value||'').replace(/[\\`*_{}\[\]<>#|\r\n]/g,' ');
  const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'';
  const kind=tripNotificationKinds[notification.action];
  const details=[`申请人：${escape(p.applicantName)}`,`车辆：${escape(p.vehicle.plate)} · ${escape(p.vehicle.brand)} ${escape(p.vehicle.model)}`,
    `用车事由：${escape(p.reason)}`,`状态：${escape(p.status)}`,`操作人：${escape(p.actorName)}`];
  if(notification.action==='create')details.push('请进入申请详情审批。');
  if(notification.action==='approve')details.push('申请已批准，请上传公里数照片后确认出车。');
  if(notification.action==='reject')details.push(`驳回原因：${escape(p.rejectionReason)}`);
  if(notification.action==='depart')details.push(`出车时间：${time(p.departureAt)}`);
  if(notification.action==='return')details.push(`还车时间：${time(p.returnAt)}`);
  return {agent_id:Number(env.DINGTALK_AGENT_ID),userid_list:recipient,to_all_user:false,msg:{msgtype:'markdown',markdown:{
    title:`${kind} · ${escape(p.vehicle.plate)}`,text:`### ${kind}\n\n${details.join('\n\n')}\n\n[查看出车申请](${url.toString()})`
  }}};
}
