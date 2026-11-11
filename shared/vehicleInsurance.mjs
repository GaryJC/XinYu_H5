export function insuranceToday(now = new Date()) { return new Date(now.getTime()+8*3600000).toISOString().slice(0,10); }
export function insuranceState(car, today=insuranceToday()) {
  if(!car.insuranceStart || !car.insuranceEnd) return '未录入保险';
  if(car.insuranceEnd < today) return '保险已到期';
  if(car.insuranceStart > today) return '保险未生效';
  return '保险有效';
}
export function insuranceReminder(end,today=insuranceToday()) {
  const days=Math.round((Date.parse(end)-Date.parse(today))/86400000);
  return days<0?-1:days===0?0:days<=1?1:days<=7?7:days<=30?30:null;
}
