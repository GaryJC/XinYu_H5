// Keep signing previews aligned without exposing employee notes or decision history.
export function signatureRepairItems(order) {
  return [
    ...(order.repairItems || []).map(item => ({name: item.name, laborFee: item.laborFee})),
    ...(order.pendingRepairs || [])
      .filter(item => !item.scheduled && item.state !== 'declined' && item.inspectionState !== 'cancelled')
      .map(item => ({name: item.name, laborFee: 0,
        confirmation: item.source === 'inspection' ? 'inspection' : item.state === 'approved' ? 'approved' : 'pending'}))
  ];
}
