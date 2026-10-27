import {Radio,Tag} from 'antd';
import type {DispatchItem} from '../../../../shared/types';
import type {InspectionChoices} from './inspectionReview';
import './inspection-items.css';
export function InspectionItems({items,choices,onChange,disabled=false,readOnly=false}:{items:DispatchItem[];choices:InspectionChoices;onChange?:(id:number,value:'pass'|'return'|'deferred')=>void;disabled?:boolean;readOnly?:boolean}) {
 return <ol className="inspection-items">{items.filter(item=>item.status==='待检验').map((item,index)=><li key={item.id} className={choices[item.id]==='return'?'inspection-item is-return':choices[item.id]==='deferred'?'inspection-item is-deferred':'inspection-item'}>
   <div className="inspection-item-name"><span className="inspection-item-number">{String(index+1).padStart(2,'0')}</span><div><strong>{item.name}</strong><div className="dispatch-muted">负责人：{item.responsibleName||'待指定'}</div></div></div>
   {readOnly?<Tag color={choices[item.id]==='return'?'red':choices[item.id]==='pass'?'green':choices[item.id]==='deferred'?'orange':'default'}>{choices[item.id]==='return'?'退回':choices[item.id]==='pass'?'通过':choices[item.id]==='deferred'?'待定':'未选择'}</Tag>:<Radio.Group aria-label={`检验结果：${item.name}`} optionType="button" buttonStyle="solid" value={choices[item.id]} disabled={disabled} onChange={e=>onChange?.(item.id,e.target.value)} options={[{value:'pass',label:'通过'},{value:'return',label:'退回'},{value:'deferred',label:'待定'}]}/>}
 </li>)}</ol>;
}

export function PassedInspectionItems({items}:{items:DispatchItem[]}) {
 const passed=items.filter(item=>item.status==='已完工'&&item.inspectedAt);
 if(!passed.length)return null;
 return <section className="task-projects" aria-label="已检验通过项目">
  <h3>已检验通过项目 · {passed.length} 项</h3>
  <ol className="inspection-items">{passed.map((item,index)=><li key={item.id} className="inspection-item">
   <div className="inspection-item-name"><span className="inspection-item-number">{String(index+1).padStart(2,'0')}</span><div><strong>{item.name}</strong><div className="dispatch-muted">负责人：{item.responsibleName||'未记录'}</div><div className="dispatch-muted">检验人：{item.inspectorName||'未记录'}</div></div></div>
   <Tag color="green">已通过</Tag>
  </li>)}</ol>
  <p className="inspection-progress">之前已检验通过，无需重复选择检验结果。</p>
 </section>;
}
