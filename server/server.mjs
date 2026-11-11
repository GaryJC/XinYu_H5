import {startVehicleInsuranceNotifications} from './workers/vehicleInsuranceNotifications.mjs';
import {drainServer} from './http/drainServer.mjs';
import {startRuntimeMetrics} from './workers/runtimeMetrics.mjs';
import {startVehicleTripNotifications} from './workers/vehicleTripNotifications.mjs';
import { startProcurementWorker } from "./workers/procurementWorker.mjs";
import {startRepairWritebacks} from './workers/repairWritebackWorker.mjs';
import {startVehicleLicenseExceptionNotifications} from './workers/vehicleLicenseExceptionNotifications.mjs';
import { startDispatchNotifications } from "./workers/dispatchNotifications.mjs";
import { startLegacySyncRecovery } from "./workers/legacySyncRecovery.mjs";
import path from "node:path";
import { createServer } from "node:http";
import { serverConfig } from "./config/env.mjs";
import { closePool } from "./database/pool.mjs";
import { closeSqlServerPool } from "./database/sqlServerPool.mjs";
import { HttpError } from "./http/HttpError.mjs";
import { sendJson, sendError } from "./http/response.mjs";
import { serveStatic } from "./http/staticFiles.mjs";
import { handleApiRequest } from "./routes/apiRouter.mjs";
import { withRequestTiming } from "./http/requestTiming.mjs";

const config = serverConfig();
const stopMetrics=startRuntimeMetrics();
const stopRepairWritebacks = startRepairWritebacks();
const stopNotifications = startDispatchNotifications();
const stopLegacySyncRecovery = startLegacySyncRecovery();
const stopProcurement = startProcurementWorker();
const stopLicenseNotifications = startVehicleLicenseExceptionNotifications();
const stopInsuranceNotifications = startVehicleInsuranceNotifications();
const stopTripNotifications = startVehicleTripNotifications();
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
      sendError(res, error);
    }
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Repair API server listening on http://localhost:${config.port}`);
});

let stopping=false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if(stopping)return;
    stopping=true;
    const deadline=setTimeout(()=>{console.error('[shutdown] drain deadline exceeded');process.exit(1);},60000);
    deadline.unref();
    try {
      // Calling stop immediately prevents new leases while in-flight HTTP drains.
      await drainServer(server,[stopInsuranceNotifications,stopMetrics,stopRepairWritebacks,stopNotifications,stopProcurement,stopLicenseNotifications,stopTripNotifications,stopLegacySyncRecovery],[closePool,closeSqlServerPool]);
      clearTimeout(deadline);process.exit(0);
    } catch(error) {console.error('[shutdown]',{code:error.code});process.exit(1);}
  });
}
