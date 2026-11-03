import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../client/src/shared/browser/copyText.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function setup({ modern = false, denied = false, succeeds = true } = {}) {
  const exports = {}, calls = [], data = new Map([['text/html', 'old content']]);
  let copyEvent;
  class Element {}
  const focused = new Element();
  focused.closest = () => ({ appendChild: () => calls.push('dialog') });
  focused.focus = () => calls.push('restore');
  const input = {
    style: {}, focus: () => calls.push('focus'), select: () => calls.push('select'),
    setSelectionRange: (start, end) => calls.push([start, end]), remove: () => calls.push('remove'),
    addEventListener: (_, handler) => { copyEvent = handler; }, removeEventListener: () => {}
  };
  vm.runInNewContext(code, {
    exports, HTMLElement: Element,
    navigator: { clipboard: modern ? { writeText: async text => { if (denied) throw Error('denied'); data.clear(); data.set('text/plain', text); } } : undefined },
    document: {
      activeElement: focused, createElement: () => input,
      execCommand: () => {
        copyEvent({ preventDefault() {}, stopImmediatePropagation() {}, clipboardData: { clearData: () => data.clear(), setData: (type, text) => data.set(type, text) } });
        return succeeds;
      }
    }
  });
  return { copy: exports.copyText, calls, data };
}

for (const text of ['鲁B示例001', 'B1322', 'WT-20261017-EFC77AE2479A']) {
  test(`clipboard preserves identifier exactly: ${text}`, async () => {
    for (const options of [{ modern: true }, {}, { modern: true, denied: true }]) {
      const s = setup(options);
      assert.equal(await s.copy(text), true);
      assert.deepEqual([...s.data], [['text/plain', text]]);
      if (!options.modern || options.denied) {
        assert.deepEqual(s.calls, ['dialog', 'focus', 'select', [0, text.length], 'remove', 'restore']);
      }
    }
  });
}
test('failed fallback does not report a successful copy and restores focus', async () => {
  const s = setup({ succeeds: false });
  assert.equal(await s.copy('鲁B12345'), false);
  assert.deepEqual(s.calls.slice(-2), ['remove', 'restore']);
});
