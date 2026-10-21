import {Alert,Checkbox,Select,Tag} from 'antd';
import type {DispatchTask,UserProfile} from '../../../../shared/types';
import type {useProjectReassignment} from './useProjectReassignment';
import {personDisplayName} from './dispatchLabels';

export function ProjectReassignmentFields({task,people,draft,disabled}:{task:DispatchTask;people:UserProfile[];draft:ReturnType<typeof useProjectReassignment>;disabled:boolean}) {
  return <section className="project-reassignment">
    <Alert type="info" showIcon title="按项目改派" description="勾选需要移交的项目，逐项选择新维修工。未勾选项目、开工时间和工单进度保持不变；已接单工单的新维修工直接加入当前维修团队。"/>
    {task.items.map(item=>{
      const locked=['待检验','已完工'].includes(item.status),selected=draft.selected.includes(item.id);
      return <div className="project-reassignment-row" key={item.id}>
        <Checkbox aria-label={`改派项目：${item.name}`} checked={selected} disabled={disabled||locked} onChange={e=>draft.change(item.id,e.target.checked?'':undefined)}>{item.name}</Checkbox>
        <p>原负责人：{item.responsibleName||'待指定'} <Tag>{item.status}</Tag>{locked?' · 不可改派':''}</p>
        {selected?<Select aria-label={`项目 ${item.name} 新维修工`} value={draft.owners[item.id]||undefined} placeholder="选择新维修工" disabled={disabled} style={{width:'100%'}} options={people.filter(p=>p.id!==item.responsibleId).map(p=>({value:p.id,label:personDisplayName(p,people)}))} onChange={id=>draft.change(item.id,id)}/>:null}
      </div>;
    })}
    {draft.stale?<Alert type="warning" title="工单已更新，请关闭窗口重新选择改派项目"/>:null}
  </section>;
}
