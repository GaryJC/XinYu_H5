import {requireAnyRole} from '../domain/accessPolicy.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {readBusinessAnalyticsOrders} from '../repositories/businessAnalyticsRepository.mjs';
import {buildBusinessAnalytics} from '../domain/businessAnalytics.mjs';
export async function businessAnalytics(actor,days=30){
  requireAnyRole(actor,['manager']);
  if(![7,30,90,180,365].includes(days))throw new HttpError(400,'请选择支持的统计周期');
  return buildBusinessAnalytics(await readBusinessAnalyticsOrders(actor),{days});
}
