import {Space} from 'antd';
import type {ProcurementTerms} from '../../../../shared/types';
import {dateTime} from './procurementApi';
import {ProcurementPhoto} from './ProcurementPhoto';
export function ProcurementTermsView({terms,portal=false}:{terms:ProcurementTerms;portal?:boolean}) {
  return <><dl className="procurement-terms">{[
    ['配件',terms.partName],['车架号',terms.vin||'未记录'],['车辆型号',terms.vehicleModel||'未填写'],['规格',terms.specification||'未指定'],['品牌',terms.brand||'不限品牌'],['数量',`${terms.quantity} ${terms.unit}`],
    ['最晚交货',dateTime(terms.deliveryBy)],['发票及付款',terms.paymentTerms||'未指定'],...(terms.qualityRequirements?[['历史质量要求',terms.qualityRequirements]]:[]),
  ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{terms.nameplatePhotoIds?.length?<section><h3>铭牌号照片</h3><Space wrap>{terms.nameplatePhotoIds.map(id=><ProcurementPhoto key={id} id={id} portal={portal}/>)}</Space></section>:null}{terms.otherPhotoIds?.length?<section><h3>其他照片</h3><Space wrap>{terms.otherPhotoIds.map(id=><ProcurementPhoto key={id} id={id} portal={portal} label="其他照片"/>)}</Space></section>:null}{terms.imageUrls.length?<div className="procurement-images">{terms.imageUrls.map(u=><a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="配件参考图片" referrerPolicy="no-referrer"/></a>)}</div>:null}</>;
}
