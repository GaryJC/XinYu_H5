import test from 'node:test';import assert from 'node:assert/strict';
import {repairWritebackSimulationEnabled as enabled} from '../server/domain/repairWritebackSimulation.mjs';
const env={APP_ENV:'development',DATABASE_URL:'postgres://u:p@127.0.0.1/db',RUNFENG_REPAIR_WRITEBACK_MODE:'mock',RUNFENG_REPAIR_WRITEBACK_ENABLED:'false'};
test('simulation is explicit, local only and incompatible with real writes',()=>{
 assert.equal(enabled({...env,RUNFENG_REPAIR_WRITEBACK_MODE:undefined}),false);
 assert.equal(enabled(env),true);assert.equal(enabled({...env,APP_ENV:'test'}),true);
 for(const change of [{APP_ENV:'production'},{NODE_ENV:'production'},{DATABASE_URL:'postgres://u:p@production/db'},{DATABASE_URL:''},{RUNFENG_REPAIR_WRITEBACK_ENABLED:'true'}])assert.throws(()=>enabled({...env,...change}),/仅限本地/);
 assert.throws(()=>enabled({...env,RUNFENG_REPAIR_WRITEBACK_MOCK_RESULT:'invalid'}),/success/);
});
