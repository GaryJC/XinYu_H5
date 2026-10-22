import { preparePrintPdf, readPrintPdf } from "../services/printPdfService.mjs";
import { readJson, sendJson } from "../http/response.mjs";

export function handlePrintPdfDownload(req, res, url) {
  const match = url.pathname.match(/^\/api\/print-pdfs\/([a-f0-9]{64})\.pdf$/);
  if (!match || !["GET", "HEAD"].includes(req.method)) return false;
  const file = readPrintPdf(match[1]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", file.body.length);
  res.setHeader("Content-Disposition", `attachment; filename="work-order.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g, "%27")}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(req.method === "HEAD" ? undefined : file.body);
  return true;
}

export async function handlePrintPdfUpload(req, res, url, user) {
  const match = url.pathname.match(/^\/api\/work-orders\/([^/]+)\/print-pdf$/);
  if (req.method !== "POST" || !match) return false;
  sendJson(res, 201, await preparePrintPdf(match[1], await readJson(req), user));
  return true;
}
