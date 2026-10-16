import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import type { PartsRequirement } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
export function PartsRequirementSummary({value}:{value?:PartsRequirement}) {
 return <section aria-label="所需配件"><h3>所需配件</h3>{!value?<p className="dispatch-muted">尚未登记</p>:<>{value.mode==='none'?<p>无需配件</p>:value.mode==='list'?<ul className="technician-items">{value.items.map((i,n)=><li key={n}><span>{i.name}</span><strong>{i.quantity} {i.unit}</strong></li>)}</ul>:<div className="repair-photo-grid">{value.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={120}/>)}</div>}<p className="dispatch-muted">{value.recordedName} · {displayTime(value.recordedAt)}</p></>}</section>;
}
