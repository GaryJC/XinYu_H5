import {hasRole} from '../../shared/roles.mjs';
import {actionParts} from './individualRepair.mjs';

// A submission and its notifications are persisted in the same transaction.
export function partsSubmissionNotifications(task,next,input,actor,people) {
  if(!['accept','record-parts'].includes(input.action))return [];
  const parts=actionParts(next,input,actor);
  if(!parts)return [];
  const previous=actionParts(task,input,actor);
  const edited=input.action==='record-parts'&&previous&&!previous.preparedAt&&!previous.issuedAt;
  const pending=parts.mode!=='none'&&!parts.preparedAt&&!parts.issuedAt;
  const scope={partsOwnerId:parts.ownerId,partsRecordedAt:parts.recordedAt,partsRevision:parts.revision};
  const summary=parts.mode==='none'?'无需配件':parts.mode==='photo'?`手写配件清单 ${parts.photoIds.length} 张`:parts.items.map(item=>`${item.name} ${item.quantity}${item.unit}${item.issuedAt?'（已出库）':item.preparedAt?'（已备齐）':'（待备料）'}`).join('、');
  const notices=[];
  if(edited||pending) {
    const notice=edited?(parts.mode==='none'?'维修工已将本次申请改为无需配件，请停止按原清单备料。':pending?'维修工已重新提交配件需求，请按最新清单备料；已备齐、已出库记录保留。':'维修工已更新申请，本批已无待备料项，请核对最新清单，停止按旧清单备料。'):'维修工已提交配件申请，请查看清单并安排备料。';
    for(const person of people.filter(p=>p.active&&p.shopId===next.shopId&&hasRole(p,'warehouse'))) {
      notices.push({recipient:person.id,kind:edited?'配件申请已更新':'配件申请',payload:{...scope,summary:`${parts.ownerName||parts.applicantName||actor.name}：${summary}`.slice(0,200),notice}});
    }
  }
  // Editing bumps the request revision and can move indices. Refresh pickup
  // reminders for retained prepared lines so queued old reminders may expire.
  if(edited) {
    const recipients=[...new Set(parts.items.filter(item=>item.preparedAt&&!item.issuedAt).map(item=>item.recipientId).filter(Boolean))];
    for(const recipient of recipients) {
      const rows=parts.items.flatMap((item,index)=>item.preparedAt&&!item.issuedAt&&item.recipientId===recipient?[{index,preparedAt:item.preparedAt}]:[]);
      notices.push({recipient,kind:'配件可领取',payload:{...scope,partsPreparation:rows,summary:rows.map(row=>{const item=parts.items[row.index];return `${item.name} ${item.quantity}${item.unit}`;}).join('、').slice(0,200),notice:'配件申请已更新，所列已备齐配件仍可领取；请以最新清单为准。'}});
    }
  }
  return notices;
}
