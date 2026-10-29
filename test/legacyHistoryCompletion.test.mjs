import test from 'node:test';
import assert from 'node:assert/strict';
import {historyCompletionReason as reason} from '../server/domain/legacyHistoryCompletion.mjs';
const cutoff='2026-10-21T03:15:00.732Z';
const order={id:'WT-1',dispatch_no:'A1',vehicle_plate:'鲁 B12345',department_code:'A',legacy_document_no:10,status:'已委托',created_at:'2026-10-20T00:00:00Z',legacy_sync_status:'synced',has_activity:false,pending_sync:false};
const header={pgd:'A1',plate:'鲁B12345',department:'A',dh:10,wd:'',approved:'1',arrival:'2026.10.20',marker:'H5:WT-1'};
test('only verified historical internal approvals qualify; whitespace is not a different plate',()=>{
 assert.equal(reason(order,[header],cutoff),null);
 assert.equal(reason({...order,created_at:'2026-10-26T00:00:00Z'},[header],cutoff),null);
 for(const patch of [{status:'完成'},{has_activity:true},{pending_sync:true},{legacy_sync_status:'pending'},{department_code:''},{legacy_document_no:null},{vehicle_plate:'鲁B54321'}]) assert.ok(reason({...order,...patch},[header],cutoff));
 for(const patch of [{approved:''},{deleted:'1'},{pgd:'A2'},{dh:11},{department:'B'},{plate:'鲁B54321'},{marker:'H5:WT-2'}]) assert.ok(reason(order,[{...header,...patch}],cutoff));
 assert.ok(reason(order,[{...header,approved:''},{...header,wd:'1'}],cutoff));
 assert.ok(reason(order,[header,header],cutoff));
 assert.ok(reason(order,[],cutoff));
 assert.ok(reason(order,[header],'invalid'));
 assert.ok(reason({...order,created_at:'2026-10-22T00:00:00Z'},[{...header,arrival:'2026.10.22'}],cutoff));
});
