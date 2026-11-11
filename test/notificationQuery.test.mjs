import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:1/unused';
const { notificationQueryUnavailableReason: reason, assertNotificationResourceAccess: access } = await import('../server/services/notificationQueryService.mjs');
const { notificationSource, notificationIdentifier } = await import('../server/repositories/notificationQueryRepository.mjs');
const now = Date.parse('2026-11-11T06:00:00Z');
const ready = { status: 'accepted', task_id: 'platform-task', delivery_user_id: 'actual-target', delivery_submitted_at: new Date(now - 1000) };

test('manual notification checks require known target, task, valid time, and an unresolved result', () => {
  assert.equal(reason(ready, now), '');
  assert.equal(reason({ ...ready, status: 'unknown' }, now), '');
  for (const status of ['pending', 'sent', 'failed']) assert.ok(reason({ ...ready, status }, now));
  for (const patch of [{ task_id: null }, { delivery_user_id: null }, { delivery_user_id: ' ' }, { delivery_submitted_at: null }, { delivery_submitted_at: 'invalid' }, { delivery_submitted_at: new Date(now + 1) }]) assert.ok(reason({ ...ready, ...patch }, now));
  assert.match(reason({ ...ready, delivery_submitted_at: new Date(now - 86400000) }, now), /24小时/);
  assert.equal(reason({ ...ready, delivery_submitted_at: new Date(now - 86399999) }, now), '');
  assert.match(reason({ ...ready, locked_until: new Date(now + 1) }, now), /处理中/);
  assert.match(reason({ ...ready, result_queried_at: new Date(now - 29999) }, now), /30秒/);
  assert.equal(reason({ ...ready, result_queried_at: new Date(now - 30000) }, now), '');
});
test('notification audience permissions preserve per-resource access and multi-role checks', () => {
  const actor = { id: 'a', active: true, shopId: 's', role: 'employee', roles: ['employee'] };
  const resource = { shop_id: 's', applicant_id: 'a' };
  access(actor, 'vehicle-trip', resource);
  assert.throws(() => access(actor, 'vehicle-trip', { ...resource, applicant_id: 'b' }), error => error.status === 403);
  for (const source of ['dispatch', 'license-exception', 'vehicle-insurance']) {
    assert.throws(() => access(actor, source, resource), error => error.status === 403);
    access({ ...actor, roles: ['employee', 'advisor'] }, source, resource);
  }
  access({ ...actor, roles: ['warehouse'] }, 'procurement', resource);
  assert.throws(() => access({ ...actor, roles: ['advisor'] }, 'procurement', resource), error => error.status === 403);
  assert.throws(() => access({ ...actor, roles: ['manager'] }, 'dispatch', { shop_id: 'other' }), error => error.status === 404);
  assert.throws(() => access({ ...actor, active: false, roles: ['manager'] }, 'dispatch', resource), error => error.status === 403);
  for (const source of ['dispatch', 'license-exception']) {
    assert.throws(() => access({ ...actor, roles: ['advisor', 'technician'] }, source, resource), /匹配润丰员工编码/);
    access({ ...actor, roles: ['advisor', 'technician'], legacyEmployeeCode: 'T0001' }, source, resource);
  }
  access({ ...actor, roles: ['warehouse', 'technician'] }, 'procurement', resource);
});
test('request identifiers never become SQL identifiers', () => {
  for (const input of ['__proto__', 'constructor', "dispatch; drop table users", null]) assert.throws(() => notificationSource(input), error => error.status === 400);
  for (const input of ['', undefined, 'x'.repeat(201)]) assert.throws(() => notificationIdentifier(input), error => error.status === 400);
  assert.throws(() => notificationIdentifier('not-a-uuid', true), error => error.status === 400);
});
