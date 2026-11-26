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
const fullImage = 'data:image/png;base64,AA==';

function renderMenu({ supportsWrite = true, source = fullImage, mobile = false } = {}) {
  let dropdown;
  const modules = {
    react: React,
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
    exports, require: name => modules[name],
    navigator: { userAgent: mobile ? 'iPhone DingTalk' : 'Macintosh DingTalk' }
  });
  const image = React.createElement('img', { src: source || 'thumbnail.png', alt: '维修照片' });
  const html = renderToStaticMarkup(React.createElement(exports.PhotoContextMenu, { source }, image));
  assert.equal(html, renderToStaticMarkup(image));
  return dropdown;
}

test('desktop without image clipboard support leaves the first right click to the original image', () => {
  assert.equal(renderMenu({ supportsWrite: false }), undefined);
});

test('supported desktop opens copy and download on the first right click', () => {
  const dropdown = renderMenu();
  assert.deepEqual(Array.from(dropdown.trigger), ['contextMenu']);
  assert.deepEqual(Array.from(dropdown.menu.items, item => item.label), ['复制图片', '下载图片']);
  assert.ok(dropdown.menu.items.every(item => !item.disabled));
});

test('mobile keeps the original image available for the client menu', () => {
  assert.equal(renderMenu({ mobile: true }), undefined);
});

test('a visible thumbnail cannot be copied in place of the original', () => {
  for (const supportsWrite of [true, false]) {
    const dropdown = renderMenu({ source: '', supportsWrite });
    assert.equal(dropdown.menu.items.find(item => item.key === 'copy').disabled, true);
  }
});
