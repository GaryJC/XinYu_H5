// Delivery policy only: business events, evidence and read grants remain intact.
export const suppressedDispatchNotificationKinds = Object.freeze(['纸质委托书已创建', '维修暂停']);
export const isDispatchNotificationSuppressed = kind => suppressedDispatchNotificationKinds.includes(kind);
