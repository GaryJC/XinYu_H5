import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePartsPickupNotification} from '../server/repositories/partsRequirementRepository.mjs';
const user={id:'a',role:'technician',active:true,shopId:'s'};
for(const grouped of [false,true]) {
 const row={kind:'配件可领取',recipient_id:'a',order_id:'o',payload:{shopId:'s',repairRound:0,...(grouped?{preparationGroups:[{partsOwnerId:'a',partsRecordedAt:'recorded',partsRevision:1,items:[{index:0,preparedAt:'prepared'}]}]}:{partsOwnerId:'a',partsRecordedAt:'recorded',partsRevision:1,partsPreparation:[{index:0,preparedAt:'prepared'}]})}};
 const task=()=>({stage:'维修中',technician_id:'a',data:{technicianIds:['a','b'],partsRequests:[{ownerId:'a',recordedAt:'recorded',revision:1,items:[{name:'滤芯',recipientId:'a',preparedAt:'prepared'}]}]}});
 const check=t=>validatePartsPickupNotification(row,user,{query:async()=>({rows:[t]})});
 test(`${grouped?'grouped':'individual'} pickup notices expire when the repair leaves the material workflow`,async()=>{
  const t=task();assert.equal(await check(t),true);
  for(const stage of ['待派工','待接单','待检验','维修完成'])assert.equal(await check({...t,stage}),false,stage);
  for(const stage of ['待开工','维修中','暂停','回审'])assert.equal(await check({...t,stage}),true,stage);
 });
 test(`${grouped?'grouped':'individual'} pickup notices expire when the notified material was already issued`,async()=>{
  const t=task();t.data.partsRequests[0].items[0].issuedAt='issued';
  assert.equal(await check(t),false);
 });
}
