import { useState } from 'react';
import { Button, Checkbox, Modal, Popover } from 'antd';
import { Images, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import type { StoredFile } from '../../../../shared/types';
import { AuthenticatedImage, AuthenticatedImagePreviewGroup } from '../../shared/ui/AuthenticatedImage';
import { ImageSourcePicker } from '../../shared/ui/ImageSourcePicker';
import { usePhotoSelection } from '../../shared/ui/PhotoBatchActions';
import './order-photo-gallery.css';

export function OrderPhotoGallery({ title, files, editable, busy, multiple, onUpload, onRemove }: {
  title:string; files:StoredFile[]; editable:boolean; busy:boolean; multiple:boolean;
  onUpload:(files:File[],replaceId?:string)=>Promise<unknown>;
  onRemove:(ids:string[])=>Promise<unknown>;
}) {
  const [managing,setManaging]=useState(false),[open,setOpen]=useState<string>();
  const selection=usePhotoSelection(files.map(file=>file.id));
  const remove=(ids:string[])=>Modal.confirm({title:`删除 ${ids.length} 张照片？`,content:'删除后将不再展示在当前委托单中。',okText:'删除照片',cancelText:'取消',okButtonProps:{danger:true},onOk:async()=>{
    if(await onRemove(ids)!==false){selection.clear();setOpen(undefined);}
  }});
  const picker=(replaceId?:string)=><div className="order-photo-source"><ImageSourcePicker label={title+(replaceId?'重新上传':'上传')} multiple={multiple&&!replaceId}
    disabled={busy} primaryActionLabel={replaceId?'重新拍摄':'拍照上传'} galleryActionLabel={multiple&&!replaceId?'相册多选':'从相册选择'}
    onSelect={async file=>{setOpen(undefined);await onUpload([file],replaceId);}}
    onSelectMany={multiple&&!replaceId?async selected=>{setOpen(undefined);await onUpload(selected);}:undefined}/></div>;
  return <section className="order-photo-gallery" aria-label={title}>
    <div className="order-photo-heading"><div><h3>{title}<span>{files.length} 张</span></h3><p>点击照片查看原图</p></div>
      {editable&&<div className="order-photo-heading-actions">
        {!!files.length&&multiple&&<Button type="text" disabled={busy} onClick={()=>{setManaging(!managing);selection.clear();}}>{managing?'完成':'管理'}</Button>}
        <Popover content={picker()} trigger="click" placement="bottomRight" open={open==='add'&&!busy} onOpenChange={value=>setOpen(value?'add':undefined)}>
          <Button type="primary" icon={<Plus size={16}/>} disabled={busy} loading={busy} aria-label={`添加${title}`}>添加</Button>
        </Popover>
      </div>}
    </div>
    {managing&&editable&&!!files.length&&<div className="order-photo-batch">
      <Checkbox disabled={busy} checked={selection.selectedIds.length===files.length} indeterminate={!!selection.selectedIds.length&&selection.selectedIds.length<files.length}
        onChange={event=>selection.selectAll(event.target.checked)}>全选照片</Checkbox>
      <span>已选 {selection.selectedIds.length} 张</span>
      <Button type="text" danger icon={<Trash2 size={15}/>} disabled={busy||!selection.selectedIds.length} onClick={()=>remove(selection.selectedIds)}>删除所选</Button>
    </div>}
    {!!files.length?<AuthenticatedImagePreviewGroup fileIds={files.map(file=>file.id)}><div className="order-photo-grid">
      {files.map((file,index)=><article className={`order-photo-card${selection.selectedIds.includes(file.id)?' is-selected':''}`} key={file.id}>
        <div className="order-photo-thumbnail"><AuthenticatedImage fileId={file.id} width="100%" height="100%" alt={`${title} ${index+1}`}/>
          {managing&&editable&&<Checkbox className="order-photo-check" aria-label={`选择照片 ${file.originalName||file.id}`} disabled={busy} checked={selection.selectedIds.includes(file.id)} onChange={event=>selection.toggle(file.id,event.target.checked)}/>}
        </div>
        <div className="order-photo-caption"><span title={file.originalName}>{file.originalName||`照片 ${index+1}`}</span>
          {editable&&!managing&&<Popover trigger="click" placement="bottomRight" open={open===file.id&&!busy} onOpenChange={value=>setOpen(value?file.id:undefined)} content={<div className="order-photo-menu"><strong>更换照片</strong>{picker(file.id)}<Button type="text" danger icon={<Trash2 size={16}/>} disabled={busy} onClick={()=>{setOpen(undefined);remove([file.id]);}} aria-label={`删除${title} ${file.originalName||file.id}`}>删除照片</Button></div>}>
            <Button type="text" icon={<MoreHorizontal size={19}/>} aria-label={`照片操作 ${file.originalName||file.id}`} disabled={busy}/>
          </Popover>}
        </div>
      </article>)}
    </div></AuthenticatedImagePreviewGroup>:<div className="order-photo-empty"><Images size={24}/><span>暂无{title}</span>{editable&&<small>支持拍照或从相册添加</small>}</div>}
  </section>;
}
