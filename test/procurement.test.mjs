import { procurementTotalFen } from '../shared/procurementMoney.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { procurementAccess,quoteInput,tenderInput,settlement,effectiveStatus } from '../server/domain/procurement.mjs';
import { analyze,supplierReport } from '../server/services/procurementAnalytics.mjs';
const date='2026-10-15T10:00:00.000Z';
const terms={partName:'刹车片',vin:'LSVAB1234A1234567',category:'制动',specification:'P-1',brand:'指定品牌',quantity:2,unit:'件',deliveryAddress:'门店',deliveryBy:'2026-12-01T00:00:00.000Z',paymentTerms:'含税含运费',qualityRequirements:'原厂',imageUrls:[]};
const offer=(id,price,extra={})=>({id,supplierId:id,supplierName:id,invalidReason:'',quotes:[{totalFen:price,deliveryAt:date,meetsRequirements:true,declined:false,...extra}]});
const tender=(id,invitations,extra={})=>({id,data:terms,status:'awarded',closedAt:date,winnerId:invitations[0].supplierId,invitations,...extra});
test('procurement belongs exclusively to active store managers and warehouse staff',()=>{
  for(const role of ['manager','warehouse'])assert.doesNotThrow(()=>procurementAccess({role,active:true,shopId:'s'}));
  for(const role of ['advisor','technician','inspector'])assert.throws(()=>procurementAccess({role,active:true,shopId:'s'}),e=>e.status===403);
  assert.throws(()=>procurementAccess({role:'manager',active:false,shopId:'s'}));
});
test('quote validation, money, deadline boundary and final effective lowest-price settlement',()=>{
  const q=quoteInput({requestId:randomUUID(),unitPriceFen:10000,freightFen:1500,deliveryAt:date,meetsRequirements:true,note:''},terms);
  assert.equal(q.totalFen,21500);
  assert.throws(()=>quoteInput({...q,unitPriceFen:1.2},terms),e=>e.status===400);
  assert.equal(effectiveStatus({status:'open',deadline:date},Date.parse(date)),'closed');
  const t=tender('x',[offer('a',100),offer('b',90),offer('c',80,{meetsRequirements:false})],{status:'closed'});
  assert.equal(settlement(t,{action:'settle',winnerId:'a'}).winnerId,'b','cannot choose a higher valid quote');
  t.invitations[0].quotes[0].totalFen=90;
  assert.throws(()=>settlement(t,{action:'settle',winnerId:'b'}),e=>e.status===400);
  assert.equal(settlement(t,{action:'settle',winnerId:'b',reason:'交期更好'}).winnerId,'b');
  assert.equal(settlement({...t,invitations:[]},{action:'settle'}).status,'failed');
  assert.equal(settlement({...t,invitations:[offer('a',100)]},{action:'settle'}).winnerId,'a');
  assert.throws(()=>settlement(t,{action:'cancel'}),e=>e.status===400);
});
test('tender accepts only one part and validates comparable conditions and supplier IDs',()=>{
  const input={...terms,requestId:randomUUID(),supplierIds:[randomUUID()],deadline:'2026-11-01T00:00:00Z'};
  assert.equal(tenderInput(input,Date.parse(date)).data.quantity,2);
  assert.throws(()=>tenderInput({...input,supplierIds:[input.supplierIds[0],input.supplierIds[0]]},Date.parse(date)));
  assert.throws(()=>tenderInput({...input,quantity:0},Date.parse(date)));
  assert.throws(()=>tenderInput({...input,imageUrls:['javascript:alert(1)']},Date.parse(date)));
});
test('analysis separates missed, declined, invalid, lost, failed and pending with stable denominators',()=>{
  const rows=[tender('1',[offer('a',100),offer('b',120)]),
    tender('2',[{...offer('a',100),quotes:[]},offer('b',120,{declined:true})],{status:'failed',winnerId:null}),
    tender('3',[offer('a',200,{meetsRequirements:false}),offer('b',120)],{winnerId:'b'}),
    tender('4',[offer('a',90),offer('b',120)],{status:'closed',winnerId:null}),
    tender('cancel',[offer('a',90)],{status:'cancelled'})];
  const a=analyze(rows,{from:date,to:'2026-11-01T00:00:00Z'}),supplier=a.suppliers.find(s=>s.supplierId==='a');
  assert.equal(a.total,4);assert.equal(a.pending,1);assert.equal(a.failed,1);
  assert.equal(supplier.invited,4);assert.equal(supplier.quoted,3);assert.equal(supplier.invalid,1);assert.equal(supplier.missed,1);assert.equal(supplier.awarded,1);assert.equal(supplier.winRate,100);assert.equal(supplier.priceSamples,1);
  assert.equal(a.suppliers.find(s=>s.supplierId==='b').declined,1);
});
test('external report excludes self from anonymous benchmark and never includes competitors or exact prices',()=>{
  const rows=Array.from({length:5},(_,n)=>tender(String(n),[offer('own',12000),offer(`other${n}`,10000),offer(`other${n+1}`,10000),offer(`other${n+2}`,10000)],{winnerId:`other${n}`}));
  const report=supplierReport(rows,{id:'own',name:'自家供应商'},{from:date,to:'2026-11-01T00:00:00Z'},{id:'r'});
  assert.equal(report.benchmark.gapBand,'高于同行 20%～25%');assert.equal(report.benchmark.samples,5);assert.ok(report.benchmark.competitorCount>=5);
  assert.doesNotMatch(JSON.stringify(report),/other\d|totalFen|priceIndex|opportunityFen|invitation/);
  assert.equal(supplierReport(rows.slice(0,4),{id:'own',name:'S'},{from:date,to:date}).benchmark.gapBand,null);
  assert.equal(supplierReport(rows.map(t=>({...t,invitations:t.invitations.slice(0,3)})),{id:'own',name:'S'},{from:date,to:date}).benchmark.samples,0);
  assert.equal(supplierReport(rows.map(t=>({...t,status:'closed'})),{id:'own',name:'S'},{from:date,to:date}).benchmark.samples,0);
  assert.equal(supplierReport(rows.map(t=>({...t,status:'failed'})),{id:'own',name:'S'},{from:date,to:date}).benchmark.samples,0);
});

test('fractional quantities round money exactly without floating point drift',()=>{
  assert.equal(procurementTotalFen(100,1.005,0),101);
  assert.equal(procurementTotalFen(1,0.499,0),0);
  assert.equal(procurementTotalFen(1,0.5,0),1);
  assert.equal(procurementTotalFen(19999,1.125,350),22849);
});

test('quotes for superseded procurement requirements are excluded from settlement',()=>{
  const t=tender('revision',[offer('a',100),offer('b',120,{termsVersion:2})],{status:'closed',termsVersion:2});
  assert.equal(settlement(t,{action:'settle'}).winnerId,'b');
});

test('new procurement permits omitted VIN, classification, specification and brand',()=>{
 const input={...terms,requestId:randomUUID(),supplierIds:[randomUUID()],deadline:null};
 const result=tenderInput({...input,category:undefined,specification:undefined,brand:undefined},Date.parse(date));
 assert.equal(result.data.vin,terms.vin);assert.equal(result.data.category,'');assert.equal(result.data.specification,'');assert.equal(result.data.brand,'');
 for(const vin of [undefined,null,'','   '])assert.equal(tenderInput({...input,vin},Date.parse(date)).data.vin,'');
 assert.equal(tenderInput({...input,vin:terms.vin.toLowerCase()},Date.parse(date)).data.vin,terms.vin);
 for(const vin of ['ABC','LSVAB1234A123456I',123])assert.throws(()=>tenderInput({...input,vin},Date.parse(date)),e=>e.status===400);
 for(const nameplatePhotoIds of [['invalid'],['file_a','file_b'],['file_same','file_same']])assert.throws(()=>tenderInput({...input,nameplatePhotoIds},Date.parse(date)),e=>e.status===400);
});

test('tender photos allow one nameplate and ten distinct supporting images',()=>{
 const input={...terms,requestId:randomUUID(),supplierIds:[randomUUID()],deadline:null,nameplatePhotoIds:['file_plate']};
 const otherPhotoIds=Array.from({length:10},(_,i)=>`file_other_${i}`);
 assert.deepEqual(tenderInput({...input,otherPhotoIds},Date.parse(date)).data.otherPhotoIds,otherPhotoIds);
 for(const ids of [[...otherPhotoIds,'file_extra'],['file_same','file_same'],['file_plate'],['invalid'],'file_other'])
  assert.throws(()=>tenderInput({...input,otherPhotoIds:ids},Date.parse(date)),e=>e.status===400);
 assert.deepEqual(tenderInput(input,Date.parse(date)).data.otherPhotoIds,[]);
});

test('payment requirements may be empty and removed unit defaults without altering legacy values',()=>{
  const input={...terms,requestId:randomUUID(),supplierIds:[randomUUID()],deadline:null};
  delete input.unit;delete input.paymentTerms;delete input.qualityRequirements;
  const next=tenderInput(input,Date.parse(date));
  assert.equal(next.data.unit,'件');assert.equal(next.data.paymentTerms,'');assert.equal(next.data.qualityRequirements,'');
  assert.equal(tenderInput({...input,paymentTerms:'  '},Date.parse(date)).data.paymentTerms,'');
  assert.equal(tenderInput({...input,unit:'套',qualityRequirements:'原厂'},Date.parse(date)).data.unit,'套');
  assert.throws(()=>tenderInput({...input,paymentTerms:'a'.repeat(501)},Date.parse(date)),e=>e.status===400);
});
