import {startVehicleLicenseExceptionNotifications} from './workers/vehicleLicenseExceptionNotifications.mjs';
import { startDispatchNotifications } from "./workers/dispatchNotifications.mjs";
import path from "node:path";
import { createServer } from "node:http";
import { serverConfig } from "./config/env.mjs";
import { closePool } from "./database/pool.mjs";
import { closeSqlServerPool } from "./database/sqlServerPool.mjs";
import { HttpError } from "./http/HttpError.mjs";
import { sendJson } from "./http/response.mjs";
import { serveStatic } from "./http/staticFiles.mjs";
import { handleApiRequest } from "./routes/apiRouter.mjs";
import { withRequestTiming } from "./http/requestTiming.mjs";

const config = serverConfig();
const stopNotifications = startDispatchNotifications();
const stopLicenseNotifications = startVehicleLicenseExceptionNotifications();
const distDir = path.resolve(config.distDir);

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    sendJson(res, 400, { error: "请求 URL 无效" });
    return;
  }
  return withRequestTiming(req, res, url.pathname, async () => {
    try {
      if (req.method === "OPTIONS") return sendJson(res, 204, null);
      if (await handleApiRequest(req, res, url)) return;
      await serveStatic(res, url.pathname, distDir);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, status, { error: error instanceof Error ? error.message : "Server error" });
    }
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Repair API server listening on http://localhost:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await stopNotifications();
      await stopLicenseNotifications();
      await Promise.all([closePool(), closeSqlServerPool()]);
      process.exit(0);
    });
  });
}
