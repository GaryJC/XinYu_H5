import {notificationSource} from './notificationQueryRepository.mjs';
export async function startNotificationTrace(database,{id,operation,source,notificationId,kind}) {
 const {table}=notificationSource(source);
 const join=source==='dispatch'?'join work_orders r on r.id=n.order_id':source==='vehicle-trip'?'join vehicle_trip_notification_jobs j on j.id=n.job_id join vehicle_trip_requests r on r.id=j.trip_id':source==='license-exception'?'join vehicle_license_exceptions e on e.id=n.exception_id join work_orders r on r.id=e.order_id':source==='vehicle-insurance'?'join company_vehicles r on r.id=n.vehicle_id':'';
 const shop=source==='procurement'?'n.shop_id':'r.shop_id';
 const resource=source==='procurement'?'coalesce(n.tender_id,n.report_id)::text':'r.id::text';
 const event=source==='dispatch'?"coalesce(n.event_id::text,n.id::text)":source==='procurement'?"coalesce(n.payload->>'notificationBatchId',n.id::text)":source==='vehicle-trip'?'n.job_id':source==='license-exception'?'n.exception_id::text':"n.vehicle_id||':'||n.insurance_end::text||':'||n.milestone::text";
 const result=await database.query({text:`with epoch as (insert into notification_tracking_epoch(id) values(true) on conflict do nothing)
 insert into notification_call_traces(id,operation,source,notification_id,shop_id,resource_id,event_key,recipient_id,recipient_name,kind)
 select $1,$2,$3,n.id::text,${shop},${resource},${event},n.recipient_id,u.name,$5 from ${table} n ${join} join users u on u.id=n.recipient_id where n.id=$4 returning id`,values:[id,operation,source,notificationId,kind],query_timeout:500});
 if(!result.rowCount)throw new Error('notification trace context missing');
}
export async function finishNotificationTrace(database,id,{outcome,httpStatus,apiCode,durationMs,taskId}) {
 await database.query({text:'update notification_call_traces set outcome=$2,http_status=$3,api_code=$4,duration_ms=$5,platform_task_id=$6 where id=$1',values:[id,outcome,httpStatus??null,apiCode??null,durationMs,taskId??null],query_timeout:500});
}
export async function readNotificationUsage(database,shopId,date,page) {
 const params=[shopId,date];
 const epoch=(await database.query('select started_at from notification_tracking_epoch where id=true')).rows[0]?.started_at;
 const daily=(await database.query(`with days as(select generate_series($2::date-6,$2::date,'1 day')::date as usage_day)
 select usage_day::text as date,count(n.id)::int total,count(n.id) filter(where operation='send')::int sends,
 count(n.id) filter(where operation='query')::int queries,count(n.id) filter(where outcome='started')::int unresolved
 from days left join notification_call_traces n on n.shop_id=$1 and n.started_at>=usage_day::timestamp at time zone 'Asia/Shanghai' and n.started_at<(usage_day+1)::timestamp at time zone 'Asia/Shanghai'
 group by usage_day order by usage_day`,params)).rows;
 const where="where shop_id=$1 and started_at >= $2::date::timestamp at time zone 'Asia/Shanghai' and started_at<($2::date+1)::timestamp at time zone 'Asia/Shanghai'";
 const groups=(await database.query(`select kind,count(*)::int total,count(*) filter(where operation='send')::int sends,count(*) filter(where operation='query')::int queries from notification_call_traces ${where} group by kind order by total desc,kind`,params)).rows;
 const recipients=(await database.query(`select recipient_id as id,recipient_name as name,count(*)::int total from notification_call_traces ${where} group by recipient_id,recipient_name order by total desc,recipient_id`,params)).rows;
 const rows=(await database.query(`select id,started_at as "startedAt",operation,source,notification_id as "notificationId",resource_id as "resourceId",event_key as "eventKey",recipient_name as "recipientName",kind,outcome,http_status as "httpStatus",api_code as "apiCode",duration_ms as "durationMs",platform_task_id as "platformTaskId" from notification_call_traces ${where} order by started_at desc,id desc limit 50 offset $3`,[...params,(page-1)*50])).rows;
 return {trackingSince:epoch||null,daily,groups,recipients,rows};
}
