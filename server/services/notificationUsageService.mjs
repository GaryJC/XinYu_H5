import {pool} from '../database/pool.mjs';
import {hasRole} from '../../shared/roles.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {currentNotificationActor} from '../repositories/notificationQueryRepository.mjs';
import {readNotificationUsage} from '../repositories/notificationUsageRepository.mjs';
export const chinaDate=(now=Date.now())=>new Date(Number(now)+8*3600000).toISOString().slice(0,10);
export async function notificationUsage(user,query,{database=pool,now=Date.now()}={}) {
 const actor=await currentNotificationActor(user?.id,database);
 if(!actor?.active||!hasRole(actor,'manager')||!actor.shopId||actor.shopId!==user.shopId)throw new HttpError(403,'仅本店管理员可查看调用记录');
 const today=chinaDate(now),date=query.get('date')||today,page=Number(query.get('page')||1);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today)throw new HttpError(400,'请选择有效日期');
 if(!Number.isSafeInteger(page)||page<1||page>10000)throw new HttpError(400,'页码无效');
 const data=await readNotificationUsage(database,actor.shopId,date,page);
 const first=data.trackingSince?chinaDate(new Date(data.trackingSince).getTime()):today;
 const complete=data.daily.filter(d=>d.date>first&&d.date<today);
 return {...data,daily:data.daily.map(day=>({...day,coverage:day.date<first?'none':day.date===first||day.date===today?'partial':'full'})),date,page,pageSize:50,budget:300,completeDays:complete.length,average:complete.length?Math.round(complete.reduce((n,d)=>n+d.total,0)/complete.length*10)/10:null};
}
