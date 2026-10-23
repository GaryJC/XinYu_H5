import { pendingRepairList,pendingRepairCommand,pendingRepairFollowups } from '../services/pendingRepairsService.mjs';
import { readJson,sendJson } from '../http/response.mjs';
export async function handlePendingRepairs(req,res,url,actor) {
 if(req.method==='GET'&&url.pathname==='/api/pending-repairs'){sendJson(res,200,await pendingRepairFollowups(actor));return true;}
 const match=url.pathname.match(/^\/api\/work-orders\/([^/]+)\/pending-repairs$/);if(!match)return false;
 const id=decodeURIComponent(match[1]);
 if(req.method==='GET'){sendJson(res,200,await pendingRepairList(actor,id));return true;}
 if(req.method==='POST'){sendJson(res,200,await pendingRepairCommand(actor,id,await readJson(req)));return true;}
 return false;
}
