const DAY=86400000, OFFSET=8*3600000;
const timestamp=value=>value?new Date(value).getTime():NaN;
const dateKey=time=>new Date(time+OFFSET).toISOString().slice(0,10);
const group=(rows,key)=>{
  const values=new Map();for(const row of rows){const name=key(row);values.set(name,(values.get(name)||0)+1);}
  return [...values].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
};
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const n=sorted.length;return n?Math.round((n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2)*10)/10:null;};
const metric=(value,previous)=>({value,previous,change:previous>0?Math.round((value-previous)/previous*1000)/10:null});
const clean=value=>String(value||'').trim().toUpperCase().replace(/\s+/g,'');

export function buildBusinessAnalytics(input,{days=30,now=new Date()}={}) {
  // Compare adjacent complete Shanghai calendar days, so a partial today never looks like a decline.
  const end=Math.floor((now.getTime()+OFFSET)/DAY)*DAY-OFFSET,start=end-days*DAY,previousStart=start-days*DAY;
  const rows=input.filter(r=>!['草稿','待处理纸质委托书'].includes(r.status)).map(r=>{
    const created=timestamp(r.createdAt);
    const completions=(r.completionDates||[]).map(timestamp).filter(t=>Number.isFinite(t)&&t>=created&&t<=now.getTime());
    return {...r,created,completed:completions.length?Math.min(...completions):NaN,
      currentStage:r.status==='待客户签字'?r.status:r.stage||(['待结算','完成'].includes(r.status)?'维修完成':r.status),
      vehicle:clean(r.vin)||clean(r.plate),customer:String(r.customer||'').trim()||'未登记单位'};
  }).filter(r=>Number.isFinite(r.created)&&r.created<=now.getTime());
  const between=(time,a,b)=>time>=a&&time<b;
  // Link historical plate-only records to a VIN only when the plate mapping is unambiguous.
  const plateVins=new Map();for(const r of rows){const plate=clean(r.plate),vin=clean(r.vin);if(plate&&vin){if(!plateVins.has(plate))plateVins.set(plate,new Set());plateVins.get(plate).add(vin);}}
  for(const r of rows){const vins=plateVins.get(clean(r.plate));if(!clean(r.vin)&&vins?.size===1)r.vehicle=[...vins][0];}
  const current=rows.filter(r=>between(r.created,start,end)),previous=rows.filter(r=>between(r.created,previousStart,start));
  const done=rows.filter(r=>between(r.completed,start,end)),previousDone=rows.filter(r=>between(r.completed,previousStart,start));
  const cycles=done.map(r=>(r.completed-r.created)/DAY),previousCycles=previousDone.map(r=>(r.completed-r.created)/DAY);
  const daily=Array.from({length:days},(_,i)=>{
    const at=start+i*DAY, prior=previousStart+i*DAY;
    return {date:dateKey(at),previousDate:dateKey(prior),created:current.filter(r=>between(r.created,at,at+DAY)).length,
      previous:previous.filter(r=>between(r.created,prior,prior+DAY)).length,completed:done.filter(r=>between(r.completed,at,at+DAY)).length};
  });
  const todayKey=dateKey(now.getTime()),monthStart=new Date(`${todayKey.slice(0,7)}-01T00:00:00+08:00`);
  const monthly=Array.from({length:12},(_,i)=>{
    const shifted=new Date(monthStart.getTime()+OFFSET);shifted.setUTCMonth(shifted.getUTCMonth()-11+i);
    const month=shifted.toISOString().slice(0,7);
    return {month,value:rows.filter(r=>dateKey(r.created).startsWith(month)).length,partial:i===11};
  });
  const firstSeen=new Map();for(const r of rows)if(r.vehicle)firstSeen.set(r.vehicle,Math.min(firstSeen.get(r.vehicle)??Infinity,r.created));
  const vehicles=[...new Set(current.map(r=>r.vehicle).filter(Boolean))];
  const newVehicles=vehicles.filter(v=>firstSeen.get(v)>=start).length;
  const live=rows.filter(r=>r.currentStage!=='维修完成');
  const agingNames=['≤1天','1–3天','3–7天','7–14天','>14天'];
  const ageBucket=age=>age<=1?0:age<=3?1:age<=7?2:age<=14?3:4;
  const aging=agingNames.map((name,i)=>({name,value:live.filter(r=>ageBucket((now.getTime()-r.created)/DAY)===i).length}));
  const cycleNames=['≤1天','1–3天','3–7天','>7天'];
  const cycleBuckets=cycleNames.map((name,i)=>({name,value:cycles.filter(v=>(v<=1?0:v<=3?1:v<=7?2:3)===i).length}));
  const customers=group(current,r=>r.customer),topCustomers=customers.slice(0,6);
  if(customers.length>6)topCustomers.push({name:'其他单位',value:customers.slice(6).reduce((sum,r)=>sum+r.value,0)});
  const missingCompletion=rows.filter(r=>r.currentStage==='维修完成'&&!Number.isFinite(r.completed)).length;
  return {generatedAt:now.toISOString(),range:{days,from:dateKey(start),to:dateKey(end-DAY),previousFrom:dateKey(previousStart),previousTo:dateKey(start-DAY)},
    kpis:{orders:metric(current.length,previous.length),completed:metric(done.length,previousDone.length),vehicles:metric(vehicles.length,new Set(previous.map(r=>r.vehicle).filter(Boolean)).size),cycleDays:{value:median(cycles),previous:median(previousCycles),samples:cycles.length}},
    daily,monthly,customers:topCustomers,customerCount:customers.filter(c=>c.name!=='未登记单位').length,
    vehicleMix:[{name:'首次记录车辆',value:newVehicles},{name:'历史到店车辆',value:vehicles.length-newVehicles}],
    status:group(rows,r=>r.currentStage),aging,cycleBuckets,
    execution:group(current,r=>({internal:'店内维修',field:'员工外修',outsourced:'外包维修'}[r.executionMode]||'尚未安排 / 未记录')),
    liveCount:live.length,quality:{missingCompletion,missingVehicle:current.filter(r=>!r.vehicle).length,
      invalidCreated:input.filter(r=>!['草稿','待处理纸质委托书'].includes(r.status)&&!Number.isFinite(timestamp(r.createdAt))).length}};
}
