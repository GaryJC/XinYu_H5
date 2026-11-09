import assert from 'node:assert/strict';
import test from 'node:test';
import { vehiclePlateError } from '../shared/vehiclePlateValidation.mjs';
import { assertVehiclePlate, assertOrderReadyForSignature } from '../server/domain/workOrderPolicy.mjs';
import { enqueueLegacySyncEvent } from '../server/repositories/legacySyncOutboxRepository.mjs';

test('legacy plate capacity counts Chinese and spaces without forbidding descriptive text', () => {
  for (const plate of ['鲁 BBB3078', '鲁B1234567', '1234567890', '临时车辆号', '车架号1234', 'L176867']) {
    assert.equal(vehiclePlateError(plate), '', plate);
  }
  for (const plate of ['鲁 B1234567', '12345678901', '车架号后六位L24741', '架子号后六位D00034']) {
    assert.match(vehiclePlateError(plate), /过长/, plate);
  }
  assert.equal(vehiclePlateError('', { required: false }), '');
  assert.match(vehiclePlateError(''), /必填/);
});

test('server rejects oversized draft identifiers and old drafts at signing', () => {
  assert.throws(() => assertVehiclePlate('车架号后六位L24741'), { status: 400 });
  assert.throws(() => assertOrderReadyForSignature({ vehicle: { plate: '车架号后六位L24741' } }), /车牌号码过长/);
});

test('oversized new order cannot enter queue or increment its revision', async () => {
  const client = { query() { assert.fail('must reject before writing'); } };
  await assert.rejects(enqueueLegacySyncEvent(client, { vehicle: { plate: '车架号后六位L24741' } }, 'created'), /车牌号码过长/);
});
