import { readJson, sendJson } from '../http/response.mjs';
import { requireAnyRole } from '../domain/accessPolicy.mjs';
import { DISPATCH_ROLES } from '../domain/dispatchPolicy.mjs';
import { queryDispatchTasks, technicianSummaries, dispatchPeople, dispatchDetail, executeDispatchAction } from '../services/dispatchService.mjs';
export async function handleDispatchRequest(req,res,url,actor) {
  if(!url.pathname.startsWith('/api/dispatch/')) return false;
  requireAnyRole(actor,DISPATCH_ROLES);
  const query=Object.fromEntries(url.searchParams);
  if(req.method==='GET' && url.pathname==='/api/dispatch/tasks') { sendJson(res,200,await queryDispatchTasks(actor,query)); return true; }
  if(req.method==='GET' && url.pathname==='/api/dispatch/technicians') { sendJson(res,200,await technicianSummaries(actor,query)); return true; }
  if(req.method==='GET' && url.pathname==='/api/dispatch/people') {
    const people=await dispatchPeople(actor);
    sendJson(res,200,{technicians:people.filter(p=>p.active && p.role==='technician'),inspectors:people.filter(p=>p.active && ['inspector','manager'].includes(p.role) && p.id!==actor.id)}); return true;
  }
  const personal=url.pathname.match(/^\/api\/dispatch\/technicians\/([^/]+)\/tasks$/);
  if(req.method==='GET' && personal) { requireAnyRole(actor,['manager','advisor']); sendJson(res,200,await queryDispatchTasks(actor,{...query,technicianId:decodeURIComponent(personal[1])})); return true; }
  const match=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)(\/actions)?$/);
  if(match && req.method==='GET' && !match[2]) { sendJson(res,200,await dispatchDetail(actor,decodeURIComponent(match[1]))); return true; }
  if(match && req.method==='POST' && match[2]) { sendJson(res,200,await executeDispatchAction(actor,decodeURIComponent(match[1]),await readJson(req))); return true; }
  sendJson(res,404,{error:'派工接口不存在'}); return true;
}
