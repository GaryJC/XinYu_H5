import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectionReturnStats } from '../server/domain/inspectionReturnStats.mjs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const { listInspectionReturns } = await import('../server/repositories/inspectionReturnRepository.mjs');
import { completionRange } from '../server/domain/dispatchPolicy.mjs';

const event = (orderId, ids, items, extra = {}) => ({ orderId, detail: { rejectedItemIds: ids, items, ...extra } });

test('counts rejected projects per historical owner, deduplicating repeated returns across rounds', () => {
  const items = [{ id: 1, responsibleId: 'a' }, { id: 2, responsibleId: 'b' }, { id: 3, responsibleId: 'a' }];
  const result = inspectionReturnStats([
    event('one', [1, 2, 1], items),
    event('one', [1], items, { repairRound: 1 }),
    event('two', [1], items),
    event('one', [], items)
  ]);
  assert.deepEqual(result.get('a'), { returnedItemCount: 2, returnedItemOccurrences: 3 });
  assert.deepEqual(result.get('b'), { returnedItemCount: 1, returnedItemOccurrences: 1 });
});

test('uses pre-inspection owner even if the returned item was reassigned or cleared', () => {
  const result = inspectionReturnStats([
    event('one', [1], [{ id: 1, responsibleId: 'new' }], { previousItems: [{ id: 1, responsibleId: 'old' }] }),
    event('one', [1], [{ id: 1, responsibleId: 'new' }]),
    event('one', [2, 99], [{ id: 2, responsibleName: 'Unknown' }])
  ]);
  assert.deepEqual([...result.keys()], ['old', 'new']);
  assert.equal(result.get('old').returnedItemCount, 1);
  assert.equal(result.get('new').returnedItemCount, 1);
});

test('repository limits inspection history to shop and Shanghai date boundaries, including completed orders', async () => {
  const range = completionRange('2026-10-01', '2026-10-31');
  const rows = [event('completed-order', [1], [{ id: 1, responsibleId: 'a' }])];
  const result = await listInspectionReturns('shop-a', range, { query: async (sql, params) => {
    assert.match(sql, /wo.shop_id = \$1/);
    assert.match(sql, /e.action = 'inspect'/);
    assert.match(sql, /e.at >= \$2::timestamptz and e.at < \$3::timestamptz/);
    assert.doesNotMatch(sql, /wo.status/);
    assert.deepEqual(params, ['shop-a', '2026-09-30T16:00:00.000Z', '2026-10-31T16:00:00.000Z']);
    return { rows };
  } });
  assert.deepEqual(result, rows);
});
