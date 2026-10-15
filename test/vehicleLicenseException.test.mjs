import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVehicleLicenseRequirement} from '../server/domain/workOrderPolicy.mjs';
import {isCurrentLicenseException,validateLicenseExceptionInput} from '../server/domain/vehicleLicenseException.mjs';
import {licenseExceptionMessageBody} from '../server/integrations/dingtalk/licenseExceptionNotifications.mjs';
const vehicle={plate:'沪ATEST',vin:'LSVNV2182E2123456'};
const exception={id:'one',reason:'客户遗失行驶证，暂无法提供',vehiclePlate:vehicle.plate,vehicleVin:vehicle.vin};
test('new vehicles still require a license unless this vehicle has a recorded exception',()=>{
 assert.throws(()=>assertVehicleLicenseRequirement('new',false),e=>e.status===400);
 assert.doesNotThrow(()=>assertVehicleLicenseRequirement('new',true));
 assert.doesNotThrow(()=>assertVehicleLicenseRequirement('new',false,exception,vehicle));
 assert.throws(()=>assertVehicleLicenseRequirement('new',false,exception,{...vehicle,vin:'LSVNV2182E2123457'}),e=>e.status===400);
 assert.throws(()=>assertVehicleLicenseRequirement('new',false,exception,{...vehicle,plate:'沪OTHER'}),e=>e.status===400);
 assert.equal(isCurrentLicenseException({...exception,reason:' '},vehicle),false);
 for(const reason of ['', '  ', '字'.repeat(1001), null])assert.throws(()=>validateLicenseExceptionInput({reason,requestId:'valid-request'}),e=>e.status===400);
 assert.equal(validateLicenseExceptionInput({reason:'  证件遗失  ',requestId:'valid-request'}).reason,'证件遗失');
});
test('administrator notification includes explanation and opens order details with company context',()=>{
 const env={DINGTALK_AGENT_ID:'1',DISPATCH_APP_URL:'https://repair.example/?dispatchOrder=old',DINGTALK_CORP_ID:'ding-corp'};
 const body=licenseExceptionMessageBody({payload:{orderId:'WT-123',plate:vehicle.plate,vin:vehicle.vin,reason:exception.reason,shopName:'抚顺路店',advisor:'顾问甲',reportedName:'顾问甲',customerName:'测试单位'}},'manager-ding-id',env);
 assert.equal(body.userid_list,'manager-ding-id');assert.equal(body.to_all_user,false);
 for(const text of [exception.reason,vehicle.plate,vehicle.vin,'抚顺路店','WT-123','顾问甲','测试单位'])assert.ok(body.msg.markdown.text.includes(text));
 const url=new URL(body.msg.markdown.text.match(/\[查看委托单详情\]\(([^)]+)\)/)[1]);
 assert.equal(url.searchParams.get('workOrder'),'WT-123');assert.equal(url.searchParams.has('dispatchOrder'),false);assert.equal(url.searchParams.get('corpid'),'ding-corp');
});
