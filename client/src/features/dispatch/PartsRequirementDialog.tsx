import { useEffect,useState } from 'react';
import { Alert,Button,Form,Input,InputNumber,Radio,Space } from 'antd';
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
  const saved=task.partsRequirement;
  const [mode,setMode]=useState<PartsRequirement['mode']|undefined>(saved?.mode);
  const [items,setItems]=useState<PartsRequirement['items']>(saved?.items||[]);
  const [uploads,setUploads]=useState<Upload[]>([]),[error,setError]=useState('');
  const uploading=uploads.some(u=>u.state==='uploading');
  useEffect(()=>{onUploading?.(uploading);return()=>onUploading?.(false);},[uploading,onUploading]);
  const busy=c.busy||uploading;
  const photos=c.detail!.files.filter(f=>f.kind==='repair_parts_photo'&&(f.repairRound||0)===round);
  const photoIds=photos.map(photo=>photo.id);
  async function upload(row:Upload) {
    setUploads(rows=>rows.map(r=>r.id===row.id?{...r,state:'uploading',error:undefined}:r));
    try {row.body ||= await prepareOcrImage(row.file);await dispatchApi.uploadPhoto(task.orderId,{...row.body,requestId:row.id,repairRound:round,purpose:'parts'});await c.refreshDetail();setUploads(rows=>rows.filter(r=>r.id!==row.id));}
    catch(e){setUploads(rows=>rows.map(r=>r.id===row.id?{...r,state:'failed',error:e instanceof Error?e.message:'照片上传失败'}:r));}
  }
  async function select(file:File) {const row:Upload={id:createRequestId(),file,state:'uploading'};setUploads(rows=>[...rows,row]);await upload(row);}
  async function confirm() {
    setError('');if(!mode){setError('请选择所需配件的登记方式');return;}
    if(uploads.length){setError('请等待照片上传完成，失败照片可重试或移除');return;}
    if(mode==='list'&&(!items.length||items.some(i=>!i.name.trim()||!i.quantity||!i.unit.trim()))){setError('请填写配件名称、数量和单位');return;}
    if(mode==='photo'&&!photoIds.length){setError('请拍摄手写配件清单，或从相册选择');return;}
    const requirement:PartsRequirement={mode,items:mode==='list'?items:[],photoIds:mode==='photo'?photoIds:[]};
    if(await c.act({action:accepting?'accept':'record-parts',partsRequirement:requirement}))onClose();
  }
  function add(name='',unit='个'){setMode('list');setItems(rows=>rows.some(i=>name&&i.name===name)?rows:rows.length<100?[...rows,{name,quantity:1,unit}]:rows);}
  return <FormDialog open title={accepting?'确认接单 · 登记所需配件':'登记所需配件'} okText={accepting?'确认接单并开始维修':'保存配件需求'} onOk={()=>void confirm()} confirmLoading={c.busy} okButtonProps={{disabled:busy}} cancelButtonProps={{disabled:busy}} closable={!busy} mask={{closable:false}} onCancel={()=>{if(!busy)onClose();}}>
    <p>登记配件需求，不会自动领料或扣减库存。{accepting?'确认接单后直接进入维修中。':''}</p>
    <Radio.Group className="parts-mode-options" aria-label="配件登记方式" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value);setError('');}} options={[{value:'none',label:'无需配件'},{value:'list',label:'选择或填写配件'},{value:'photo',label:'拍摄手写清单'}]}/>
    {mode==='list'?<><p>常用配件，点击添加后可修改数量和单位：</p><div className="parts-shortcuts">{commonPartsGroups.map(group=><section key={group.label} aria-label={group.label}><h3>{group.label}</h3><Space wrap>{group.parts.map(([name,unit])=><Button key={name} onClick={()=>add(name,unit)} disabled={busy}>{name}</Button>)}</Space></section>)}</div>
      <Form layout="vertical">{items.map((item,index)=><div className="parts-entry" key={index}>
        <Form.Item label={`配件 ${index+1}`}><Input aria-label={`配件 ${index+1} 名称`} value={item.name} disabled={busy} maxLength={200} placeholder="配件名称" onChange={e=>setItems(rows=>rows.map((r,i)=>i===index?{...r,name:e.target.value}:r))}/></Form.Item>
        <div className="parts-entry-quantity"><Form.Item label="数量"><InputNumber aria-label={`配件 ${index+1} 数量`} min={0.01} max={99999} precision={2} value={item.quantity} disabled={busy} onChange={v=>setItems(rows=>rows.map((r,i)=>i===index?{...r,quantity:v??0}:r))}/></Form.Item><Form.Item label="单位"><Input aria-label={`配件 ${index+1} 单位`} value={item.unit} maxLength={20} disabled={busy} onChange={e=>setItems(rows=>rows.map((r,i)=>i===index?{...r,unit:e.target.value}:r))}/></Form.Item><Button danger disabled={busy} onClick={()=>setItems(rows=>rows.filter((_,i)=>i!==index))}>移除</Button></div>
      </div>)}</Form><Button block onClick={()=>add()} disabled={busy||items.length>=100}>手动添加其他配件</Button>
    </>:null}
    {mode==='photo'?<><ImageSourcePicker label="手写配件清单" primaryActionLabel="拍摄手写配件清单" galleryActionLabel="相册选择" disabled={busy||photoIds.length+uploads.length>=10} loading={uploads.some(u=>u.state==='uploading')} onSelect={select}/>
      <div className="repair-photo-grid">{photos.map(photo=><div key={photo.id}><AuthenticatedImage fileId={photo.id} alt="手写配件清单" width="100%" height={100}/><small>已自动保存</small></div>)}</div>
    </>:null}
    {uploads.map(row=><div key={row.id} role="status">{row.state==='uploading'?'手写清单上传中…':<><Alert type="error" title="清单照片上传失败" description={row.error}/><Button disabled={busy} onClick={()=>void upload(row)}>重试</Button><Button disabled={busy} onClick={()=>setUploads(rows=>rows.filter(r=>r.id!==row.id))}>移除失败照片</Button></>}</div>)}
    {error||c.error?<Alert type="error" showIcon title={error||c.error}/>:null}
  </FormDialog>;
}
