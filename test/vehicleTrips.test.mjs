import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTripAction, assertTripUpload, assertTripAccess, vehicleInput, requireVehicleManager } from '../server/domain/vehicleTrips.mjs';
const employee = { id: 'employee', name: '员工', role: 'employee', active: true, shopId: 'shop-hq' };
const manager = { ...employee, id: 'manager', role: 'manager' };
const trip = { id: 'trip', applicantId: employee.id, shopId: employee.shopId, status: '待审批' };
const status = (code) => e => e.status === code;
test('vehicle plate normalization, required fields and active flag validation', () => {
  assert.deepEqual(vehicleInput({ plate: ' 鲁 bd09326 ', brand: '北汽', model: ' EX360 ' }), { plate: '鲁BD09326', brand: '北汽', model: 'EX360', active: true });
  for (const input of [{}, { plate: '鲁B1', brand: '', model: 'x' }, { plate: '鲁B1', brand: 'a', model: 'x', active: 'false' }]) assert.throws(() => vehicleInput(input), status(400));
  assert.throws(() => requireVehicleManager(employee), status(403));
});
test('employee privacy, shop isolation, inactive identity and no self approval', () => {
  assertTripAccess(trip, employee); assertTripAccess(trip, manager);
  assert.throws(() => assertTripAccess(trip, { ...employee, id: 'other' }), status(404));
  assert.throws(() => assertTripAccess(trip, { ...manager, shopId: 'other' }), status(404));
  assert.throws(() => assertTripAccess(trip, { ...employee, active: false }), status(403));
  assert.throws(() => assertTripAction(trip, { ...manager, id: employee.id }, 'approve'), status(403));
  assert.throws(() => assertTripAction(trip, { ...manager, id: employee.id }, 'reject'), status(403));
});
test('workflow transitions require exact state and owner even for managers', () => {
  assertTripAction(trip, manager, 'approve'); assertTripAction(trip, manager, 'reject');
  assertTripAction(trip, employee, 'cancel');
  assertTripAction({ ...trip, status: '待出车' }, employee, 'depart');
  assertTripAction({ ...trip, status: '用车中' }, employee, 'return');
  assert.throws(() => assertTripAction(trip, employee, 'depart'), status(409));
  assert.throws(() => assertTripAction({ ...trip, status: '已还车' }, employee, 'return'), status(409));
  assert.throws(() => assertTripAction({ ...trip, status: '用车中' }, employee, 'cancel'), status(409));
  assert.throws(() => assertTripAction({ ...trip, status: '待出车' }, manager, 'depart'), status(403));
});
test('uploads follow the same actor and stage restrictions as confirmation', () => {
  assert.throws(() => assertTripUpload(trip, manager, 'signature'), status(400));
  assert.throws(() => assertTripUpload(trip, employee, 'signature'), status(400));
  assert.throws(() => assertTripUpload(trip, employee, 'departure'), status(409));
  assert.throws(() => assertTripUpload(trip, manager, 'unknown'), status(400));
  assertTripUpload({ ...trip, status: '用车中' }, employee, 'return');
});
