import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseApproval} from '../server/domain/procurementApproval.mjs';
const warehouse={id:'w',name:'仓管',role:'warehouse'},manager={id:'m',name:'管理员',role:'manager'};
const tender={status:'awarded',version:3,termsVersion:1,winnerId:'supplier',data:{partName:'滤芯',quantity:2,unit:'个',specification:'原厂'},invitations:[{supplierId:'supplier',supplierName:'供应商',quotes:[{termsVersion:1,unitPriceFen:1000,freightFen:200,totalFen:2200}]}]};
const input={action:'submit-approval',expectedVersion:3,paymentMethod:'现金',recipientUnit:'门店',contactName:'联系人',phone:'13800000000',handlerPhone:'13900000000',invoice:'专票',note:'',customerAmountFen:3000};
test('approval freezes server-owned winning quote and validates warehouse, completion and inputs',()=>{
 const result=purchaseApproval(tender,warehouse,{...input,totalFen:1},'2026-10-29T20:00:00Z');
 assert.equal(result.snapshot.totalFen,2200);assert.equal(result.snapshot.purchaseDate,'2026-10-30');assert.equal(result.status,'pending');
 for(const status of ['open','closed','failed','cancelled'])assert.throws(()=>purchaseApproval({...tender,status},warehouse,input));
 assert.throws(()=>purchaseApproval(tender,manager,input),e=>e.status===403);
 for(const patch of [{phone:''},{paymentMethod:'其他'},{customerAmountFen:-1},{customerAmountFen:1.5},{expectedVersion:1}])assert.throws(()=>purchaseApproval(tender,warehouse,{...input,...patch}));
});
test('only another manager can review pending approval, rejection needs reason, resubmission freezes new revision',()=>{
 const purchase=purchaseApproval(tender,warehouse,input),current={...tender,purchaseApproval:purchase};
 assert.throws(()=>purchaseApproval(current,warehouse,{action:'approve-purchase',expectedVersion:3}),e=>e.status===403);
 assert.throws(()=>purchaseApproval(current,{...manager,id:'w'},{action:'approve-purchase',expectedVersion:3}),e=>e.status===403);
 assert.throws(()=>purchaseApproval(current,manager,{action:'reject-purchase',expectedVersion:3}));
 const rejected=purchaseApproval(current,manager,{action:'reject-purchase',expectedVersion:3,reason:'补充发票'});
 assert.equal(rejected.status,'rejected');
 const resubmitted=purchaseApproval({...tender,purchaseApproval:rejected},warehouse,{...input,invoice:'已确认专票'});
 assert.equal(resubmitted.reviewedBy,undefined);assert.equal(resubmitted.snapshot.invoice,'已确认专票');
 const approved=purchaseApproval(current,manager,{action:'approve-purchase',expectedVersion:3});
 assert.equal(approved.status,'approved');assert.deepEqual(approved.snapshot,purchase.snapshot);
 assert.throws(()=>purchaseApproval({...tender,purchaseApproval:approved},warehouse,input));
});
