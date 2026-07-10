import path from "node:path";
import { createServer } from "node:http";
import { serverConfig } from "./config/env.mjs";
import { closePool } from "./database/pool.mjs";
import { HttpError } from "./http/HttpError.mjs";
import { sendJson } from "./http/response.mjs";
import { serveStatic } from "./http/staticFiles.mjs";
import { handleApiRequest } from "./routes/apiRouter.mjs";

const config = serverConfig();
const distDir = path.resolve(config.distDir);

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, 204, null);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (await handleApiRequest(req, res, url)) return;
    await serveStatic(res, url.pathname, distDir);
  } catch (error) {
    console.error(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(res, status, { error: error instanceof Error ? error.message : "Server error" });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Repair API server listening on http://localhost:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}
