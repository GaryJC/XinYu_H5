import {RepairContext} from './RepairContext';
import {Alert,Button,Checkbox,Input,InputNumber} from 'antd';
import {PlusOutlined,DeleteOutlined} from '@ant-design/icons';
import {FormDialog} from '../../shared/ui/BusinessForm';
import type {DispatchController} from './useDispatchController';
import {useWarehousePartsEditor} from './useWarehousePartsEditor';
export function WarehousePartsEditor({controller:c,onClose}:{controller:DispatchController;onClose:()=>void}) {
  const editor=useWarehousePartsEditor(c),task=c.detail!.task;
  return <FormDialog open title="整理所需配件" okText="保存配件清单" confirmLoading={c.busy} okButtonProps={{disabled:c.busy}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}} onCancel={()=>{if(!c.busy)onClose();}} onOk={async()=>{if(await editor.save())onClose();}}>
    <RepairContext task={task}/>
    <p>可新增、修改或删除尚未出库的配件。保存后重新待备料，并通知维修工查看最新需求。</p>
    {task.partsRequirement?.preparedAt?<Alert type="warning" showIcon title="本批已备料，修改后需重新确认备料完成。"/>:null}
    {task.partsRequirement?.mode==='photo'?<p>请按手写清单整理配件明细，原照片会保留。</p>:null}
    <Checkbox checked={editor.none} disabled={c.busy} onChange={e=>editor.setNone(e.target.checked)}>无需配件</Checkbox>
    {!editor.none?<div className="warehouse-parts-editor">{editor.items.map((item,index)=><section key={index} className="warehouse-edit-row" aria-label={`配件 ${index+1}`}>
      <Input aria-label={`配件 ${index+1} 名称`} value={item.name} maxLength={200} disabled={c.busy} placeholder="配件名称" onChange={e=>editor.update(index,{name:e.target.value})}/>
      <div className="warehouse-edit-quantity"><InputNumber aria-label={`配件 ${index+1} 数量`} min={0.01} max={99999} precision={2} controls={false} value={item.quantity} disabled={c.busy} onChange={v=>editor.update(index,{quantity:v??0})}/><Input aria-label={`配件 ${index+1} 单位`} value={item.unit} maxLength={20} disabled={c.busy} onChange={e=>editor.update(index,{unit:e.target.value})}/><Button danger icon={<DeleteOutlined/>} aria-label={`删除配件 ${index+1}`} disabled={c.busy} onClick={()=>editor.remove(index)}/></div>
    </section>)}<Button block icon={<PlusOutlined/>} disabled={c.busy||editor.items.length>=100} onClick={editor.add}>新增配件</Button></div>:null}
    {editor.error||c.error?<Alert type="error" showIcon title={editor.error||c.error}/>:null}
  </FormDialog>;
}
