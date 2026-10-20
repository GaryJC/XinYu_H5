import {RepairContext} from './RepairContext';
import {PartsRequirementSummary} from './PartsRequirementSummary';
import { useEffect,useState } from 'react';
import { Alert,Button,Checkbox,Collapse,Input,InputNumber,Radio,Table } from 'antd';
import { DeleteOutlined, PlusOutlined, CheckOutlined } from '@ant-design/icons';
import './parts-requirement.css';
import type { PartsRequirement } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import { FormDialog } from '../../shared/ui/BusinessForm';
import { ImageSourcePicker } from '../../shared/ui/ImageSourcePicker';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { prepareOcrImage } from '../../shared/images/prepareOcrImage';
import { createRequestId } from '../../shared/api/requestId';
import { dispatchApi } from './dispatchApi';
const commonPartsGroups: {label:string;parts:[string,string][]}[]=[
  {label:'保养与耗材',parts:[['机油','升'],['柴机油','桶'],['机油滤芯','个'],['空气滤芯','个'],['空调滤芯','个'],['雨刮片','副'],['胶带','卷'],['扎带','根']]},
  {label:'冷却与空调',parts:[['防冻液','升'],['水箱','个'],['小水泵','个'],['电子扇（大）','个'],['电子扇（小）','个'],['冷凝器','个'],['空调高压管','根'],['冷媒','罐']]},
  {label:'制动与动力',parts:[['刹车片','副'],['轮胎','条'],['皮带','条'],['火花塞','支'],['蓄电池','个']]},
  {label:'安全与内饰',parts:[['主驾驶气囊','个'],['副驾驶气囊','个'],['气囊电脑','个'],['仪表台','个']]},
];
type Upload={id:string;file:File;state:'uploading'|'failed';error?:string;body?:Awaited<ReturnType<typeof prepareOcrImage>>};
export function PartsRequirementDialog({controller:c,accepting,onClose,onUploading}:{controller:DispatchController;accepting:boolean;onClose:()=>void;onUploading?:(value:boolean)=>void}) {
  const task=c.detail!.task,round=task.repairRound||0;
  const [initialVersion]=useState(task.version);
  const stale=initialVersion!==task.version;
  const inherited=Boolean(accepting&&task.partsRequirement);
  const adding=Boolean(!accepting&&task.partsRequirement?.issuedAt);
  const saved=adding?undefined:task.partsRequirement;
  const [mode,setMode]=useState<PartsRequirement['mode']|undefined>(saved?.mode);
  const [items,setItems]=useState<PartsRequirement['items']>(saved?.items||[]);
  const [photoIds,setPhotoIds]=useState<string[]>(saved?.photoIds||[]);
  const [uploads,setUploads]=useState<Upload[]>([]),[error,setError]=useState('');
  const uploading=uploads.some(u=>u.state==='uploading');
  useEffect(()=>{onUploading?.(uploading);return()=>onUploading?.(false);},[uploading,onUploading]);
  const busy=c.busy||uploading;
  const photos=c.detail!.files.filter(f=>f.kind==='repair_parts_photo'&&(f.repairRound||0)===round);
  async function upload(row:Upload) {
    setUploads(rows=>rows.map(r=>r.id===row.id?{...r,state:'uploading',error:undefined}:r));
    try {row.body ||= await prepareOcrImage(row.file);const photo=await dispatchApi.uploadPhoto(task.orderId,{...row.body,requestId:row.id,repairRound:round,purpose:'parts'});setPhotoIds(ids=>ids.includes(photo.id)?ids:[...ids,photo.id]);await c.refreshDetail();setUploads(rows=>rows.filter(r=>r.id!==row.id));}
    catch(e){setUploads(rows=>rows.map(r=>r.id===row.id?{...r,state:'failed',error:e instanceof Error?e.message:'照片上传失败'}:r));}
  }
  async function select(file:File) {const row:Upload={id:createRequestId(),file,state:'uploading'};setUploads(rows=>[...rows,row]);await upload(row);}
  async function confirm() {
    setError('');if(stale){setError('工单或配件需求已更新，请关闭后重新打开核对');return;}
    if(inherited){if(await c.act({action:'accept',partsRequirement:task.partsRequirement}))onClose();return;}
    if(!mode){setError('请选择所需配件的登记方式');return;}
    if(uploads.length){setError('请等待照片上传完成，失败照片可重试或移除');return;}
    if(mode==='list'&&(!items.length||items.some(i=>!i.name.trim()||!i.quantity||!i.unit.trim()))){setError('请填写配件名称、数量和单位');return;}
    if(mode==='photo'&&!photoIds.length){setError('请拍摄手写配件清单，或从相册选择');return;}
    const requirement:PartsRequirement={mode,items:mode==='list'?items:[],photoIds:mode==='photo'?photoIds:[]};
    if(await c.act({action:accepting?'accept':'record-parts',partsRequirement:requirement}))onClose();
  }
  function add(name='',unit='个'){setMode('list');setItems(rows=>rows.some(i=>name&&i.name===name)?rows:rows.length<100?[...rows,{name,quantity:1,unit}]:rows);}
  return <FormDialog rootClassName="parts-requirement-modal" open title={accepting?'确认接单 · 登记所需配件':adding?'追加配件申请':'修改配件需求'} okText={inherited?'确认接单并保留原领料记录':accepting?(mode==='none'?'接单并开始维修':'接单并提交配件需求'):adding?'提交补料':task.repairRound?'提交返工领料':'发送仓库'} onOk={()=>void confirm()} confirmLoading={c.busy} okButtonProps={{disabled:busy||stale}} cancelButtonProps={{disabled:busy}} closable={!busy} mask={{closable:false}} onCancel={()=>{if(!busy)onClose();}}>
    <div className="parts-dialog-intro"><strong>{task.plate}</strong><span>{task.dispatchNo || task.orderId}</span><p>{accepting?'需要配件时进入待开工，仓管确认出库后自动开工；无需配件直接开工。':adding?'填写本次追加的配件，已出库清单保留在历史记录中。':'修改后将重新通知仓库备料，原备料结果失效。'}</p></div>
    <RepairContext task={adding?{...task,partsRequirement:{...task.partsRequirement!,batch:(task.partsRequirement?.batch||1)+1}}:task}/>
    {stale?<Alert type="warning" showIcon title="工单或配件需求已更新，请关闭后重新打开核对"/>:null}
    {inherited?<><Alert type="info" title="本次接单保留原配件及交接记录，需要新增配件时请另行申请。"/><PartsRequirementSummary value={task.partsRequirement}/></>:null}
    {!inherited?<>
    <Radio.Group className="parts-dialog-modes" optionType="button" buttonStyle="solid" aria-label="配件登记方式" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value);setError('');}} options={[{value:'none',label:'无需配件'},{value:'list',label:'填写配件'},{value:'photo',label:'清单照片'}]}/>
    {mode==='none'?<div className="parts-none-state"><CheckOutlined/><div><strong>本次维修无需配件</strong><p>后续需要时，可在维修任务中补充申请。</p></div></div>:null}
    {mode==='list'?<div className="parts-list-workflow">
      <section className="parts-selected" aria-label="已选配件">
        <div className="parts-section-heading"><h3>配件清单 <span>{items.length} 项</span></h3><Button type="link" icon={<PlusOutlined/>} onClick={()=>add()} disabled={busy||items.length>=100}>手动添加</Button></div>
        {items.length?<Table size="small" pagination={false} tableLayout="fixed" rowKey="key" dataSource={items.map((item,key)=>({...item,key}))} columns={[
          {title:'配件名称',dataIndex:'name',render:(_,item)=><Input aria-label={`配件 ${item.key+1} 名称`} value={item.name} disabled={busy} maxLength={200} placeholder="配件名称" onChange={e=>setItems(rows=>rows.map((r,i)=>i===item.key?{...r,name:e.target.value}:r))}/>},
          {title:'数量',width:82,render:(_,item)=><InputNumber aria-label={`配件 ${item.key+1} 数量`} min={0.01} max={99999} precision={2} controls={false} value={item.quantity} disabled={busy} onChange={v=>setItems(rows=>rows.map((r,i)=>i===item.key?{...r,quantity:v??0}:r))}/>},
          {title:'单位',width:60,render:(_,item)=><Input aria-label={`配件 ${item.key+1} 单位`} value={item.unit} maxLength={20} disabled={busy} onChange={e=>setItems(rows=>rows.map((r,i)=>i===item.key?{...r,unit:e.target.value}:r))}/>},
          {title:'',width:44,render:(_,item)=><Button type="text" danger icon={<DeleteOutlined/>} aria-label={`移除配件 ${item.key+1}`} disabled={busy} onClick={()=>setItems(rows=>rows.filter((_,i)=>i!==item.key))}/>}
        ]}/>:<div className="parts-empty-selection">从下方选择常用配件，或点击“手动添加”</div>}
      </section>
      <section aria-label="常用配件"><div className="parts-section-heading"><h3>常用配件</h3><span>点击添加，可修改数量和单位</span></div>
        <Collapse className="parts-catalog" defaultActiveKey={['保养与耗材']} items={commonPartsGroups.map(group=>({key:group.label,label:group.label,extra:<span className="parts-catalog-count">{group.parts.length} 项</span>,children:<div className="parts-catalog-options">{group.parts.map(([name,unit])=>{const selected=items.some(item=>item.name===name);return <Button key={name} icon={selected?<CheckOutlined/>:<PlusOutlined/>} className={selected?'is-selected':''} onClick={()=>add(name,unit)} disabled={busy||selected||items.length>=100}>{name}</Button>;})}</div>}))}/>
      </section>
    </div>:null}
    {mode==='photo'?<div className="parts-photo-section"><div className="parts-section-heading"><h3>手写配件清单</h3><span>{photoIds.length} / 10 张</span></div><p className="parts-photo-hint">请拍清配件名称、数量和单位，仓管将按选中的照片备料。</p><ImageSourcePicker label="手写配件清单" primaryActionLabel="拍摄手写配件清单" galleryActionLabel="相册选择" disabled={busy||photoIds.length+uploads.length>=10} loading={uploads.some(u=>u.state==='uploading')} onSelect={select}/>
      <div className="repair-photo-grid">{photos.map(photo=><div key={photo.id}><AuthenticatedImage fileId={photo.id} alt="手写配件清单" width="100%" height={100}/><Checkbox checked={photoIds.includes(photo.id)} disabled={busy||(!photoIds.includes(photo.id)&&photoIds.length>=10)} onChange={e=>setPhotoIds(ids=>e.target.checked?[...ids,photo.id]:ids.filter(id=>id!==photo.id))}>用于本次申请</Checkbox></div>)}</div>
    </div>:null}
    </>:null}
    {uploads.map(row=><div key={row.id} role="status">{row.state==='uploading'?'手写清单上传中…':<><Alert type="error" title="清单照片上传失败" description={row.error}/><Button disabled={busy} onClick={()=>void upload(row)}>重试</Button><Button disabled={busy} onClick={()=>setUploads(rows=>rows.filter(r=>r.id!==row.id))}>移除失败照片</Button></>}</div>)}
    {error||c.error?<Alert type="error" showIcon title={error||c.error}/>:null}
  </FormDialog>;
}
