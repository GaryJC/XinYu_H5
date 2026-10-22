import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../client/src/features/pre-repair-photos/usePreRepairPhotos.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(api, photos = { front45: 'old-front', rear45: 'rear', mileage: 'meter', extra: ['extra-1','extra-2'] }) {
  const state = [], cleanups = [], updates = [];
  let draft = { inspection: { preRepairPhotos: structuredClone(photos) } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, require(name) {
    if (name === 'react') return {
      useState(initial) { const index = state.length; state.push(initial); return [initial, value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
      useRef(value) { return { current: value }; },
      useEffect(effect) { cleanups.push(effect()); }
    };
    if (name.endsWith('workOrderApi')) return { workOrderApi: api };
    if (name.endsWith('prepareOcrImage')) return { prepareUploadPhoto: async file => ({ fileName: file.name }) };
    throw new Error(`Unexpected import ${name}`);
  }});
  const actions = exports.usePreRepairPhotos(updater => { draft = updater(draft); updates.push(draft); }, photos);
  return { actions, state, updates, photos: () => draft.inspection.preRepairPhotos, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}
const files = [{name:'one.jpg',type:'image/jpeg'},{name:'two.jpg',type:'image/jpeg'},{name:'three.jpg',type:'image/jpeg'}];
test('draft replacement succeeds in place and signals completion without changing other photos', async () => {
  const h = setup({ async uploadFile() { return { id:'replacement' }; } });
  assert.equal(await h.actions.replaceExtra('extra-1',files[0]),true);
  assert.deepEqual(Array.from(h.photos().extra),['replacement','extra-2']);
  assert.equal(h.photos().front45,'old-front');
  assert.equal(h.state[2],'已更换');
  assert.equal(h.actions.removeExtras(['replacement']),true);
  assert.deepEqual(Array.from(h.photos().extra),['extra-2']);
  assert.equal(h.state[2],'已删除');
});
test('failed replacement retains the original photo and returns false', async () => {
  const h = setup({ async uploadFile() { throw new Error('上传失败'); } });
  assert.equal(await h.actions.upload('front45',files[0]),false);
  assert.equal(h.photos().front45,'old-front');
  assert.equal(h.updates.length,0);
  assert.match(h.state[1],/上传失败/);
});
test('partial draft batch failure preserves completed photos and reports their count', async () => {
  const calls = [];
  const h = setup({ async uploadFile(file) { calls.push(file.fileName); if (file.fileName === 'two.jpg') throw new Error('网络异常'); return { id:file.fileName }; } });
  assert.equal(await h.actions.uploadExtras(files),false);
  assert.deepEqual(calls,['one.jpg','two.jpg']);
  assert.deepEqual(Array.from(h.photos().extra),['extra-1','extra-2','one.jpg']);
  assert.match(h.state[1],/已上传 1 张/);
});
test('draft batch locks overlapping upload and all delete entrypoints', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = setup({ async uploadFile() { await gate; return { id:'new' }; } });
  const pending = h.actions.uploadExtras([files[0]]);
  assert.equal(await h.actions.upload('rear45',files[0]),false);
  assert.equal(h.actions.removeExtra('extra-1'),false);
  assert.equal(h.actions.removeMileage(),false);
  assert.equal(h.actions.isUploading(),true);
  release(); assert.equal(await pending,true);
  assert.equal(h.actions.isUploading(),false);
  assert.equal(h.photos().mileage,'meter');
});
test('resetting or leaving a draft ignores stale uploads before they can mutate the next draft', async () => {
  for (const end of ['reset','unmount']) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = setup({ async uploadFile() { await gate; return {id:'stale'}; } });
    const pending = h.actions.upload('front45',files[0]);
    await Promise.resolve();
    if (end === 'reset') h.actions.reset(); else h.unmount();
    release(); assert.equal(await pending,false);
    assert.equal(h.updates.length,0);
    assert.equal(h.photos().front45,'old-front');
  }
});
test('invalid file types fail without upload or draft changes', async () => {
  const h = setup({ async uploadFile() { throw new Error('must not call'); } });
  assert.equal(await h.actions.upload('front45',{name:'text',type:'text/plain'}),false);
  assert.equal(h.updates.length,0);
  assert.match(h.state[1],/请选择照片/);
});
