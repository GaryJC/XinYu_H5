import {pool} from '../database/pool.mjs';
import {notificationConfiguration,sendWorkNotification} from '../integrations/dingtalk/notifications.mjs';
import {syncManagerRoster} from '../integrations/dingtalk/managerRoster.mjs';
import {insuranceMessageBody} from '../integrations/dingtalk/vehicleInsuranceNotifications.mjs';
import {dueInsurance,queueInsurance,claimInsurance,insuranceContext,finishInsurance} from '../repositories/vehicleInsuranceRepository.mjs';
import {hasAnyRole} from '../../shared/roles.mjs';
import {insuranceReminder} from '../../shared/vehicleInsurance.mjs';
export async function queueInsuranceReminders({database=pool,sync=syncManagerRoster,env=process.env}={}){
 const cars=await dueInsurance(database),shops=new Map();
 for(const car of cars){if(!shops.has(car.shop_id))shops.set(car.shop_id,notificationConfiguration(env)==='dingtalk'?await sync(car.shop_id,{roleKeys:['manager','advisor']}):undefined);await queueInsurance(database,car,shops.get(car.shop_id));}
}
export async function deliverInsuranceReminder({database=pool,send=sendWorkNotification,env=process.env}={}){
 const row=await claimInsurance(database);if(!row)return false;let result,deliveryUserId,started=false;
 try{const c=await insuranceContext(database,row);
 if(row.previous_status!=='pending')result={status:row.previous_status,error:row.error||''};
 else if(!c?.active||!c.vehicle_active||c.shop_id!==c.vehicle_shop||!hasAnyRole(c,['manager','advisor'])||c.end_date!==row.end_date||insuranceReminder(c.end_date)!==row.milestone)result={status:'failed',error:'保险或收件人状态已变化，取消过时通知'};
 else {started=true;deliveryUserId=c.dingtalk_user_id;result=await send({...row,payload:c},c.dingtalk_user_id,{env,buildMessage:insuranceMessageBody,source:'vehicle-insurance'});}
 }catch{result=started||row.previous_status!=='pending'?{status:'unknown',error:'发送结果不确定，请核对通知记录'}:{status:'failed',error:'发送前校验失败，将重试',retryable:true};}
 if(started && deliveryUserId) result={...result,deliveryUserId};
 await finishInsurance(database,row,result);return true;
}
export function startVehicleInsuranceNotifications(){
 if(notificationConfiguration()==='disabled')return async()=>{};
 let running,stopped=false,lastScan=0;
 const tick=()=>{if(running||stopped)return;running=(async()=>{if(Date.now()-lastScan>=3600000){await queueInsuranceReminders();lastScan=Date.now();}for(let i=0;i<10&&!stopped;i++)if(!await deliverInsuranceReminder())break;})().catch(e=>console.error('保险提醒：',e.message)).finally(()=>{running=undefined;});};
 const timer=setInterval(tick,60000);timer.unref();tick();return async()=>{stopped=true;clearInterval(timer);await running;};
}
