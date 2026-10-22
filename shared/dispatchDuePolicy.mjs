import { hasAnyRole } from './roles.mjs';

export function canEditDispatchDue(task, actor) {
  return Boolean(actor?.active && task && actor.shopId === task.shopId
    && hasAnyRole(actor, ['advisor', 'manager', 'inspector'])
    && !task.needsReview
    && !['草稿', '待客户签字', '待处理纸质委托书', '完成'].includes(task.orderStatus)
    && ['待派工', '待接单', '待开工', '维修中', '暂停', '待检验', '回审'].includes(task.stage));
}
