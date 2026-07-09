import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.API_PROXY_TARGET || `http://localhost:${process.env.API_PORT || "8787"}`;
const devPort = Number(process.env.VITE_PORT || 5173);

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
      "/api": apiProxyTarget
    }
  }
});
