import test from 'node:test';
import assert from 'node:assert/strict';
import {isOrderEntryRequest} from '../server/domain/orderEntryAccess.mjs';
import {requireTransitionRole} from '../server/domain/accessPolicy.mjs';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {assertWorkOrderAccess,assertOcrRecordAccess}=await import('../server/repositories/accessRepository.mjs');
const {assertFileAccess}=await import('../server/repositories/fileRepository.mjs');
const roles=['employee','advisor','technician','inspector','warehouse','outsourcing'];
for(const role of roles) test(`${role} can access own order and uploads, never another employee or shop`,async()=>{
 const user={id:'u1',name:'员工甲',role,active:true,shopId:'shop-1'};
 const database={query:async()=>({rows:[{advisor:'员工甲',shop_id:'shop-1',uploaded_by:'u1'}]})};
 await assertWorkOrderAccess('o1',user,database);
 await assertOcrRecordAccess('ocr1',user,database);
 await assertFileAccess('f1',user,database);
 for(const stranger of [{...user,id:'u2',name:'员工乙'},{...user,shopId:'shop-2'}]) {
  await assert.rejects(()=>assertWorkOrderAccess('o1',stranger,database),e=>e.status===403);
  await assert.rejects(()=>assertFileAccess('f1',stranger,database),e=>e.status===403);
 }
 if(role!=='advisor')assert.throws(()=>requireTransitionRole(user,'待派工'),e=>e.status===403);
});
test('entry bypass covers creation dependencies but excludes management and dispatch',()=>{
 for(const [method,path] of [['POST','/api/work-orders'],['PUT','/api/work-orders/o1'],['GET','/api/work-orders/o1'],['POST','/api/files'],['POST','/api/work-orders/o1/signature-token'],['POST','/api/signatures/token/sign'],['POST','/api/ocr/vin'],['GET','/api/company-system/departments'],['POST','/api/work-orders/o1/paper-order/submit']])assert.equal(isOrderEntryRequest(method,path),true,`${method} ${path}`);
 for(const path of ['/api/dispatch/tasks','/api/admin/access-users','/api/work-orders/o1/transition','/api/work-orders/o1/confirm-customer-signature','/api/work-orders/o1/settlement-statements'])for(const method of ['GET','POST'])assert.equal(isOrderEntryRequest(method,path),false);
});

test('opening photo previews use the actual content route, including thumbnail query variants',()=>{
 for(const source of ['/api/files/f1/content','/api/files/f1/content?size=thumbnail']) {
  assert.equal(isOrderEntryRequest('GET',new URL(source,'http://local').pathname),true);
 }
 for(const path of ['/api/files/f1','/api/files/f1/thumbnail','/api/files/f1/delete'])assert.equal(isOrderEntryRequest('GET',path),false);
});
