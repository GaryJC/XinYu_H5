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
 for(const [day,bucket] of [['2026-11-23',null],['2026-11-24',30],['2026-12-17',7],['2026-12-23',1],['2026-12-24',0],['2026-12-25',-1]])assert.equal(insuranceReminder(car.insuranceEnd,day),bucket);
});
test('Excel keeps all supplied details, parses dotted date range and rejects duplicate or invalid rows',async()=>{
 const [car]=await parseInsuranceWorkbook(workbook([row]));assert.equal(car.insuranceEnd,'2026-12-24');assert.equal(car.insuranceDetails.registrationNote,'2024--12--24');assert.equal(car.insuranceDetails.owner,'产权');
 await assert.rejects(parseInsuranceWorkbook(workbook([row,row])),/重复/);
 await assert.rejects(parseInsuranceWorkbook(workbook([[...row.slice(0,5),'2026.2.30-2026.3.1',...row.slice(6)]])),/日期无效/);
});
