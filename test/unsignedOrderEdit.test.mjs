import test from 'node:test';
import assert from 'node:assert/strict';
import {isUnsignedOrderEditable} from '../shared/workOrderEditPolicy.mjs';
import {assertDraftEditable} from '../server/domain/workOrderPolicy.mjs';
test('unsigned remote-signature orders remain editable alongside drafts',()=>{
 for(const status of ['草稿','待客户签字']) {
  const order={status,signatures:{}};assert.equal(isUnsignedOrderEditable(order),true);
  assert.doesNotThrow(()=>assertDraftEditable(status,order));
 }
});
test('signed pending-review orders and submitted orders are locked',()=>{
 for(const patch of [{signatures:{customer:'signed'}},{customerSignatureFileId:'file'},{signatureTokenUsed:true},{customerSignatureReview:{state:'pending'}},{paperOrder:{mode:'dingtalk'}},...['已委托','待派工','维修中','待结算','完成'].map(status=>({status}))]) {
  const order={status:'待客户签字',...patch};assert.equal(isUnsignedOrderEditable(order),false);
  assert.throws(()=>assertDraftEditable(order.status,order),e=>e.status===409);
 }
});
