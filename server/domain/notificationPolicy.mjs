// Delivery policy only: business events, evidence and read grants remain intact.
export const suppressedDispatchNotificationKinds = Object.freeze(['纸质委托书已创建', '维修暂停', '即将到期']);
export const isDispatchNotificationSuppressed = kind => suppressedDispatchNotificationKinds.includes(kind);
