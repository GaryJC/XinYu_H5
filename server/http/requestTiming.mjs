import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const timings = new AsyncLocalStorage();
const literals=new Set(['api','auth','me','dev-login','dingtalk-login','work-orders','dispatch','tasks','actions','people','technicians','my-counts','my-completed-projects','files','content','ocr','vehicle-license','license-plate','vin','company-system','vehicles','lookup','ocr-records','photos','vehicle-trips','trips','procurement','tenders','supplier-portal','verify','health','dashboard','analytics']);


export function withRequestTiming(req, res, pathname, operation) {
  if(!pathname.startsWith('/api/'))return operation();

  const route=pathname.split('/').map(part=>!part||literals.has(part)?part:':id').join('/');
  const state = { requestId: randomUUID(), started: performance.now(), stages: {} };
  res.setHeader("X-Request-Id", state.requestId);
  res.once("finish", () => {
    const durationMs=round(performance.now()-state.started);
    if(res.statusCode>=400||durationMs>=1000||Math.random()<0.05)console.info("[request-timing]",JSON.stringify({
      requestId:state.requestId,path:route,method:req.method,status:res.statusCode,durationMs,stages:state.stages
    }));
  });
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
