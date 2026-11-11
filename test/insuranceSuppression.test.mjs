import test from 'node:test';
import assert from 'node:assert/strict';
import {queueInsuranceReminders,deliverInsuranceReminder,startVehicleInsuranceNotifications} from '../server/workers/vehicleInsuranceNotifications.mjs';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1/unused';
const {dueInsurance,queueInsurance,claimInsurance}=await import('../server/repositories/vehicleInsuranceRepository.mjs');
test('disabled insurance entry points perform no database, roster or sending work',async()=>{
 const unexpected=()=>assert.fail('insurance notifications must not perform I/O');
 const database={query:unexpected};
 await queueInsuranceReminders({database,sync:unexpected});
 assert.equal(await deliverInsuranceReminder({database,send:unexpected}),false);
 assert.deepEqual(await dueInsurance(database),[]);
 await queueInsurance(database,{},[]);
 assert.equal(await claimInsurance(database),undefined);
 await startVehicleInsuranceNotifications()();
});
