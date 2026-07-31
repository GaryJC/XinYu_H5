import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.API_PROXY_TARGET || `http://localhost:${process.env.API_PORT || "8787"}`;
const devPort = Number(process.env.VITE_PORT || 5173);
const isProductionBuild = process.env.APP_ENV === "production";

if (isProductionBuild && !process.env.VITE_DINGTALK_CLIENT_ID?.trim()) {
  throw new Error("VITE_DINGTALK_CLIENT_ID is required for a production build");
}

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: devPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
