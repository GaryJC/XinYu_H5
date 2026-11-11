import test from 'node:test';
import assert from 'node:assert/strict';
import {queueDueReminders,validateDueReminder} from '../server/workers/dueReminders.mjs';
import {dueReminderCandidates,queueDueReminder} from '../server/repositories/dueReminderRepository.mjs';
test('retired deadline entry points never read the database, roster or enqueue work',async()=>{
 const unexpected=()=>assert.fail('deadline reminders must perform no I/O');
 const database={query:unexpected};
 for(const hours of [48,24,1,0]) {
  const now=Date.now()+hours*3600000;
  assert.equal(await queueDueReminders({now,runTransaction:unexpected,candidates:unexpected,people:unexpected,queue:unexpected}),0);
  assert.deepEqual(await dueReminderCandidates(database,now),[]);
  assert.equal(await queueDueReminder(database,{dueAt:new Date(now).toISOString()},[{id:'worker'}],hours*60),0);
  assert.equal(await validateDueReminder({kind:'即将到期'},{active:true},{database,now}),false);
 }
});
