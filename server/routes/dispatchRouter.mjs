import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import {resolveRepairWriteback,retryRepairWriteback} from '../services/repairWritebackService.mjs';
import { warehouseVehiclePartsHistory,warehouseHistoricalPartStock,warehouseStockOptions,searchWarehouseStock } from '../services/warehouseStockService.mjs';
import { uploadRepairPhoto, deleteRepairPhoto } from '../services/repairPhotoService.mjs';
import { readJson, sendJson } from '../http/response.mjs';
import { requireAnyRole } from '../domain/accessPolicy.mjs';
import { DISPATCH_ROLES } from '../domain/dispatchPolicy.mjs';
import { myRepairCounts, queryDispatchTasks, technicianSummaries, dispatchPeople, dispatchDetail, executeDispatchAction } from '../services/dispatchService.mjs';
export async function handleDispatchRequest(req,res,url,actor) {
  if(!url.pathname.startsWith('/api/dispatch/')) return false;
  requireAnyRole(actor,DISPATCH_ROLES);
  const query=Object.fromEntries(url.searchParams);
  if(req.method==='GET' && url.pathname==='/api/dispatch/my-counts') {sendJson(res,200,await myRepairCounts(actor));return true;}
  if(req.method==='GET' && url.pathname==='/api/dispatch/tasks') { sendJson(res,200,await queryDispatchTasks(actor,query)); return true; }
  if(req.method==='GET' && url.pathname==='/api/dispatch/technicians') { sendJson(res,200,await technicianSummaries(actor,query)); return true; }
  if(req.method==='GET' && url.pathname==='/api/dispatch/people') {
    const people=await dispatchPeople(actor);
    sendJson(res,200,{contractors:people.filter(p=>p.active && (hasRole(p, 'outsourcing')||p.outsourcingRoleMember)),technicians:people.filter(p=>p.active && hasRole(p, 'technician')),inspectors:people.filter(p=>p.active && (hasRole(p, 'manager')||p.inspectorRoleMember!==false) && hasAnyRole(p, ['inspector','manager']) && p.id!==actor.id)}); return true;
  }
  const resolveWriteback=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)\/repair-writeback\/resolve$/);
  if(resolveWriteback&&req.method==='POST'){sendJson(res,200,await resolveRepairWriteback(actor,decodeURIComponent(resolveWriteback[1]),await readJson(req)));return true;}
  const retryWriteback=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)\/repair-writeback\/retry$/);
  if(retryWriteback&&req.method==='POST'){sendJson(res,200,await retryRepairWriteback(actor,decodeURIComponent(retryWriteback[1])));return true;}
  const history=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)\/parts-history(\/stock)?$/);
  if(history&&req.method==='GET') {
    const id=decodeURIComponent(history[1]);
    sendJson(res,200,history[2]?await warehouseHistoricalPartStock(actor,id,query):await warehouseVehiclePartsHistory(actor,id));return true;
  }
  const stock=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)\/parts-stock(\/warehouses)?$/);
  if(stock&&req.method==='GET') {
    const id=decodeURIComponent(stock[1]);
    sendJson(res,200,stock[2]?await warehouseStockOptions(actor,id):await searchWarehouseStock(actor,id,query));return true;
  }
  const deletePhoto=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)\/photos\/([^/]+)$/);
  if(deletePhoto && req.method==='DELETE') {sendJson(res,200,await deleteRepairPhoto(actor,decodeURIComponent(deletePhoto[1]),decodeURIComponent(deletePhoto[2])));return true;}
  const photo=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)\/photos$/);
  if(photo && req.method==='POST') {sendJson(res,201,await uploadRepairPhoto(actor,decodeURIComponent(photo[1]),await readJson(req)));return true;}
  const personal=url.pathname.match(/^\/api\/dispatch\/technicians\/([^/]+)\/tasks$/);
  if(req.method==='GET' && personal) { requireAnyRole(actor,['manager','advisor']); sendJson(res,200,await queryDispatchTasks(actor,{...query,technicianId:decodeURIComponent(personal[1])})); return true; }
  const match=url.pathname.match(/^\/api\/dispatch\/tasks\/([^/]+)(\/actions)?$/);
  if(match && req.method==='GET' && !match[2]) { sendJson(res,200,await dispatchDetail(actor,decodeURIComponent(match[1]))); return true; }
  if(match && req.method==='POST' && match[2]) { sendJson(res,200,await executeDispatchAction(actor,decodeURIComponent(match[1]),await readJson(req))); return true; }
  sendJson(res,404,{error:'派工接口不存在'}); return true;
}
