import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../client/src/features/vehicle-identity/useVehicleIdentityRecognition.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText;

function setup(vehicle, api) {
  let draft = {vehicle: {plate: '', vin: '', ...vehicle}, customer: {}};
  const slots = [];
  let cursor = 0;
  const exports = {};
  vm.runInNewContext(compiled, {exports, require(name) {
    if (name === 'react') return {
      useRef(initial) {const index = cursor++; return slots[index] ??= {current: initial};},
      useState(initial) {const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => {slots[index] = typeof value === 'function' ? value(slots[index]) : value;}];},
      useEffect() {}
    };
    if (name.endsWith('workOrderApi')) return {workOrderApi: api};
    if (name.endsWith('prepareOcrImage')) return {prepareOcrImage: async () => ({imageBase64: 'image'})};
    throw new Error(name);
  }});
  return {
    get draft() {return draft;},
    render() {cursor = 0; return exports.useVehicleIdentityRecognition({draft, setDraft: update => {draft = update(draft);}});}
  };
}

test('VIN scan checks the entered new plate instead of replacing it with the old archive plate', async () => {
  const inputs = [];
  const message = '车牌与润丰档案不一致，请先到润丰更新车辆档案';
  const h = setup({plate: '鲁BNEW01', vin: ''}, {
    recognizeVin: async () => ({value: 'lsvnv2182e2123456'}),
    lookupVehicle: async input => {
      inputs.push(input);
      return input.plate ? {found: false, status: 'conflict', message}
        : {found: true, vehicle: {plate: '鲁BOLD01', vin: input.vin}};
    }
  });
  await h.render().scanVehicleIdentifier('vin', {});
  assert.equal(inputs[0].plate, '鲁BNEW01');
  assert.equal(inputs[0].vin, 'LSVNV2182E2123456');
  assert.equal(h.draft.vehicle.plate, '鲁BNEW01');
  assert.equal(h.render().vehicleHistory.status, 'conflict');
  assert.equal(h.render().vehicleHistory.message, message);
});

test('plate scan also sends the already entered VIN for archive validation', async () => {
  const inputs = [];
  const h = setup({plate: '', vin: 'LSVNV2182E2123456'}, {
    recognizeLicensePlate: async () => ({value: ' 鲁bnew01 '}),
    lookupVehicle: async input => {inputs.push(input); return {found: false, status: 'conflict'};}
  });
  await h.render().scanVehicleIdentifier('plate', {});
  assert.equal(inputs[0].plate, '鲁BNEW01');
  assert.equal(inputs[0].vin, 'LSVNV2182E2123456');
  assert.equal(h.draft.vehicle.vin, 'LSVNV2182E2123456');
});

test('partial license OCR retains the other identifier in both live and development lookup paths', async () => {
  for (const method of ['lookupVehicleLicense', 'lookupVehicleLicenseForDevelopment']) {
    for (const result of [{plate: '鲁BNEW01', vin: ''}, {plate: '', vin: 'LSVNV2182E2123456'}]) {
      const inputs = [];
      const h = setup({plate: '鲁BNEW01', vin: 'LSVNV2182E2123456'}, {
        lookupVehicle: async input => {inputs.push(input); return {found: false, status: 'conflict'};}
      });
      await h.render()[method](result);
      assert.equal(inputs[0].plate, '鲁BNEW01');
      assert.equal(inputs[0].vin, 'LSVNV2182E2123456');
    }
  }
});

test('clearing both lookup identifiers invalidates a pending response and clears its loader', async () => {
  let resolve;
  const pending = new Promise(done => {resolve = done;});
  const h = setup({plate: '', vin: ''}, {lookupVehicle: () => pending});
  const oldRequest = h.render().lookupDraftVehicle({plate: '鲁BOLD01'});
  assert.equal(h.render().vehicleHistoryLoading, true);
  await h.render().lookupDraftVehicle({plate: '', vin: ''});
  resolve({found: true, vehicle: {plate: '鲁BOLD01', vin: 'LSVNV2182E2123456'}});
  await oldRequest;
  assert.equal(h.draft.vehicle.plate, '');
  assert.equal(h.render().vehicleHistory, undefined);
  assert.equal(h.render().vehicleHistoryLoading, false);
});
