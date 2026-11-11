import test from 'node:test';
import assert from 'node:assert/strict';
import {canReceiveInspectionNotification} from '../server/domain/inspectionNotificationAudience.mjs';
import {canInspect} from '../server/domain/dispatchPolicy.mjs';
process.env.DATABASE_URL||='postgres://unused:unused@127.0.0.1:1/unused';
const {validateInspectionRecipient}=await import('../server/repositories/dispatchRepository.mjs');
const task={shopId:'s',stage:'待检验',technicianIds:['worker'],participantIds:['previous-worker'],items:[{id:1,status:'待检验',responsibleId:'worker'}]};
const inspector={id:'i',shopId:'s',active:true,role:'manager',roles:['manager','inspector'],inspectorRoleMember:true};

test('notification audience requires actual inspector membership while managers retain inspection permission',()=>{
 const manager={...inspector,roles:['manager'],inspectorRoleMember:false};
 assert.equal(canInspect(task,manager),true);
 assert.equal(canReceiveInspectionNotification(task,manager),false);
 assert.equal(canReceiveInspectionNotification(task,inspector),true);
 for(const change of [{active:false},{shopId:'other'},{inspectorRoleMember:false},{id:'worker'},{id:'previous-worker'}]) {
  assert.equal(canReceiveInspectionNotification(task,{...inspector,...change}),false);
 }
});

test('queued inspection notices cannot revive after a later submission or repair round',async()=>{
 const notice={order_id:'o',event_id:'99',recipient_id:'i',kind:'待检验'};
 const row={order_id:'o',shop_id:'s',order_status:'维修中',stage:'待检验',technician_id:'worker',repair_items:[],data:task,
  notification_event_id:'99',notification_event_detail:{repairRound:0},latest_inspection_event_id:'99'};
 const validate=patch=>validateInspectionRecipient(notice,inspector,{query:async(sql,params)=>{
  assert.deepEqual(params,['o','99']);assert.match(sql,/e\.action in \('submit','reassign-inspection'\)/);
  return {rows:[{...row,...patch}]};
 }});
 assert.equal(await validate({}),true);
 assert.equal(await validate({notification_event_id:null}),false,'deleted or foreign source event is not valid');
 assert.equal(await validate({latest_inspection_event_id:'100'}),false,'new submissions supersede old notices');
 assert.equal(await validate({data:{...task,repairRound:1}}),false,'reopened repairs do not revive old notices');
 assert.equal(await validate({notification_event_detail:{repairRound:1}}),false,'a different source round is rejected');
 assert.equal(await validate({inspector_id:'another'}),false,'inspection reassignment still revokes old recipients');
 assert.equal(await validate({inspector_id:'i'}),true,'the current directly assigned inspector remains eligible');
});
