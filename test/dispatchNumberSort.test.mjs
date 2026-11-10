import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDispatchNumbers} from '../shared/dispatchNumberSort.mjs';

test('unnumbered orders always lead newest first, using exact creation time before display time', () => {
  const rows = [
    {id:'number-low',dispatchNo:'B002'},
    {id:'old',dispatchNo:null,createdAt:'2026-11-09T00:00:00Z'},
    {id:'number-high',dispatchNo:'A100'},
    {id:'new',dispatchNo:'  ',createdAtIso:'2026-11-10T01:00:00Z',createdAt:'2020-01-01'},
    {id:'middle',createdAt:'2026-11-10T00:00:00Z'},
    {id:'unknown',dispatchNo:'',createdAt:'invalid'}
  ];
  for (const sort of ['dispatch-desc','dispatch-asc']) {
    const numbered = sort === 'dispatch-desc' ? ['number-high','number-low'] : ['number-low','number-high'];
    assert.deepEqual([...rows].sort((a,b)=>compareDispatchNumbers(a,b,sort)).map(row=>row.id), ['new','middle','old','unknown',...numbered]);
  }
  assert.equal(compareDispatchNumbers({},{}),0);
});

test('numbered orders retain numeric suffix ordering and precise long serials', () => {
  const rows = ['A9','B10','A100','B002','A010','A9007199254740993','A9007199254740992'].map(dispatchNo=>({dispatchNo}));
  assert.deepEqual(rows.sort(compareDispatchNumbers).map(row=>row.dispatchNo), ['A9007199254740993','A9007199254740992','A100','B10','A010','A9','B002']);
});
