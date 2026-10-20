export function licenseExceptionMessageBody(notification,recipient,env=process.env) {
  const p=notification.payload,url=new URL(env.DISPATCH_APP_URL);
  const corpId=env.DINGTALK_CORP_ID?.trim()||env.VITE_DINGTALK_CORP_ID?.trim();
  if(corpId)url.searchParams.set('corpid',corpId);
  url.searchParams.delete('dispatchOrder');url.searchParams.set('workOrder',p.orderId);
  const escape=value=>String(value||'未填写').replace(/[\\`*_{}\[\]<>#|]/g,' ');
  return {agent_id:Number(env.DINGTALK_AGENT_ID),userid_list:recipient,to_all_user:false,msg:{msgtype:'markdown',markdown:{
    title:`行驶证缺失备案 · ${p.plate}`,
    text:`### 新车未提供行驶证\n\n说明：${escape(p.reason)}\n\n车牌：${escape(p.plate)}\n\nVIN：${escape(p.vin)}\n\n门店：${escape(p.shopName)}\n\n委托单：${escape(p.orderId)}\n\n车主／所属单位：${escape(p.customerName)}\n\n服务顾问：${escape(p.advisor)}\n\n备案人：${escape(p.reportedName)}\n\n本次委托单已备案跳过上传，其他必填规则不变。\n\n[查看委托单详情](${url.toString()})`
  }}};
}
