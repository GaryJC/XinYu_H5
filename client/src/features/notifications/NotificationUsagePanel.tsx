import {RefreshButton} from '../../shared/ui/RefreshButton';
import {Alert,Button,Spin} from 'antd';
import {CopyTextButton} from '../../shared/ui/CopyTextButton';
import {useNotificationUsage} from './useNotificationUsage';
import './notification-usage.css';
const outcomes:Record<string,string>={started:'中断待确认',ok:'调用成功',rejected:'接口拒绝','transport-unknown':'网络结果未知','response-unknown':'响应无法确认'};
export function NotificationUsagePanel(){
 const c=useNotificationUsage(),d=c.data,selected=d?.daily.find(day=>day.date===c.date);
 return <details className="notification-usage" open={c.open} onToggle={e=>{if(e.currentTarget.open!==c.open)c.setOpen(e.currentTarget.open);}}>
  <summary>钉钉通知用量 · 日均目标 300 次</summary>
  {c.open&&<div className="notification-usage-body">
   <div className="notification-usage-controls"><label>查看日期<input aria-label="通知用量日期" type="date" value={c.date} onChange={e=>{if(e.target.value)c.setDate(e.target.value);}}/></label><RefreshButton disabled={c.loading} onClick={c.refresh} label="刷新"/></div>
   {c.error&&<Alert showIcon type="error" title={c.error} action={<Button onClick={c.refresh}>重试</Button>}/>}
   {c.loading&&<Spin/>}
   {d&&<>
    <div className="notification-usage-numbers"><div><span>所选日调用尝试</span><strong>{selected?.coverage==='none'?'—':selected?.total||0}<small> / {d.budget}</small></strong><p>发送 {selected?.sends||0} · 查询 {selected?.queries||0}</p></div><div><span>近 7 日完整日均</span><strong>{d.average??'—'}</strong><p>{d.completeDays?`${d.completeDays} 个完整日期`:'等待完整日期数据'}</p></div></div>
    {(selected?.total||0)>=d.budget&&<Alert type="warning" showIcon title="已达到每日参考预算，必要通知仍会发送"/>}
    <p className="notification-usage-note">启用时间：{d.trackingSince?new Date(d.trackingSince).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未启用'}。仅统计本店、本应用的工作通知发送和结果查询，不含其他应用；中断记录可能尚未到达钉钉，实际计费以钉钉后台为准。无历史回填，预算不会自动停发。</p>
    <div className="notification-usage-scroll"><table><thead><tr><th>日期</th><th>发送</th><th>查询</th><th>合计</th><th>中断待确认</th></tr></thead><tbody>{d.daily.map(day=><tr key={day.date}><th>{day.date}{day.coverage==='none'?'（未启用）':day.coverage==='partial'?'（部分）':''}</th><td>{day.coverage==='none'?'—':day.sends}</td><td>{day.coverage==='none'?'—':day.queries}</td><td>{day.coverage==='none'?'—':day.total}</td><td>{day.coverage==='none'?'—':day.unresolved}</td></tr>)}</tbody></table></div>
    <div className="notification-usage-breakdown"><section><h4>按通知类型</h4>{d.groups.map(g=><p key={g.kind}><span>{g.kind}</span><strong>{g.total}<small>（发 {g.sends} / 查 {g.queries}）</small></strong></p>)}</section><section><h4>按收件人关联调用</h4>{d.recipients.map(r=><p key={r.id+r.name}><span>{r.name}</span><strong>{r.total}</strong></p>)}</section></div>
    <h4>调用明细</h4>
    {!d.rows.length&&<p>该日期暂无已记录调用。</p>}
    {d.rows.map(row=><article className="notification-usage-record" key={row.id}><div><strong>{row.kind} · {row.operation==='send'?'发送':'查询'}</strong><span>{row.recipientName}</span></div><p>{new Date(row.startedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · {outcomes[row.outcome]||row.outcome}</p><p>业务编号：{row.resourceId}</p>{row.batchId&&<p>发送批次：{row.batchId} · {row.recipientCount} 人</p>}<p>追踪编号：{row.id}<CopyTextButton text={row.id} label="复制调用追踪编号"/></p><p>事件编号：{row.eventKey}</p><p>通知编号：{row.notificationId}</p><p>HTTP {row.httpStatus??'—'} · 接口码 {row.apiCode??'—'} · {row.durationMs??'—'} ms</p>{row.platformTaskId&&<p>平台任务：{row.platformTaskId}</p>}</article>)}
    <div className="notification-usage-controls"><Button disabled={c.page<=1} onClick={()=>c.setPage(c.page-1)}>上一页</Button><span>第 {c.page} 页</span><Button disabled={c.page*d.pageSize>=(selected?.total||0)} onClick={()=>c.setPage(c.page+1)}>下一页</Button></div>
   </>}
  </div>}
 </details>;
}
