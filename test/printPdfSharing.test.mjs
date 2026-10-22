import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../client/src/features/work-order-print/usePrintPdf.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText;

async function withHook({ navigator, native = true, save = async () => {}, prepare }, run) {
  const descriptors = ["navigator", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://repair.example" } } });
  const file = { name: "委托书.pdf" };
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const component = new Module("printPdfSharing-hook");
  component.require = name => {
    if (name === "react") return {
      useState(value) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = index === 1 ? file : value;
        return [states[index], next => { states[index] = next; }];
      },
      useRef(value) { return refs[refIndex++] ||= { current: value }; },
      useEffect() {}, useCallback: value => value
    };
    if (name.endsWith("printFile")) return { isDingTalkMobile: () => native, savePrintFile: save };
    if (name.endsWith("preparePdfDownload")) return { preparePdfDownload: prepare };
    throw new Error(`Unexpected import ${name}`);
  };
  component._compile(compiled, "printPdfSharing-hook.js");
  function render() {
    stateIndex = 0; refIndex = 0;
    return component.exports.usePrintPdf("order-123");
  }
  try { await run(render, file); }
  finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("Android without Web Share uploads once and hands an HTTPS PDF to the native DingTalk saver", async () => {
  const calls = [];
  let release;
  await withHook({ navigator: {},
    prepare: async (...args) => { calls.push(args); await new Promise(resolve => { release = resolve; }); return { path: "/api/print-pdfs/test.pdf" }; },
    save: async (...args) => { calls.push(args); }
  }, async (render, file) => {
    const hook = render();
    assert.equal(hook.canShare, false);
    const pending = hook.share();
    await hook.share(); // Prevent a second native dialog from a double tap.
    assert.equal(calls.length, 1);
    release(); await pending;
    assert.deepEqual(calls, [["order-123", file], ["https://repair.example/api/print-pdfs/test.pdf", file.name]]);
    assert.equal(render().downloadUrl, "https://repair.example/api/print-pdfs/test.pdf");
    assert.equal(render().sharing, false);
  });
});

test("supported system file sharing stays local and cancellation is silent", async () => {
  let shares = 0;
  await withHook({ navigator: { canShare: () => true, share: async () => { shares++; throw Object.assign(new Error("cancel"), { name: "AbortError" }); } },
    prepare: () => { throw new Error("must not upload"); }
  }, async render => {
    assert.equal(render().canShare, true);
    await render().share();
    assert.equal(shares, 1);
    assert.equal(render().error, "");
  });
});

test("throwing canShare and native failures preserve the browser download alternative", async () => {
  await withHook({ navigator: { canShare: () => { throw new Error("unsupported"); }, share() {} },
    prepare: async () => ({ path: "/api/print-pdfs/test.pdf" }),
    save: async () => { throw new Error("钉盘未能打开"); }
  }, async render => {
    assert.equal(render().canShare, false);
    await render().share();
    assert.equal(render().error, "钉盘未能打开");
    assert.ok(render().downloadUrl.startsWith("https://"));
    assert.equal(render().sharing, false);
  });
});
