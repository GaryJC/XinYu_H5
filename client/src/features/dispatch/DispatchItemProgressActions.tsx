import {Button,Space} from 'antd';
import type {DispatchItem,DispatchTask} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';

export function DispatchItemProgressActions({task,item,controller:c,enabled}:{task:DispatchTask;item:DispatchItem;controller:DispatchController;enabled:boolean}) {
  const waitingForParts=task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt;
  if(!enabled||task.needsReview||waitingForParts||!['待开工','维修中'].includes(task.stage))return null;
  return <Space wrap>
    {['待开工','待派工','待领料'].includes(item.status)?<Button loading={c.busy} disabled={c.busy} aria-label={`开工：${item.name}`} onClick={()=>void c.act({action:'start',itemId:item.id})}>开工</Button>:null}
    {item.status==='维修中'?<Button type="primary" loading={c.busy} disabled={c.busy} aria-label={`项目完成：${item.name}`} onClick={()=>void c.act({action:'finish',itemId:item.id})}>项目完成</Button>:null}
  </Space>;
}
