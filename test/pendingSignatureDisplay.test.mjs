import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {signatureRepairItems} from '../shared/signatureRepairItems.mjs';
import {customerSignatureSession} from '../server/domain/customerSignaturePolicy.mjs';

const pending = {id: 'pending', itemId: -1, name: '检查后轮异响并联系客户确认维修范围', state: 'pending', scheduled: false, reason: '内部记录', history: [{actor: '员工姓名'}]};
const order = {id: 'TEST', status: '待客户签字', shop: {name: '测试门店'}, vehicle: {plate: '鲁BTEST', model: '测试车型', mileage: '100'}, customer: {name: '测试客户'},
  repairItems: [], pendingRepairs: [pending], estimatedFee: 0, faultDescription: '', feeNote: '', oldPartsHandling: '客户带走', estimatedDeliveryAt: ''};

function component(file, overrides = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../client/src/features/signature/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const exports = {};
  const jsx = (type, props) => typeof type === 'function' ? type(props) : {type, props};
  vm.runInNewContext(compiled, {exports, require(name) {
    if (name in overrides) return overrides[name];
    if (name.endsWith('.css')) return {};
    if (name === 'react') return {useState: value => [value, () => {}], useEffect() {}};
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'fragment'};
    if (name === 'antd') return new Proxy({Grid: {useBreakpoint: () => ({})}}, {get: (target, key) => target[key] || key});
    if (name.endsWith('SignatureRepairItems')) return {SignatureRepairItems};
    if (name.endsWith('signatureRepairItems.mjs')) return {signatureRepairItems};
    if (name.endsWith('useActionFeedback')) return {useActionFeedback: () => ({})};
    if (name.endsWith('useSignatureMode')) return {useSignatureMode: () => ({mode: 'onsite', busy: false})};
    if (name.endsWith('workOrderDomain')) return {sumLabor: () => 0};
    return new Proxy({}, {get: (_, key) => key});
  }});
  return exports[file];
}
const SignatureRepairItems = component('SignatureRepairItems');
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return node && typeof node === 'object' ? text(node.props?.children) : '';
}
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(item => nodes(item, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}

test('public signing preview includes pending-only projects without leaking internal notes or approving them', () => {
  const before = JSON.stringify(order);
  const session = customerSignatureSession(order);
  assert.equal(session.state, 'pending');
  assert.deepEqual(session.order.repairItems, [{name: pending.name, laborFee: 0, confirmation: 'pending'}]);
  assert.equal(session.order.estimatedFee, 0);
  assert.equal(JSON.stringify(order), before);
  assert.equal(JSON.stringify(session).includes('内部记录'), false);
  assert.equal(JSON.stringify(session).includes('员工姓名'), false);
});

test('both signing previews show pending projects and the separate-confirmation guidance before the signature pad', () => {
  const Remote = component('CustomerSignaturePage', {'./useCustomerSignature': {useCustomerSignature: () => ({session: customerSignatureSession(order), loading: false})}});
  const Onsite = component('WorkOrderSignatureDialog');
  for (const tree of [Remote(), Onsite({session: {token: 'fixture', order: {...order, status: '草稿'}}})]) {
    const display = text(tree);
    assert.ok(display.includes(pending.name));
    assert.ok(display.includes('待客户确认'));
    assert.ok(display.includes('须经您另行确认后才会安排维修'));
    const rendered = nodes(tree, () => true);
    assert.ok(rendered.findIndex(node => node.props?.className === 'signature-repair-items') < rendered.findIndex(node => node.type === 'SignaturePad'));
    const project = nodes(tree, node => node.props?.className === 'signature-repair-row')[0];
    assert.equal(nodes(project, node => node.type === 'strong').length, 0, 'pending projects are not labelled as free');
  }
});

test('mixed previews keep formal fees, exclude declined and scheduled duplicate rows, and distinguish approved or inspection items', () => {
  const items = signatureRepairItems({...order, repairItems: [{name: '更换机油', laborFee: 80}], pendingRepairs: [pending,
    {...pending, name: '已拒绝', state: 'declined'}, {...pending, name: '已安排', scheduled: true},
    {...pending, name: '已同意', state: 'approved'}, {...pending, name: '检验待定', source: 'inspection'},
    {...pending, name: '检验已撤销', source: 'inspection', inspectionState: 'cancelled'}]});
  assert.deepEqual(items.map(item => item.name), ['更换机油', pending.name, '已同意', '检验待定']);
  const display = text(SignatureRepairItems({items, showFees: true}));
  assert.match(display, /¥\s*80.00/);
  assert.match(display, /已同意，待安排/);
  assert.match(display, /检验待定/);
});

test('formal-only orders preserve their preview and do not add pending guidance', () => {
  const items = signatureRepairItems({...order, pendingRepairs: undefined, repairItems: [{name: '保养', laborFee: 100}]});
  assert.deepEqual(items, [{name: '保养', laborFee: 100}]);
  assert.equal(text(SignatureRepairItems({items})).includes('待客户确认'), false);
});
