import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../client/src/features/vehicle-license-ocr/useVehicleLicenseOcr.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

function setup(result, createOcrRecord) {
  let draft = {vehicle: {plate: '', vin: ''}, customer: {name: '已选单位', legacyCode: 'ORG'}, inspection: {}};
  const lookups = [];
  const slots = [];
  let cursor = 0;
  const exports = {};
  vm.runInNewContext(compiled, {exports, require(name) {
    if (name === 'react') return {
      useRef(initial) {const index = cursor++; return slots[index] ??= {current: initial};},
      useState(initial) {const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => {slots[index] = typeof value === 'function' ? value(slots[index]) : value;}];},
      useEffect() {}
    };
    if (name === 'antd') return {Modal: {confirm(options) {options.onCancel();}}};
    if (name.endsWith('prepareOcrImage')) return {prepareOcrImage: async () => ({})};
    if (name.endsWith('ocrUtils')) return {normalizeOcrDate: () => '', formatVehicleLicenseSummary: () => ''};
    if (name.endsWith('workOrderApi')) return {workOrderApi: {
      uploadFile: async () => ({id: 'license'}), recognizeVehicleLicense: async () => result, createOcrRecord
    }};
    throw new Error(name);
  }});
  return {
    lookups,
    get draft() {return draft;},
    editVehicle(patch) {draft = {...draft, vehicle: {...draft.vehicle, ...patch}};},
    render() {
      cursor = 0;
      return exports.useVehicleLicenseOcr({actor: '顾问', draft, setDraft: update => {draft = update(draft);}, onRecognized: async value => {lookups.push(value);}});
    }
  };
}

test('manual identifier corrections during OCR record saving survive both autofill and archive lookup', async () => {
  const recordStarted = deferred(), savedRecord = deferred();
  const h = setup({plate: '鲁BOLD01', vin: 'OLDVIN'}, async () => {recordStarted.resolve(); return savedRecord.promise;});
  const scan = h.render().scanVehicleLicense({});
  await recordStarted.promise;
  h.editVehicle({plate: '鲁BNEW01', vin: 'CORRECTEDVIN'});
  h.render();
  savedRecord.resolve({id: 'record'});
  await scan;
  assert.equal(h.draft.vehicle.plate, '鲁BNEW01');
  assert.equal(h.draft.vehicle.vin, 'CORRECTEDVIN');
  assert.equal(h.lookups[0].plate, '鲁BNEW01');
  assert.equal(h.lookups[0].vin, 'CORRECTEDVIN');
});

test('an identifier cleared while the OCR record is saving is not restored by the late response', async () => {
  const recordStarted = deferred(), savedRecord = deferred();
  const h = setup({plate: '鲁BOLD01', vin: 'VIN'}, async () => {recordStarted.resolve(); return savedRecord.promise;});
  h.editVehicle({plate: '鲁BOLD01'});
  const scan = h.render().scanVehicleLicense({});
  await recordStarted.promise;
  h.editVehicle({plate: ''});
  h.render();
  savedRecord.resolve({id: 'record'});
  await scan;
  assert.equal(h.draft.vehicle.plate, '');
  assert.equal(h.lookups[0].plate, '');
  assert.equal(h.draft.vehicle.vin, 'VIN');
});

test('partial OCR without an owner preserves the selected organization and its code', async () => {
  const h = setup({plate: '鲁BNEW01', vin: 'VIN', owner: ''}, async () => ({id: 'record'}));
  await h.render().scanVehicleLicense({});
  assert.equal(h.draft.customer.name, '已选单位');
  assert.equal(h.draft.customer.legacyCode, 'ORG');
});
