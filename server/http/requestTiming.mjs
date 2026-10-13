import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const timings = new AsyncLocalStorage();
const measuredPaths = /^\/api\/(?:ocr\/(?:vehicle-license|license-plate|vin)|files|company-system\/vehicles\/lookup|work-orders\/[^/]+\/ocr-records)$/;

export function withRequestTiming(req, res, pathname, operation) {
  if (req.method !== "POST" || !measuredPaths.test(pathname)) return operation();
  const state = { requestId: randomUUID(), started: performance.now(), stages: {} };
  res.setHeader("X-Request-Id", state.requestId);
  res.once("finish", () => console.info("[request-timing]", JSON.stringify({
    requestId: state.requestId, path: pathname, status: res.statusCode,
    durationMs: round(performance.now() - state.started), stages: state.stages
  })));
  return timings.run(state, operation);
}

export async function measureStage(name, operation) {
  const state = timings.getStore();
  if (!state) return operation();
  const started = performance.now();
  try {
    return await operation();
  } finally {
    state.stages[name] = round((state.stages[name] || 0) + performance.now() - started);
  }
}

export function writeTimingHeaders(res) {
  const state = timings.getStore();
  if (!state) return;
  const stages = { ...state.stages, server_total: round(performance.now() - state.started) };
  res.setHeader("Server-Timing", Object.entries(stages).map(([name, duration]) => `${name};dur=${duration}`).join(", "));
}

function round(value) { return Math.round(value * 10) / 10; }
