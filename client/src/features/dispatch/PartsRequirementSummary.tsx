import {isSupplementalParts} from './partsProgress';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import type { PartsRequirement } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
export function PartsRequirementSummary({value}:{value?:PartsRequirement}) {
 return <section aria-label="所需配件"><h3>所需配件</h3>{!value?<p className="dispatch-muted">尚未登记</p>:<>{value.mode==='none'?<p>无需配件</p>:value.mode==='list'?<ul className="technician-items">{value.items.map((i,n)=><li key={n}><span>{i.name}</span><strong>{i.quantity} {i.unit}</strong></li>)}</ul>:<div className="repair-photo-grid">{value.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={120}/>)}</div>}<p className="dispatch-muted">{value.recordedName} · {displayTime(value.recordedAt)}</p>{value.mode!=="none"?<p>{value.issuedAt?`${isSupplementalParts(value)?'补料出库':'已出库'}：${value.issuedName} · ${displayTime(value.issuedAt)} · 领取人：${value.recipientName||"未记录"}`:value.preparedAt?`${isSupplementalParts(value)?'补料完成，可领取':'配件可领取'}：${value.preparedName} · ${displayTime(value.preparedAt)}`:"待仓库备料"}</p>:null}</>}</section>;
}
