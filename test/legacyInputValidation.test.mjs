import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyOrderInputErrors, legacyReferenceNameError } from '../shared/legacyInputValidation.mjs';
import { parseCustomerVehicleUpdate } from '../server/domain/customerVehicleUpdate.mjs';
import { createCompanyVehicleReference } from '../server/integrations/company/vehicleLookup.mjs';
import { enqueueLegacySyncEvent } from '../server/repositories/legacySyncOutboxRepository.mjs';

test('new master names honor both model columns and organization byte capacity', async () => {
  assert.equal(legacyReferenceNameError('model', '车'.repeat(25)), '');
  assert.match(legacyReferenceNameError('model', '车'.repeat(26)), /过长/);
  assert.equal(legacyReferenceNameError('organization', '司'.repeat(75)), '');
  assert.match(legacyReferenceNameError('organization', '司'.repeat(76)), /过长/);
  await assert.rejects(createCompanyVehicleReference({kind:'model',code:'TEST',name:'车'.repeat(26)}, () => assert.fail('must reject before insert')), /过长/);
});

test('order validation counts combined model code and name including separator', () => {
  assert.deepEqual(legacyOrderInputErrors({vehicle:{modelLegacyCode:'ABCDEFGHI',model:'车'.repeat(45)}}), []);
  assert.match(legacyOrderInputErrors({vehicle:{modelLegacyCode:'ABCDEFGHIJ',model:'车'.repeat(45)}}).join(), /合计/);
  for (const order of [
    {vehicle:{mileage:'1'.repeat(21)}},
    {customer:{phone:'电'.repeat(26)}},
    {customer:{contact:'人'.repeat(51)}},
    {department:{code:'A'.repeat(51)}},
    {advisor:'人'.repeat(11)}
  ]) assert.ok(legacyOrderInputErrors(order).length);
});

test('contact update and new event cannot bypass phone capacity', async () => {
  assert.throws(() => parseCustomerVehicleUpdate({expectedRevision:1,contact:'张三',phone:'电'.repeat(26)}), /联系电话过长/);
  assert.equal(parseCustomerVehicleUpdate({expectedRevision:1,contact:'张三',phone:'1'.repeat(50)}).phone.length, 50);
  await assert.rejects(enqueueLegacySyncEvent({query(){assert.fail('no writes');}}, {vehicle:{plate:'鲁B12345'},customer:{phone:'电'.repeat(26)}}, 'created'), /联系电话过长/);
});
