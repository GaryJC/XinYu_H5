import { Tag } from 'antd';
import {PartsReferencePhotos} from './PartsReferencePhotos';
import {isSupplementalParts} from './partsProgress';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import type { PartsRequirement } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
import './parts-summary.css';

export function PartsRequirementSummary({value}:{value?:PartsRequirement}) {
 const supplemental=value&&isSupplementalParts(value);
 const status=!value?'尚未登记':value.mode==='none'?'无需配件':value.issuedAt?(supplemental?'补料已出库':'已出库'):value.preparedAt?'可领取':'待仓库备料';
 const color=value?.mode==='none'||!value?undefined:value.issuedAt?'green':value.preparedAt?'blue':'gold';
 return <section className="parts-summary" aria-label="所需配件">
  <header className="parts-summary-heading"><h3>所需配件{value?.mode==='list'&&<span className="parts-summary-count">{value.items.length} 项</span>}</h3><Tag color={color}>{status}</Tag></header>
  {value&&<>
   {value.mode==='list'?<ul className="parts-summary-list">{value.items.map((item,index)=>{
    const issued=item.issuedAt||value.issuedAt;
    const prepared=item.preparedAt||value.preparedAt;
    const recipient=item.recipientName||(issued?value.recipientName:undefined)||value.ownerName||value.applicantName||value.recordedName||'领料人待确认';
    return <li key={index}>
     <div className="parts-summary-item-heading"><span className="parts-summary-name">{item.name}</span><strong className="parts-summary-quantity">{item.quantity}<span>{item.unit}</span></strong></div>
     <div className="parts-summary-item-meta"><Tag color={issued?'green':prepared?'blue':'gold'}>{issued?'已出库':prepared?'已备齐':'待备料'}</Tag><span>领料人：{recipient}</span></div>
     {(item.issuedAt||item.preparedAt)&&<time className="parts-summary-time">{displayTime(item.issuedAt||item.preparedAt)}</time>}
    </li>;
   })}</ul>:value.mode==='photo'?<div className="repair-photo-grid">{value.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={120}/>)}</div>:null}
   <PartsReferencePhotos ids={value.referencePhotoIds}/>
   <footer className="parts-summary-footer">
    <div><span>登记人</span><span>{value.recordedName||'未记录'}</span></div>
    <div><span>登记时间</span><time>{displayTime(value.recordedAt)}</time></div>
    {value.mode!=='none'&&(value.issuedAt?<><div><span>{supplemental?'补料出库':'出库人'}</span><span>{value.issuedName||'未记录'} · {displayTime(value.issuedAt)}</span></div><div><span>领取人</span><span>{value.recipientName||'未记录'}</span></div></>:value.preparedAt?<div><span>备料完成</span><span>{value.preparedName||'未记录'} · {displayTime(value.preparedAt)}</span></div>:null)}
   </footer>
  </>}
 </section>;
}
