export function procurementNotificationRole(payload={}) {
  if(payload.recipientRole==='manager'||payload.recipientRole==='warehouse')return payload.recipientRole;
  // Older queued approval requests did not store an explicit audience.
  return String(payload.title||'').startsWith('采购提报审批：')?'manager':'warehouse';
}
