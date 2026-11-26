import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const componentUrl = new URL('../client/src/shared/ui/PhotoPreviewGroup.tsx', import.meta.url);
const code = ts.transpileModule(readFileSync(componentUrl, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const first = { source: 'data:image/png;base64,AQ==', blob: new Blob([Uint8Array.of(1)], { type: 'image/png' }) };
const second = { source: 'data:image/png;base64,Ag==', blob: new Blob([Uint8Array.of(2)], { type: 'image/png' }) };

function preview({ supportsWrite = false, userAgent = 'Macintosh DingTalk' } = {}) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let dropdown;
  const created = [];
  const revoked = [];
  const react = {
    ...React,
    useState(initial) {
      const index = cursor++;
      const state = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useLayoutEffect(effect, deps) {
      const index = cursor++;
      const old = slots[index];
      if (old && deps.every((dep, i) => Object.is(dep, old.deps[i]))) return;
      effects.push(() => {
        old?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    }
  };
  const modules = {
    react,
    'react/jsx-runtime': jsx,
    antd: {
      message: { useMessage: () => [{}, null] },
      Dropdown: props => { dropdown = props; return props.children; }
    },
    '../browser/copyImage': { canCopyImage: () => supportsWrite },
    '../browser/downloadImage': {}
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: name => modules[name], navigator: { userAgent },
    URL: {
      createObjectURL(blob) { created.push(blob); return 'blob:preview-' + created.length; },
      revokeObjectURL(url) { revoked.push(url); }
    }
  });

  return {
    created, revoked,
    render(photo = first) {
      cursor = 0;
      dropdown = undefined;
      const image = React.createElement('img', { src: photo.source || 'thumbnail.png', alt: '维修照片' });
      const html = renderToStaticMarkup(React.createElement(exports.PhotoContextMenu, photo, image));
      return { src: html.match(/<img\b[^>]*?\bsrc="([^"]*)"/)?.[1], dropdown };
    },
    commit() { for (const effect of effects.splice(0)) effect(); },
    close() { for (const slot of slots) slot?.cleanup?.(); }
  };
}

test('desktop DingTalk exposes the original as a short URL to the native image menu', () => {
  const view = preview();
  assert.equal(view.render(first).src, undefined);
  view.commit();
  const ready = view.render(first);
  assert.equal(ready.dropdown, undefined);
  assert.equal(ready.src, 'blob:preview-1');
  assert.equal(view.created[0], first.blob);

  const switching = view.render(second);
  assert.equal(switching.src, undefined);
  view.commit();
  assert.deepEqual(view.revoked, ['blob:preview-1']);
  assert.equal(view.render(second).src, 'blob:preview-2');
  assert.equal(view.created[1], second.blob);
  view.commit();
  view.close();
  assert.deepEqual(view.revoked, ['blob:preview-1', 'blob:preview-2']);
  assert.equal(view.created.length, 2);
});

test('supported desktop opens copy and download on the first right click', () => {
  const view = preview({ supportsWrite: true });
  const { src, dropdown } = view.render();
  assert.equal(src, first.source);
  assert.deepEqual(Array.from(dropdown.trigger), ['contextMenu']);
  assert.deepEqual(Array.from(dropdown.menu.items, item => item.label), ['复制图片', '下载图片']);
  assert.ok(dropdown.menu.items.every(item => !item.disabled));
  view.commit();
  assert.equal(view.created.length, 0);
});

test('mobile DingTalk and other native desktop menus keep their existing image source', () => {
  for (const userAgent of ['iPhone DingTalk', 'Macintosh Safari']) {
    const view = preview({ userAgent });
    const { src, dropdown } = view.render();
    assert.equal(src, first.source);
    assert.equal(dropdown, undefined);
    view.commit();
    assert.equal(view.created.length, 0);
  }
});

test('a visible thumbnail cannot be copied in place of the original', () => {
  for (const supportsWrite of [true, false]) {
    const view = preview({ supportsWrite });
    const { src, dropdown } = view.render({ source: '' });
    assert.equal(src, 'thumbnail.png');
    assert.equal(dropdown.menu.items.find(item => item.key === 'copy').disabled, true);
    view.commit();
    assert.equal(view.created.length, 0);
  }
});
