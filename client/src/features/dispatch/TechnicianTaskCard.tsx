import { isReworkTask } from '../../../../shared/repairProgress.mjs';
import { Card, Tag } from 'antd';
import { Clock3, Package } from 'lucide-react';
import type { DispatchTask } from '../../../../shared/types';
import { individualRepair, personalTask } from './individualRepair';
import { partsStatus } from './partsProgress';
import { displayTaskTime } from './dispatchLabels';
import { technicianTaskStatus } from './technicianTaskStatus';
import { RepairStatusTag } from './RepairStatusTag';

export function TechnicianTaskCard({ task, userId, onOpen }: { task: DispatchTask; userId: string; onOpen: () => void }) {
  const own = personalTask(task, userId);
  const submitted = own.items.filter(item => ['待检验', '已完工'].includes(item.status)).length;
  const individual = individualRepair(task);
  return <Card className="technician-task-card" role="button" tabIndex={0}
    aria-label={`查看维修任务 ${task.plate || task.dispatchNo || task.orderId}`}
    onClick={onOpen}
    onKeyDown={event => {
      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onOpen();
      }
    }}>
    <div className="technician-card-heading"><h3>{task.plate || '未填写车牌'}</h3><RepairStatusTag status={technicianTaskStatus(task,userId)} /></div>
    <p className="technician-card-reference"><span>{task.dispatchNo ? '派工号' : '委托单号'}</span>{task.dispatchNo ? <strong className="technician-card-dispatch-number">{task.dispatchNo}</strong> : task.orderId}</p>
    <div className="technician-flags">
      {task.urgent ? <Tag color="red">加急</Tag> : null}
      {task.overdue ? <Tag color="red">超期</Tag> : null}
      {task.repairRound ? <Tag color="orange">{task.roundKind === 'additional' ? '追加维修第' : '返工第'} {task.repairRound} 轮</Tag> : null}
      {isReworkTask(task,userId) && (!task.repairRound || task.roundKind==='additional') ? <Tag color="orange">返工</Tag> : null}
    </div>
    <div className="technician-card-projects">
      <div><span>{individual ? '本人负责项目' : '维修项目'}</span><span>{own.items.length} 项</span></div>
      {own.items.length ? <ul>{own.items.map(item => <li key={item.id}>{item.name}</li>)}</ul> : <p>暂无本人维修项目</p>}
    </div>
    <div className="technician-card-meta">
      {['待开工', '维修中', '暂停', '回审'].includes(own.stage) ? <div><Package size={15} aria-hidden="true" /><span>配件</span><strong>{own.partsRequirement ? partsStatus(own.partsRequirement) : '未登记需求'}</strong></div> : null}
      <div><Clock3 size={15} aria-hidden="true" /><span>预计完工</span><strong>{displayTaskTime(task.dueAt)}</strong></div>
    </div>
    <div className="technician-card-footer">
      <div><span>已提报或通过</span><strong>{submitted}<small> / {own.items.length}</small></strong></div>
    </div>
  </Card>;
}
