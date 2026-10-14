import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("production CSS preserves mobile media queries for older DingTalk WebViews", async () => {
  // Use the real project configuration and stylesheet. Source-only checks miss
  // the minifier rewriting otherwise compatible max-width queries.
  const result = await build({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    build: {
      write: false,
      rolldownOptions: {
        input: fileURLToPath(new URL("../client/src/styles.css", import.meta.url))
      }
    }
  });
  const css = result.output
    .filter((asset) => asset.type === "asset" && asset.fileName.endsWith(".css"))
    .map((asset) => String(asset.source))
    .join("\n");
  assert.ok(css.length > 1000);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)/);
  assert.doesNotMatch(css, /@media[^{}]*[<>]=?/);
  const mobileStyles = css.slice(css.indexOf("@media (max-width:760px)"));
  assert.match(mobileStyles, /\.metric-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(mobileStyles, /[^{}]*\.field-grid[^{}]*\{[^}]*grid-template-columns:1fr/);
  assert.match(mobileStyles, /\.vehicle-identity-grid\{[^}]*grid-template-columns:1fr/);
  assert.match(mobileStyles, /\.identifier-scanner\{[^}]*flex-direction:column/);
});
