import { transaction } from '../database/pool.mjs';
import { findWorkOrderById, upsertWorkOrder } from '../db.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { assertOrderReadyForSignature } from '../domain/workOrderPolicy.mjs';
import { buildLegacyRefresh } from '../domain/legacyRefresh.mjs';
import { readLegacyWorkOrder } from '../repositories/legacyWorkOrderRepository.mjs';
import { applyLegacyRefresh, readRefreshItems } from '../repositories/workOrderRefreshRepository.mjs';
import { lockPaperOrder, setPaperMode, assertLegacyLinkAvailable, attachPaperPhotos, markPaperLegacySynced, auditPaperSubmission } from '../repositories/paperOrderRepository.mjs';
import { enqueueLegacySyncEvent } from '../repositories/legacySyncOutboxRepository.mjs';
import { activateDispatchPlan } from './dispatchPlanService.mjs';
import { saveDispatchPlan } from '../repositories/dispatchPlanRepository.mjs';
import { assertPaperDraftUnsubmitted } from '../repositories/paperOrderRepository.mjs';

export async function resolvePaperOrder(id, input, actor, dependencies={}) {
  if (!input || !['runfeng','dingtalk'].includes(input.mode)) throw new HttpError(400,'请选择纸质委托书的创建方式');
  const dispatchNo=String(input.dispatchNo || '').trim().toUpperCase();
  if (input.mode==='runfeng' && !/^[ABFJ][0-9]+$/.test(dispatchNo)) throw new HttpError(400,'请填写有效的润丰派工号');
  const { runTransaction=transaction, readSource=readLegacyWorkOrder, readResult=findWorkOrderById }=dependencies;
  return runTransaction(async client=>{
    const row=await lockPaperOrder(client,id,actor);
    const isDraft = row.status === '草稿' && row.paper_order.mode === 'dingtalk';
    if (isDraft && input.mode === 'runfeng') {
      if (actor.role === 'advisor' && row.advisor !== actor.name) throw new HttpError(403,'只能更改自己负责的纸质委托单开单方式');
      await assertPaperDraftUnsubmitted(client, row);
    } else if (row.status!=='待处理纸质委托书' || row.paper_order.mode!=='pending') {
      throw new HttpError(409,'此纸质委托书已处理，请刷新后重试');
    }
    if (input.mode==='dingtalk') {
      // The processing advisor takes responsibility for completing this draft.
      await setPaperMode(client,id,'dingtalk','草稿',actor);
    } else {
      const snapshot=await readSource({...row,paperDispatchNo:dispatchNo});
      if (String(snapshot.header.pgd || '').trim()!==dispatchNo) throw new HttpError(409,'润丰派工号与输入不一致');
      await assertLegacyLinkAvailable(client,id,snapshot.header);
      const {items,hasExecution}=await readRefreshItems(client,id);
      const change=buildLegacyRefresh(snapshot,items,hasExecution);
      const text=value=>String(value??'').trim();
      // Initial import includes all identity/contact fields in addition to refreshable repair content.
      Object.assign(change.fields,{
        vehicle_model:text(snapshot.vehicle?.model_name || snapshot.header.cx),
        vehicle_model_legacy_code:text(snapshot.vehicle?.model_code),
        customer_name:text(snapshot.customer?.mc),customer_legacy_code:text(snapshot.header.ssdw),
        customer_contact:text(snapshot.header.lxr || snapshot.header.sxr),customer_phone:text(snapshot.header.lxdh),
        department_code:text(snapshot.header.bm),department_name:text(snapshot.header.department_name)
      });
      await applyLegacyRefresh(client,row,change,snapshot.header,actor);
      if (isDraft) await saveDispatchPlan(client, { id }, actor, null);
      await setPaperMode(client,id,'runfeng','已委托',actor);
      await markPaperLegacySynced(client,id);
    }
    return readResult(client,id);
  });
}
export async function submitPaperDingTalkOrder(id,actor,dependencies={}) {
  const {runTransaction=transaction,readResult=findWorkOrderById}=dependencies;
  return runTransaction(async client=>{
    const row=await lockPaperOrder(client,id,actor);
    if (row.status!=='草稿' || row.paper_order.mode!=='dingtalk') throw new HttpError(409,'只能提交在钉钉创建的纸质委托单草稿');
    if (actor.role==='advisor' && row.advisor!==actor.name) throw new HttpError(403,'只能提交自己负责的委托单');
    const order=await readResult(client,id);
    assertOrderReadyForSignature(order);
    await attachPaperPhotos(client,order,actor.id);
    await upsertWorkOrder(client,{...order,status:'已委托',updatedAt:new Date().toISOString()});
    await auditPaperSubmission(client,id,actor);
    await activateDispatchPlan(client,{...order,status:'已委托'});
    await enqueueLegacySyncEvent(client,await readResult(client,id),'created');
    return readResult(client,id);
  });
}
