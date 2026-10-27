import { PartsRequirementSummary } from './PartsRequirementSummary';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { Collapse, Descriptions, Image, Tag } from 'antd';
import type { DispatchDetail } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
export function RepairRoundHistory({detail}:{detail:DispatchDetail}) {
  const rounds=detail.repairRounds||[];
  if(!rounds.length)return null;
  return <section aria-label="历次维修记录"><h3>历次维修记录</h3><Collapse items={rounds.map(round=>({key:String(round.round),label:<span>{round.round?`${round.task.roundKind==='additional'?'追加维修第':'返工第'} ${round.round} 轮`:'原始维修记录'} · {round.closed?'已结束':'处理中'}</span>,children:<>
    <Descriptions column={1} size="small" items={[
      {key:'reason',label:round.task.roundKind==='additional'?'追加维修原因':'返工原因',children:round.reason||'原维修'},
      {key:'actor',label:'发起记录',children:round.round?`${round.openedName} · ${displayTime(round.openedAt)}`:'沿用原维修记录'},
      {key:'worker',label:'维修人员',children:round.task.technicianName||'未记录'},
      {key:'due',label:'预计完工',children:displayTime(round.task.dueAt)},
      {key:'start',label:'开工',children:displayTime(round.task.firstStartedAt)},
      {key:'submit',label:'提交检验',children:displayTime(round.task.submittedAt)},
      {key:'end',label:'维修完成',children:displayTime(round.completedAt)},
      {key:'hours',label:round.round?'本轮实际工时':'实际工时',children:round.task.workHours===undefined?'未记录':`${round.task.workHours} 小时`}
    ]}/>
    <PartsRequirementSummary value={round.task.partsRequirement}/>
    <ul className="repair-round-items">{round.task.items.map(item=><li key={item.id}><div><strong>{item.name}</strong> <Tag>{item.status}</Tag></div><small>开工：{displayTime(item.startAt)} · 提检：{displayTime(item.finishAt)}<br/>检验：{item.inspectorName||'未记录'} · {displayTime(item.inspectedAt)}</small></li>)}</ul>
    <Image.PreviewGroup><div className="repair-photo-grid">{detail.files.filter(f=>['repair_progress_photo','repair_completed_photo'].includes(f.kind)&&(f.repairRound||0)===round.round).map(f=><div key={f.id}><AuthenticatedImage fileId={f.id} alt={`${round.round?`${round.task.roundKind==='additional'?'追加维修第':'返工第'} ${round.round} 轮`:'原维修'}照片`} width="100%" height={100}/><small>{f.uploadedName||'维修人员'} · {displayTime(f.createdAt)}</small></div>)}</div></Image.PreviewGroup>
    {detail.events.filter(e=>(e.detail.repairRound||0)===round.round).map(e=><p key={e.id} className="dispatch-muted">{displayTime(e.at)} · {e.actorName} · {e.detail.stage}{e.detail.reason?` · ${e.detail.reason}`:''}{e.detail.previousTechnicianName&&e.detail.previousTechnicianName!==e.detail.technicianName?` · ${e.detail.previousTechnicianName} → ${e.detail.technicianName||'待派工'}`:''}</p>)}
  </>}))}/></section>;
}
