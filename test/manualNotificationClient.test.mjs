import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const hookSource = compile('../client/src/features/notifications/useNotificationRecords.ts');
const nextTick = () => new Promise(setImmediate);
const row = (values = {}) => ({ id: 'notice', kind: '待检验', recipientName: '检验员', status: 'accepted', error: '', createdAt: '', canQuery: true, ...values });

function harness({ list = async () => [row()], query = async () => ({ status: 'sent', error: '' }) } = {}) {
  const slots = [], effects = [], subscriptions = new Set(), calls = { list: [], query: [] }, exports = {};
  let index = 0;
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = index++, old = slots[i];
      if (!old || deps.some((value, n) => value !== old.deps[n])) {
        old?.cleanup?.(); slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = fn(); });
      }
    }
  };
  vm.runInNewContext(hookSource, { exports, AbortController, Error, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('/httpClient')) return { subscribeAuthSession(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); } };
    if (name === './notificationApi') return { notificationApi: {
      list(...args) { calls.list.push(args); return list(...args); }, query(...args) { calls.query.push(args); return query(...args); }
    } };
    throw Error(name);
  } });
  return {
    calls,
    render(source = 'dispatch', resourceId = 'order') { index = 0; const result = exports.useNotificationRecords(source, resourceId); effects.splice(0).forEach(fn => fn()); return result; },
    changeIdentity() { subscriptions.forEach(fn => fn()); }
  };
}

test('notification records make no request until opened; refresh never calls DingTalk result query', async () => {
  const h = harness(); h.render(); h.render();
  assert.equal(h.calls.list.length, 0); assert.equal(h.calls.query.length, 0);
  h.render().toggle(true); await nextTick();
  assert.equal(h.calls.list.length, 1); assert.equal(h.render().items[0].status, 'accepted');
  await h.render().load(); assert.equal(h.calls.list.length, 2); assert.equal(h.calls.query.length, 0);
  h.render().toggle(false); await nextTick(); assert.equal(h.calls.list.length, 2);
});

test('a manual query is single flight and terminal rows cannot be queried again', async () => {
  let resolveQuery, queried = false;
  const h = harness({ list: async () => [row({ status: queried ? 'sent' : 'accepted', canQuery: !queried })], query: () => new Promise(resolve => { resolveQuery = resolve; }) });
  h.render(); await h.render().load();
  const first = h.render().query('notice'); await h.render().query('notice');
  assert.equal(h.calls.query.length, 1); assert.equal(h.render().busy, true);
  queried = true; resolveQuery({ status: 'sent', error: '' }); await first;
  assert.equal(h.render().items[0].status, 'sent'); assert.equal(h.render().busy, false);
  await h.render().query('notice'); assert.equal(h.calls.query.length, 1);
});

test('a successful query remains visible when the subsequent local refresh fails', async () => {
  let reads = 0;
  const h = harness({ list: async () => { if (++reads > 1) throw Error('database unavailable'); return [row()]; } });
  h.render(); await h.render().load(); await h.render().query('notice');
  assert.equal(h.render().items[0].status, 'sent'); assert.equal(h.render().items[0].canQuery, false);
  assert.equal(h.render().busy, false); assert.equal(h.render().queryingId, '');
  assert.equal(h.render().error, ''); assert.match(h.render().refreshError, /查询结果已保留/);
});

test('unavailable historical notices and terminal notices cause zero result queries', async () => {
  const h = harness({ list: async () => [row({ canQuery: false }), row({ id: 'done', status: 'sent', canQuery: true }), row({ id: 'failed', status: 'failed', canQuery: true })] });
  h.render(); await h.render().load();
  for (const id of ['notice', 'done', 'failed']) await h.render().query(id);
  assert.equal(h.calls.query.length, 0);
});

test('switching resources discards old read responses and cancels the old request', async () => {
  let resolveList;
  const h = harness({ list: () => new Promise(resolve => { resolveList = resolve; }) });
  h.render(); const pending = h.render().load(); const signal = h.calls.list[0][2];
  h.render('dispatch', 'another-order'); assert.equal(signal.aborted, true);
  resolveList([row({ recipientName: '旧工单收件人' })]); await pending;
  assert.equal(h.render('dispatch', 'another-order').items.length, 0);
});

test('identity changes clear records and ignore an in-flight result without another query', async () => {
  let resolveQuery;
  const h = harness({ query: () => new Promise(resolve => { resolveQuery = resolve; }) });
  h.render(); await h.render().load(); const pending = h.render().query('notice');
  h.changeIdentity(); resolveQuery({ status: 'sent', error: '' }); await pending;
  assert.equal(h.render().items.length, 0); assert.equal(h.render().open, false);
  assert.equal(h.calls.list.length, 1); assert.equal(h.calls.query.length, 1);
});

test('notification API uses distinct read and explicit query routes', async () => {
  const calls = [], exports = {};
  vm.runInNewContext(compile('../client/src/features/notifications/notificationApi.ts'), { exports, URLSearchParams, encodeURIComponent,
    require: () => ({ request: async (...args) => { calls.push(args); return []; } }) });
  await exports.notificationApi.list('vehicle-trip', 'trip/id');
  await exports.notificationApi.query('vehicle-trip', 'notice/id');
  assert.equal(calls[0][0], '/api/notifications?source=vehicle-trip&resourceId=trip%2Fid');
  assert.equal(calls[1][0], '/api/notifications/vehicle-trip/notice%2Fid/query');
  assert.equal(calls[1][1].method, 'POST');
});

test('notification records distinguish platform acceptance, simulation and unavailable queries', () => {
  const exports = {};
  vm.runInNewContext(compile('../client/src/features/notifications/NotificationRecords.tsx'), { exports, Date,
    require(name) {
      if (name === 'antd') return { Alert: 'Alert', Button: 'Button', Tag: 'Tag' };
      if (name.endsWith('/ActionHistory')) return { ActionHistory: 'History' };
      if (name.endsWith('/RefreshButton')) return { RefreshButton: 'RefreshButton' };
      if (name.endsWith('/LoadingState')) return { LoadingState: 'Loading' };
      if (name === './notifications.css') return {};
      if (name === './useNotificationRecords') return { useNotificationRecords: () => ({ open: true, busy: false, items: [row(), row({ id: 'old', canQuery: false, queryUnavailableReason: '旧记录缺少发送账号快照' }), row({ id: 'mock', status: 'sent', canQuery: false, simulated: true }), row({ id: 'suppressed', status: 'suppressed', canQuery: false, canRetry: false }), row({ id: 'retired-failure', status: 'failed', canQuery: false, canRetry: false }), row({ id: 'retry', status: 'failed', canQuery: false, canRetry: true })] }) };
      return require(name);
    }
  });
  const tree = exports.NotificationRecords({ source: 'dispatch', resourceId: 'order', onRetry: async()=>true });
  function nodes(value) { if (!value || typeof value !== 'object') return []; return [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)]; }
  const history = nodes(tree).find(node => node.type === 'History');
  const details = history.props.items.flatMap(item => nodes(item.detail));
  const tags = details.filter(node => node.type === 'Tag').map(node => node.props.children);
  assert.deepEqual(tags, ['平台已受理', '平台已受理', '模拟 · 发送成功', '不推送', '发送失败', '发送失败']);
  assert.equal(details.filter(node => node.type === 'Button').length, 2,'one manual query and one permitted retry; suppressed or retired failures have neither');
  assert.equal(history.props.items[0].time, undefined);
  assert.ok(details.some(node => node.props?.children === '旧记录缺少发送账号快照'));
});
