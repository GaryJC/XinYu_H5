import test from 'node:test';
import assert from 'node:assert/strict';
import {dueReminderWindow,dueReminderRecipients,isCurrentDueReminder} from '../server/domain/dueReminderPolicy.mjs';
const now=Date.parse('2026-10-15T00:00:00Z');
const task=(hours,extra={})=>({shopId:'s',stage:'维修中',orderStatus:'维修中',dueAt:new Date(now+hours*3600000).toISOString(),technicianId:'t',technicianIds:['t','t2'],...extra});
const tech={id:'t',shopId:'s',role:'technician',active:true};
test('48 hour, 24 hour and 1 hour boundaries do not backfill earlier reminders',()=>{
 for(const [hours,window] of [[49,undefined],[48,2880],[24.01,2880],[24,1440],[1.01,1440],[1,60],[0.01,60],[0,undefined],[-1,undefined]])assert.equal(dueReminderWindow(task(hours),now),window);
 assert.equal(dueReminderWindow(task(1,{dueAt:'invalid'}),now),undefined);
});
test('only current active same-store technicians on eligible orders receive reminders',()=>{
 const people=[tech,{...tech,id:'t2'},{...tech,id:'t3'},{...tech,id:'t2',active:false},{...tech,id:'t2',role:'advisor'},{...tech,id:'t2',shopId:'other'}];
 assert.deepEqual(dueReminderRecipients(task(2),people,now).map(p=>p.id),['t','t2']);
 for(const extra of [{stage:'待检验'},{stage:'维修完成'},{executionMode:'outsourced'},{feedback:'无法接单'},{needsReview:true},{orderStatus:'完成'},{orderStatus:'草稿'},{orderStatus:'待客户签字'}])assert.equal(dueReminderRecipients(task(2,extra),people,now).length,0);
 assert.equal(dueReminderWindow(task(2,{stage:'暂停'}),now),1440);
});
test('queued reminders become obsolete after a new window, reassignment, reschedule or submission',()=>{
 const t=task(2),notification={payload:{dueAt:t.dueAt,leadMinutes:1440}};
 assert.equal(isCurrentDueReminder(t,notification,tech,now),true);
 for(const changed of [{...t,stage:'待检验'},{...t,dueAt:task(3).dueAt},{...t,technicianIds:['t2'],technicianId:'t2'}])assert.equal(isCurrentDueReminder(changed,notification,tech,now),false);
 assert.equal(isCurrentDueReminder(t,notification,tech,now+3600000),false);
 assert.equal(isCurrentDueReminder(t,notification,{...tech,active:false},now),false);
});
