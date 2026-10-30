import {procurementWinnerIds} from '../../shared/procurementWinners.mjs';
import { median,validQuote,latestQuote } from '../domain/procurement.mjs';
const ratio=(a,b)=>b?Math.round(a/b*1000)/10:null;
function eligible(tenders) {return tenders.filter(t=>['closed','awarded','failed'].includes(t.status));}
export function analyze(tenders,range) {
  const rows=eligible(tenders),metrics=new Map(),monthly=new Map();
  for(const tender of rows) {
    const month=tender.closedAt.slice(0,7);
    if(!monthly.has(month)) monthly.set(month,{month,total:0,awarded:0,failed:0});
    const period=monthly.get(month);period.total++;if(tender.status==='awarded')period.awarded++;if(tender.status==='failed')period.failed++;
    const valid=tender.invitations.filter(i=>validQuote(tender,i)),benchmark=median(valid.map(i=>latestQuote(i).totalFen));
    const ids=procurementWinnerIds(tender),winner=ids.length===1?tender.invitations.find(i=>i.supplierId===ids[0]):undefined;
    for(const i of tender.invitations) {
      if(!metrics.has(i.supplierId))metrics.set(i.supplierId,{supplierId:i.supplierId,supplierName:i.supplierName,invited:0,quoted:0,valid:0,awarded:0,lost:0,missed:0,declined:0,invalid:0,pending:0,participatedFailed:0,awardAmountFen:0,priceLost:0,opportunityFen:0,indexes:[],settledValid:0});
      const m=metrics.get(i.supplierId),q=latestQuote(i),isValid=validQuote(tender,i),settled=tender.status!=='closed';m.invited++;
      if(!q)m.missed++;else if(q.declined)m.declined++;else {m.quoted++;if(isValid)m.valid++;else m.invalid++;}
      if(!settled)m.pending++;
      if(tender.status==='failed')m.participatedFailed++;
      if(settled&&isValid)m.settledValid++;
      if(ids.includes(i.supplierId)&&tender.status==='awarded'){m.awarded++;if(ids.length===1)m.awardAmountFen+=q.totalFen;}
      else if(settled&&isValid){m.lost++;if(winner&&!tender.reason&&q.totalFen>latestQuote(winner).totalFen){m.priceLost++;m.opportunityFen+=latestQuote(winner).totalFen;}}
      if(settled&&isValid&&valid.length>=2)m.indexes.push(q.totalFen/benchmark*100);
    }
  }
  const suppliers=[...metrics.values()].map(({indexes,settledValid,...m})=>({...m,responseRate:ratio(m.quoted,m.invited),winRate:ratio(m.awarded,settledValid),priceIndex:indexes.length?Math.round(median(indexes)*10)/10:null,priceSamples:indexes.length})).sort((a,b)=>b.awarded-a.awarded||b.awardAmountFen-a.awardAmountFen);
  return {...range,total:rows.length,awarded:rows.filter(t=>t.status==='awarded').length,failed:rows.filter(t=>t.status==='failed').length,pending:rows.filter(t=>t.status==='closed').length,awardAmountFen:suppliers.reduce((n,s)=>n+s.awardAmountFen,0),suppliers,months:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month))};
}
export function gapBand(value) {
  const low=Math.floor(Math.round(value*100000)/1000/5)*5;
  if(low>=0)return `高于同行 ${low}%～${low+5}%`;
  if(low+5<=0)return `低于同行 ${Math.abs(low+5)}%～${Math.abs(low)}%`;
  return '接近同行';
}
function publicBenchmark(samples) {
  const ids=new Set(samples.flatMap(s=>s.competitors));
  const enough=samples.length>=5&&ids.size>=5;
  return {samples:samples.length,competitorCount:ids.size,gapBand:enough?gapBand(median(samples.map(s=>s.gap))):null,
    below:enough?samples.filter(s=>s.gap<-.05).length:0,near:enough?samples.filter(s=>s.gap>=-.05&&s.gap<=.05).length:0,above:enough?samples.filter(s=>s.gap>.05).length:0};
}
export function supplierReport(tenders,supplier,range,{id,note='',now=new Date().toISOString()}={}) {
  const metrics=analyze(tenders,range).suppliers.find(m=>m.supplierId===supplier.id)||{supplierId:supplier.id,supplierName:supplier.name,invited:0,quoted:0,valid:0,awarded:0,lost:0,missed:0,declined:0,invalid:0,pending:0,participatedFailed:0,awardAmountFen:0,responseRate:null,winRate:null,priceLost:0};
  const {priceIndex,priceSamples,opportunityFen,...safeMetrics}=metrics;
  const samples=[],quarters=new Map();
  for(const t of eligible(tenders).filter(t=>t.status!=='closed')) {
    const own=t.invitations.find(i=>i.supplierId===supplier.id);if(!own)continue;
    const d=new Date(t.closedAt),quarter=`${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth()/3)+1}`;
    if(!quarters.has(quarter))quarters.set(quarter,{quarter,quoted:0,awarded:0,items:[]});
    const p=quarters.get(quarter),q=latestQuote(own);if(q&&!q.declined)p.quoted++;if(procurementWinnerIds(t).includes(supplier.id))p.awarded++;
    if(t.status!=='awarded'||!validQuote(t,own))continue;
    const others=t.invitations.filter(i=>i.supplierId!==supplier.id&&validQuote(t,i));
    if(others.length<3)continue;
    const sample={category:t.data.category,gap:q.totalFen/median(others.map(i=>latestQuote(i).totalFen))-1,competitors:others.map(i=>i.supplierId)};
    samples.push(sample);p.items.push(sample);
  }
  const categories=[...new Set(samples.map(s=>s.category))].map(category=>({category,...publicBenchmark(samples.filter(s=>s.category===category))})).filter(b=>b.gapBand).map(({category,samples,gapBand})=>({category,samples,gapBand}));
  return {id,supplierName:supplier.name,...range,generatedAt:now,note,metrics:safeMetrics,benchmark:publicBenchmark(samples),categories,
    quarters:[...quarters.values()].map(({items,...p})=>{const b=publicBenchmark(items);return {...p,samples:b.samples,gapBand:b.gapBand};}).sort((a,b)=>a.quarter.localeCompare(b.quarter))};
}
