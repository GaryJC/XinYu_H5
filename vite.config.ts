import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";

const appVersion = randomUUID();

const apiProxyTarget = process.env.API_PROXY_TARGET || `http://localhost:${process.env.API_PORT || "8787"}`;
const devPort = Number(process.env.VITE_PORT || 5173);
const isProductionBuild = process.env.APP_ENV === "production";

if (isProductionBuild && !process.env.VITE_DINGTALK_CLIENT_ID?.trim()) {
  throw new Error("VITE_DINGTALK_CLIENT_ID is required for a production build");
}

export default defineConfig({
  root: "client",
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), {
    name: "app-version-manifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "app-version.json", source: JSON.stringify({ version: appVersion }) });
    }
  }],
  build: {
    manifest: true,
    // Font subsets should remain cacheable files, not base64 in print JavaScript.
    assetsInlineLimit: (filePath) => /\.woff2?$/.test(filePath) ? false : undefined,
    target: ["chrome80", "safari13"],
    // Keep max-width media queries: Vite's modern defaults rewrite them to
    // range syntax (width <= ...), which older DingTalk WebViews ignore.
    cssTarget: ["chrome80", "safari13"],
    outDir: "../dist",
    emptyOutDir: true
  },
  css: {
    postcss: {
      plugins: [{
        postcssPlugin: "print-font-woff2-only",
        Once(root) {
          // Chrome 80 / Safari 13 both support WOFF2. Keep every Unicode subset
          // and weight, but do not ship a duplicate WOFF copy of the same font.
          root.walkDecls("src", declaration => {
            const isPrintFont = declaration.parent?.nodes.some(node =>
              node.type === "decl" && node.prop === "font-family" && /['"]?Noto Serif SC['"]?/.test(node.value)
            );
            if (isPrintFont) {
              declaration.value = declaration.value.replace(/,\s*url\([^)]*\.woff['"]?\)\s*format\(['"]woff['"]\)/g, "");
            }
          });
        }
      }]
    }
  },
  server: {
    host: "0.0.0.0",
    port: devPort,
    proxy: {
      "/api/supplier-portal": { target: apiProxyTarget, changeOrigin: false },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
