import test from 'node:test';
import assert from 'node:assert/strict';
import {canRegisterPendingRepair,canManagePendingRepair} from '../shared/pendingRepairPermissions.mjs';

test('inspectors may register pending repairs but cannot confirm or schedule customer repairs',()=>{
 const inspector={role:'inspector',active:true};
 assert.equal(canRegisterPendingRepair(inspector),true);
 assert.equal(canManagePendingRepair(inspector),false);
 assert.equal(canRegisterPendingRepair({...inspector,inspectorRoleMember:false}),false);
 for(const role of ['manager','advisor']) {
  assert.equal(canRegisterPendingRepair({role,active:true}),true);
  assert.equal(canManagePendingRepair({role,active:true}),true);
 }
 for(const role of ['technician','warehouse','outsourcing']) {
  assert.equal(canRegisterPendingRepair({role,active:true}),false);
  assert.equal(canManagePendingRepair({role,active:true}),false);
 }
});
test('pending repair permissions respect multiple memberships and disabled accounts',()=>{
 const user={role:'technician',roles:['technician','inspector'],active:true};
 assert.equal(canRegisterPendingRepair(user),true);
 assert.equal(canManagePendingRepair(user),false);
 assert.equal(canManagePendingRepair({...user,roles:['inspector','advisor']}),true);
 for(const role of ['manager','advisor','inspector']) {
  assert.equal(canRegisterPendingRepair({role,active:false}),false);
  assert.equal(canManagePendingRepair({role,active:false}),false);
 }
 assert.equal(canRegisterPendingRepair(undefined),false);
 assert.equal(canManagePendingRepair(undefined),false);
});
