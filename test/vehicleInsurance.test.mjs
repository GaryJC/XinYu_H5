import test from 'node:test';import assert from 'node:assert/strict';
import {insuranceToday,insuranceState,insuranceReminder} from '../shared/vehicleInsurance.mjs';
import {insuranceInput,assertVehicleInsured} from '../server/domain/vehicleInsurance.mjs';
import {parseInsuranceWorkbook} from '../server/domain/vehicleInsuranceImport.mjs';
import XLSX from 'xlsx';
const workbook=rows=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['公司车辆保险承保明细表'],['序号','原车号','新车牌号','车型','登记及年审时间','保险终保时间','车辆状况','车辆使用部门','产权归属','投保付款单位','承保公司'],...rows]),'Sheet1');return XLSX.write(w,{type:'base64',bookType:'xlsx'});};
const row=[1,'旧车牌','鲁B12345','海鸥','2024--12--24','2025.12.25-2026.12.24','新车','业务','产权','付款','保险公司'];
test('insurance Shanghai end-of-day boundary, missing and future policy',()=>{
 assert.equal(insuranceToday(new Date('2026-12-24T16:00:00Z')),'2026-12-25');
 const car={insuranceStart:'2025-12-25',insuranceEnd:'2026-12-24'};
 assert.equal(insuranceState(car,'2026-12-24'),'保险有效');assert.equal(insuranceState(car,'2026-12-25'),'保险已到期');
 assert.equal(insuranceState(car,'2025-12-24'),'保险未生效');assert.throws(()=>assertVehicleInsured({}),/未录入保险/);
 assert.throws(()=>insuranceInput({insuranceStart:'2026-02-30',insuranceEnd:'2027-01-01'}),/日期无效/);
 assert.throws(()=>insuranceInput({insuranceStart:'2026-01-01'}),/完整/);
 for(const [day,bucket] of [['2026-11-23',null],['2026-11-24',null],['2026-12-17',7],['2026-12-18',null],['2026-12-22',null],['2026-12-23',1],['2026-12-24',null],['2026-12-25',null]])assert.equal(insuranceReminder(car.insuranceEnd,day),bucket);
});
test('Excel keeps all supplied details, parses dotted date range and rejects duplicate or invalid rows',async()=>{
 const [car]=await parseInsuranceWorkbook(workbook([row]));assert.equal(car.insuranceEnd,'2026-12-24');assert.equal(car.insuranceDetails.registrationNote,'2024--12--24');assert.equal(car.insuranceDetails.owner,'产权');
 await assert.rejects(parseInsuranceWorkbook(workbook([row,row])),/重复/);
 await assert.rejects(parseInsuranceWorkbook(workbook([[...row.slice(0,5),'2026.2.30-2026.3.1',...row.slice(6)]])),/日期无效/);
});

test('advisors maintain and import local vehicles without gaining trip approval',async()=>{
 process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
 const {createVehicleTripService}=await import('../server/services/vehicleTripService.mjs');
 const {assertTripAction,requireVehicleEditor}=await import('../server/domain/vehicleTrips.mjs');
 const {VehicleTripRepository}=await import('../server/repositories/vehicleTripRepository.mjs');
 const advisor={id:'advisor',shopId:'shop',active:true,role:'advisor'};
 const car={id:'car',shopId:'shop',plate:'鲁B12345',brand:'原品牌',model:'旧车型',active:false};
 const saved=[];const repo={transaction:fn=>fn(repo),getVehicle:async()=>car,listVehicles:async()=>[car],database:{query:async()=>({rows:[]})},saveVehicle:async(id,shopId,input,existing)=>{saved.push({id,shopId,input,existing});return {...input,id,shopId};}};
 const service=createVehicleTripService(repo);
 await service.saveVehicle(advisor,{...car,active:true},car.id);
 assert.equal(saved[0].input.active,true);
 const input={fileBase64:workbook([row]),preview:true};
 assert.equal((await service.importVehicles(advisor,input)).rows.length,1);
 assert.equal(saved.length,1);
 assert.equal((await service.importVehicles(advisor,{...input,preview:false})).count,1);
 assert.equal(saved[1].id,'car');assert.equal(saved[1].input.active,false);assert.equal(saved[1].input.brand,'原品牌');
 await assert.rejects(service.saveVehicle({...advisor,shopId:'other'},car,car.id),e=>e.status===404);
 for(const role of ['employee','technician','warehouse']) {
  assert.throws(()=>requireVehicleEditor({...advisor,role}),e=>e.status===403);
  await assert.rejects(service.importVehicles({...advisor,role},input),e=>e.status===403);
 }
 assert.throws(()=>requireVehicleEditor({...advisor,active:false}),e=>e.status===403);
 requireVehicleEditor({...advisor,role:'employee',roles:['employee','advisor']});
 assert.throws(()=>assertTripAction({applicantId:'other',shopId:'shop',status:'待审批'},advisor,'approve'),e=>e.status===403||e.status===404);
 const calls=[];const readRepo=new VehicleTripRepository({query:async(sql,params)=>{calls.push(params);return {rows:[]};}});
 await readRepo.listVehicles(advisor,true);assert.deepEqual(calls[0],['shop',true]);
 await readRepo.listVehicles({...advisor,role:'employee'},true);assert.deepEqual(calls[1],['shop',false]);
});
