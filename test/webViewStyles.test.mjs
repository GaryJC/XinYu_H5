import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToString } from "react-dom/server";

const require = createRequire(import.meta.url);
const { StyleProvider, createCache, extractStyle } = require("@ant-design/cssinjs");
const { ConfigProvider, Card, Form, Input, Button } = require("antd");
// Exercise the actual TSX provider and installed Ant Design styles, not a copy
// of the capability-selection logic.
const filename = fileURLToPath(new URL("../client/src/shared/ui/WebViewStyleProvider.tsx", import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
}).outputText;
const providerModule = new Module(filename);
providerModule.filename = filename;
providerModule.paths = Module._nodeModulePaths(dirname(filename));
providerModule._compile(compiled, filename);
const { WebViewStyleProvider } = providerModule.exports;

function renderStyles(cssApi) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  try {
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: cssApi });
    const cache = createCache();
    const h = React.createElement;
    renderToString(h(StyleProvider, { cache },
      h(WebViewStyleProvider, null,
        h(ConfigProvider, null,
          h(Card, null,
            h(Form, null,
              h(Form.Item, { label: "姓名" }, h(Input)),
              h(Button, { type: "primary" }, "提交")))))));
    return extractStyle(cache, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "CSS", original);
    else delete globalThis.CSS;
  }
}

const logicalDeclaration = /[;{](?:margin|padding|inset)-(?:inline|block)(?:-start|-end)?:/;

test("legacy WebViews receive physical layout properties and selectors without :where", () => {
  const css = renderStyles({ supports: () => false });
  assert.ok(css.length > 1000);
  assert.ok(!css.includes(":where("));
  assert.doesNotMatch(css, logicalDeclaration);
  assert.match(css, /padding-left:/);
});

test("modern browsers retain default selector priority and logical properties", () => {
  const css = renderStyles({ supports: () => true });
  assert.ok(css.includes(":where("));
  assert.match(css, logicalDeclaration);
});

test("an unavailable CSS capability API safely selects legacy styles", () => {
  assert.ok(!renderStyles(undefined).includes(":where("));
});
