import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVehicleLicenseRequirement} from '../server/domain/workOrderPolicy.mjs';
import {isCurrentLicenseException,validateLicenseExceptionInput} from '../server/domain/vehicleLicenseException.mjs';
import {licenseExceptionMessageBody} from '../server/integrations/dingtalk/licenseExceptionNotifications.mjs';
import {mapLicenseException} from '../server/repositories/vehicleLicenseExceptionRepository.mjs';
const vehicle={plate:'沪ATEST',vin:'LSVNV2182E2123456'};
const exception={id:'one',reason:'客户遗失行驶证，暂无法提供',vehiclePlate:vehicle.plate,vehicleVin:vehicle.vin};
test('explicit strict license validation recognizes only exceptions for the current vehicle',()=>{
 assert.throws(()=>assertVehicleLicenseRequirement('new',false),e=>e.status===400);
 assert.doesNotThrow(()=>assertVehicleLicenseRequirement('new',true));
 assert.doesNotThrow(()=>assertVehicleLicenseRequirement('new',false,exception,vehicle));
 assert.throws(()=>assertVehicleLicenseRequirement('new',false,exception,{...vehicle,vin:'LSVNV2182E2123457'}),e=>e.status===400);
 assert.throws(()=>assertVehicleLicenseRequirement('new',false,exception,{...vehicle,plate:'沪OTHER'}),e=>e.status===400);
 assert.equal(isCurrentLicenseException({...exception,reason:' '},vehicle),false);
 for(const reason of ['', '  ', '字'.repeat(1001), null])assert.throws(()=>validateLicenseExceptionInput({reason,requestId:'valid-request'}),e=>e.status===400);
 assert.equal(validateLicenseExceptionInput({reason:'  证件遗失  ',requestId:'valid-request'}).reason,'证件遗失');
});
test('legacy administrator message formatting retains explanation and safe order links',()=>{
 const env={DINGTALK_AGENT_ID:'1',DISPATCH_APP_URL:'https://repair.example/?dispatchOrder=old',DINGTALK_CORP_ID:'ding-corp'};
 const body=licenseExceptionMessageBody({payload:{orderId:'WT-123',plate:vehicle.plate,vin:vehicle.vin,reason:exception.reason,shopName:'抚顺路店',advisor:'顾问甲',reportedName:'顾问甲',customerName:'测试单位'}},'manager-ding-id',env);
 assert.equal(body.userid_list,'manager-ding-id');assert.equal(body.to_all_user,false);
 for(const text of [exception.reason,vehicle.plate,vehicle.vin,'抚顺路店','WT-123','顾问甲','测试单位'])assert.ok(body.msg.markdown.text.includes(text));
 const url=new URL(body.msg.markdown.text.match(/\[查看委托单详情\]\(([^)]+)\)/)[1]);
 assert.equal(url.searchParams.get('workOrder'),'WT-123');assert.equal(url.searchParams.has('dispatchOrder'),false);assert.equal(url.searchParams.get('corpid'),'ding-corp');
});

test('suppressed license notices preserve actual historical delivery status without implying pending work',()=>{
 const row={id:'one',reported_at:'2026-11-11T00:00:00Z',status:'suppressed',error:'old error'};
 assert.equal(mapLicenseException(row).notificationStatus,'suppressed');
 assert.equal(mapLicenseException(row).notificationError,'');
 assert.equal(mapLicenseException({...row,status:'queued',delivery_total:2,delivery_suppressed:2}).notificationStatus,'suppressed');
 assert.equal(mapLicenseException({...row,delivery_total:2,delivery_suppressed:1,delivery_accepted:1}).notificationStatus,'accepted');
 assert.equal(mapLicenseException({...row,delivery_total:2,delivery_suppressed:1,delivery_sent:1}).notificationStatus,'sent');
 assert.equal(mapLicenseException({...row,delivery_total:2,delivery_suppressed:1,delivery_unknown:1}).notificationStatus,'unknown');
 assert.equal(mapLicenseException({...row,delivery_total:2,delivery_suppressed:1,delivery_failed:1}).notificationStatus,'failed');
});

test('license background entry points perform no database, roster or delivery work even in DingTalk mode',async()=>{
 const worker=await import('../server/workers/vehicleLicenseExceptionNotifications.mjs');
 const forbidden=()=>assert.fail('suppressed license notification must not do background work');
 const options={database:{query:forbidden},runTransaction:forbidden,sync:forbidden,send:forbidden,query:forbidden,env:{DISPATCH_NOTIFICATION_MODE:'dingtalk'}};
 assert.equal(await worker.resolveLicenseExceptionManagers(options),false);
 assert.equal(await worker.processLicenseExceptionNotification(options),false);
 const stop=worker.startVehicleLicenseExceptionNotifications();await stop();
 process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
 const repository=await import('../server/repositories/vehicleLicenseNotificationRepository.mjs');
 assert.equal(await repository.claimLicenseResolution(options.database),undefined);
 assert.equal(await repository.claimLicenseDelivery(options.database),undefined);
 await repository.queueLicenseManagers({id:'old-job'},['manager'],forbidden);
 await repository.failLicenseResolution({id:'old-job'},'old failure',options.database);
});

test('license requirement applies to existing, new and unqueried vehicles',()=>{
 for(const status of ['new','found',undefined,'error']) {
  assert.throws(()=>assertVehicleLicenseRequirement(status,false,undefined,vehicle),/行驶证/);
  assert.doesNotThrow(()=>assertVehicleLicenseRequirement(status,true,undefined,vehicle));
  assert.doesNotThrow(()=>assertVehicleLicenseRequirement(status,false,exception,vehicle));
  assert.throws(()=>assertVehicleLicenseRequirement(status,false,{...exception,reason:' '},vehicle),/行驶证/);
 }
});
