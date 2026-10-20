// Quantity has at most three decimals. Use integer thousandths, then round half a fen up once.
export function procurementTotalFen(unitPriceFen,quantity,freightFen) {
  const product=unitPriceFen*Math.round(quantity*1000);
  if(!Number.isSafeInteger(product)||product>Number.MAX_SAFE_INTEGER-500)return Infinity;
  return Math.floor((product+500)/1000)+freightFen;
}
