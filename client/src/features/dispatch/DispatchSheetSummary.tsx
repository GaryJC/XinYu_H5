import { Descriptions, Image } from 'antd';
import type { DispatchTask, DispatchDetail } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { displayTime } from './dispatchLabels';
export function DispatchSheetSummary({task,files=[]}:{task:DispatchTask;files?:DispatchDetail['files']}) {
 const photos=files.filter(f=>['repair_order_photo','damage_photo'].includes(f.kind)&&f.mimeType.startsWith('image/'));
 return <section className="dispatch-sheet-summary" aria-label="派工单信息"><h3>派工单信息</h3><Descriptions bordered column={{xs:1,sm:2,md:2}} size="small" items={[
  {key:'order',label:'委托单号',children:task.orderId},
  {key:'dispatch',label:'派工号',children:task.dispatchNo||'待业务平台回填'},
  {key:'date',label:'派工日期',children:task.assignedAt?displayTime(task.assignedAt):'未记录'},
  {key:'arrival',label:'进厂日期',children:task.arrivalDate||'未填写'},
  {key:'customer',label:'托修单位',children:task.customerName||'未填写'},
  {key:'model',label:'车型',children:task.vehicleModel||'未填写'},
  {key:'plate',label:'车号',children:task.plate||'未填写'},
  {key:'mileage',label:'里程数',children:task.vehicleMileage?`${task.vehicleMileage} km`:'未填写'},
  {key:'type',label:'工种',children:'未填写'},
  {key:'worker',label:task.executionMode==='outsourced'?'承包方':'主修人',children:task.technicianName||'待指派'},
  {key:'foreman',label:'班长',children:'未填写'},
  {key:'inspector',label:'质检人',children:task.inspectorName||'待检验'},
  {key:'complete',label:'竣工时间',children:task.completedAt?displayTime(task.completedAt):'尚未竣工'}
 ]}/>{photos.length?<><h3>接车照片 <small>（点击放大）</small></h3><Image.PreviewGroup><div className="repair-photo-grid">{photos.map((photo,index)=><div key={photo.id}><AuthenticatedImage fileId={photo.id} alt={`接车照片 ${index+1}`} width="100%" height={100}/></div>)}</div></Image.PreviewGroup></>:null}</section>;
}
