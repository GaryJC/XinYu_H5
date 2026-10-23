import {hasAnyRole} from './roles.mjs';

export function canEditDispatchTechnicians(task,actor) {
  return Boolean(task && actor?.active && actor.shopId===task.shopId
    && hasAnyRole(actor,['manager','advisor','inspector']) && !task.needsReview
    && task.stage==='维修完成' && task.orderStatus==='待结算' && task.executionMode!=='outsourced');
}

export function requiredDispatchTechnicians(task) {
  return [...new Set([
    ...task.items.flatMap(item=>[item.responsibleId,item.finishedBy]),
    ...Object.keys(task.workerSubmissions||{})
  ].filter(Boolean))];
}
