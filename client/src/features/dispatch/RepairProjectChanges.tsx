import type {DispatchEvent} from '../../../../shared/types';

export function RepairProjectChanges({event}:{event:DispatchEvent}) {
  if(!event.detail.previousItems||!event.detail.items)return null;
  const changes=event.detail.items.filter(item=>{
    const before=event.detail.previousItems!.find(previous=>previous.id===item.id);
    return !before||before.name!==item.name||before.responsibleId!==item.responsibleId;
  });
  const removed=event.detail.previousItems.filter(item=>!event.detail.items!.some(current=>current.id===item.id));
  return <>{removed.map(item=><p key={`removed-${item.id}`}>删除：{item.name} · 原负责人：{item.responsibleName||'待指定'}</p>)}{changes.map(item=>{
    const before=event.detail.previousItems!.find(previous=>previous.id===item.id);
    return <p key={item.id}>{before?before.name===item.name?item.name:`${before.name} → ${item.name}`:`新增：${item.name}`} · 负责人：{before?.responsibleName||'待指定'} → {item.responsibleName||'待指定'}</p>;
  })}</>;
}
