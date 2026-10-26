import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingRepairScheduleBlock} from '../shared/pendingRepairScheduling.mjs';
test('pending project scheduling explains unsigned, review and inspection restrictions',()=>{
 for(const stage of ['草稿','待客户签字','待处理纸质委托书','待检验'])assert.equal(typeof pendingRepairScheduleBlock(stage),'string');
 for(const stage of ['回审','待派工','待接单','待开工','维修中','暂停','维修完成'])assert.equal(pendingRepairScheduleBlock(stage),undefined);
});
