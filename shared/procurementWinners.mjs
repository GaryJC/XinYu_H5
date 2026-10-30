export function procurementWinnerIds(tender) {
 return tender.winnerIds?.length ? tender.winnerIds : tender.winnerId ? [tender.winnerId] : [];
}
