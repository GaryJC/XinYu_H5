import { createServer } from "node:http";
import {
  HttpError,
  createSignatureTokenForOrder,
  createWorkOrder,
  findWorkOrderByToken,
  healthCheck,
  listWorkOrders,
  signWorkOrderByToken,
  transitionWorkOrder,
  updateWorkOrder
} from "./db.mjs";

const port = Number(process.env.API_PORT || 8787);

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, null);
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, await healthCheck());
    }

    if (req.method === "GET" && url.pathname === "/api/work-orders") {
      const role = url.searchParams.get("role") || "manager";
      return send(res, 200, await listWorkOrders(role));
    }

    if (req.method === "POST" && url.pathname === "/api/work-orders") {
      const { draft, actor } = await readJson(req);
      return send(res, 201, await createWorkOrder(draft, actor));
    }

    const workOrderMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)$/);
    if (workOrderMatch && req.method === "PUT") {
      const { order, actor, action } = await readJson(req);
      if (!order || order.id !== workOrderMatch[1]) return send(res, 400, { error: "委托单参数不一致" });
      return send(res, 200, await updateWorkOrder(order, actor, action));
    }

    const transitionMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/transition$/);
    if (transitionMatch && req.method === "POST") {
      const { status, actor, action, patch = {} } = await readJson(req);
      return send(res, 200, await transitionWorkOrder(transitionMatch[1], status, actor, action, patch));
    }

    const tokenMatch = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/signature-token$/);
    if (tokenMatch && req.method === "POST") {
      const { actor } = await readJson(req);
      return send(res, 200, await createSignatureTokenForOrder(tokenMatch[1], actor));
    }

    const signatureMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)$/);
    if (signatureMatch && req.method === "GET") {
      const order = await findWorkOrderByToken(signatureMatch[1]);
      if (!order) return send(res, 404, { error: "签字链接不存在或已失效" });
      return send(res, 200, order);
    }

    const signMatch = url.pathname.match(/^\/api\/signatures\/([^/]+)\/sign$/);
    if (signMatch && req.method === "POST") {
      const { signature } = await readJson(req);
      return send(res, 200, await signWorkOrderByToken(signMatch[1], signature));
    }

    return send(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    send(res, status, { error: error instanceof Error ? error.message : "Server error" });
  }
});

server.listen(port, () => {
  console.log(`Repair API server listening on http://localhost:${port}`);
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (body == null) return res.end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
