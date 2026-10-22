import { randomBytes } from "node:crypto";
import { HttpError } from "../http/HttpError.mjs";
import { assertWorkOrderAccess } from "../repositories/accessRepository.mjs";

// Short-lived handoff to a native file viewer, never an authentication token.
// Deliberately ephemeral: a restart invalidates outstanding links.
export function createPrintPdfStore({ now = Date.now, ttl = 5 * 60_000, maxBytes = 32 * 1024 * 1024 } = {}) {
  const entries = new Map();
  let bytes = 0;
  function remove(token) {
    const entry = entries.get(token);
    if (entry) { bytes -= entry.body.length; entries.delete(token); }
  }
  function prune() {
    for (const [token, entry] of entries) if (entry.expiresAt <= now()) remove(token);
  }
  const timer = setInterval(prune, Math.min(ttl, 60_000));
  timer.unref();
  return {
    put({ pdfBase64, fileName, userId }) {
      prune();
      if (typeof pdfBase64 !== "string" || pdfBase64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) {
        throw new HttpError(400, "PDF 文件内容无效或过大");
      }
      const body = Buffer.from(pdfBase64, "base64");
      if (body.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(400, "仅支持 PDF 文件");
      // Keep one outstanding handoff per user; never evict another user's file.
      for (const [token, entry] of entries) if (entry.userId === userId) remove(token);
      if (bytes + body.length > maxBytes) throw new HttpError(503, "文件服务繁忙，请稍后重试");
      const token = randomBytes(32).toString("hex");
      const expiresAt = now() + ttl;
      entries.set(token, { body, userId, expiresAt, fileName: String(fileName || "机动车修理委托书.pdf").replace(/[\r\n/\\]/g, "_").slice(0, 160) });
      bytes += body.length;
      return { path: `/api/print-pdfs/${token}.pdf`, expiresAt: new Date(expiresAt).toISOString() };
    },
    get(token) {
      prune();
      const entry = entries.get(token);
      if (!entry) throw new HttpError(404, "文件链接已过期，请返回委托单重新打开 PDF");
      return entry;
    },
    close() { clearInterval(timer); entries.clear(); bytes = 0; }
  };
}

const store = createPrintPdfStore();
export async function preparePrintPdf(orderId, input, user) {
  await assertWorkOrderAccess(orderId, user);
  return store.put({ ...input, userId: user.id });
}
export const readPrintPdf = token => store.get(token);
