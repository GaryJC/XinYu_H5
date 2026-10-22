import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename);
  cache.set(filename, mod);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(dirname(filename));
  mod.require = name => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/AuthenticatedImage')) return {
      AuthenticatedImage: ({alt}) => React.createElement('img', {alt}),
      AuthenticatedImagePreviewGroup: ({children}) => children
    };
    if (name.startsWith('.')) {
      const base = resolve(dirname(filename), name);
      const local = [base,base+'.tsx',base+'.ts'].find(existsSync);
      if (local && /\.tsx?$/.test(local)) return load(local);
    }
    return require(name);
  };
  mod._compile(ts.transpileModule(readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText, filename);
  return mod.exports;
}
const {PreRepairPhotos} = load(fileURLToPath(new URL('../client/src/features/pre-repair-photos/PreRepairPhotos.tsx',import.meta.url)));
const controls = {uploading:'',error:'',upload:async()=>true,uploadExtras:async()=>true,removeExtra:()=>true,removeExtras:()=>true,removePhoto:()=>true,replaceExtra:async()=>true};
const render = props => renderToStaticMarkup(React.createElement(PreRepairPhotos,{disabled:false,controls,...props}));

test('empty and incomplete standard angles show examples and the precise missing angles', () => {
  const empty = render({});
  assert.match(empty,/必拍已完成 0\/2/);
  assert.match(empty,/待补：斜前方 45°、斜后方 45°/);
  assert.match(empty,/拍摄示例/);
  const partial = render({photos:{front45:'front'}});
  assert.match(partial,/必拍已完成 1\/2/);
  assert.match(partial,/待补：斜后方 45°/);
});
test('uploaded photos render compact menus without permanent upload or delete controls', () => {
  const html = render({photos:{front45:'front',rear45:'rear',mileage:'meter',extra:['extra']}});
  assert.match(html,/必拍已完成 2\/2/);
  assert.doesNotMatch(html,/拍摄示例|重新拍摄|全选补充照片|删除所选/);
  assert.match(html,/斜前方 45°照片操作/);
  assert.match(html,/补充照片 1操作/);
  assert.match(html,/管理/);
});
test('read-only photos have previews but no add, manage, select or operation entrypoints', () => {
  const html = render({disabled:true,photos:{front45:'front',rear45:'rear',extra:['extra']}});
  assert.match(html,/斜前方 45°维修前照片/);
  assert.doesNotMatch(html,/照片操作|1操作|添加照片|管理|全选补充照片/);
});
test('paper orders present optional photos and no missing-required warning', () => {
  const html = render({required:false});
  assert.match(html,/选填/);
  assert.doesNotMatch(html,/必拍已完成|待补：/);
});
test('one upload error appears once and populated slots no longer show stale missing errors', () => {
  const html = render({photos:{front45:'front',rear45:'rear'},controls:{...controls,error:'网络中断'},errors:['请上传斜前方 45°照片']});
  assert.equal(html.split('网络中断').length-1,1);
  assert.doesNotMatch(html,/请上传斜前方 45°照片/);
});
