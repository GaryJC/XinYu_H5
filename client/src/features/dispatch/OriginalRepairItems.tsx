import type {DispatchDetail} from '../../../../shared/types';
import {Tag} from 'antd';

export function OriginalRepairItems({detail}:{detail:DispatchDetail}) {
  if(!detail.task.repairRound)return null;
  const original=detail.repairRounds?.find(round=>round.round===0)?.task;
  if(!original)return null;
  return <section aria-label="原主要作业与项目">
    <h3>原主要作业与项目</h3>
    <ol className="repair-item-list">{original.items.map((item,index)=><li key={item.id} className="repair-item-row">
      <div className="repair-item-leading"><span className="repair-item-number">{String(index+1).padStart(2,'0')}</span></div>
      <div className="repair-item-content"><div className="repair-item-title">{item.name}</div>
        <div className="repair-item-owner">负责人：{item.responsibleName||original.technicianName||'未记录'}</div>
        <Tag>{item.status}</Tag>
      </div>
    </li>)}</ol>
  </section>;
}
