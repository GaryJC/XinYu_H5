import fs from "node:fs/promises";
import path from "node:path";
import { sendJson } from "./response.mjs";

export async function serveStatic(res, pathname, distDir) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(distDir, requested);
  const relative = path.relative(distDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  if (await sendFile(res, target)) return;
  if (await sendFile(res, path.join(distDir, "index.html"))) return;
  sendJson(res, 404, { error: "Not found" });
}

async function sendFile(res, target) {
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return false;
    const body = await fs.readFile(target);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType(target));
    res.setHeader("Content-Length", body.byteLength);
    res.setHeader("Cache-Control", target.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}
