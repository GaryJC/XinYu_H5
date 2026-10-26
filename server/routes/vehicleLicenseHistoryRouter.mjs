import {readJson,sendJson} from '../http/response.mjs';
import {readStoredFile} from '../storage.mjs';
import {vehicleLicenseHistory,reuseVehicleLicense,authorizeLicensePreview} from '../services/vehicleLicenseHistoryService.mjs';
export async function handleVehicleLicenseHistory(req,res,url,actor) {
 if(req.method==='POST'&&url.pathname==='/api/vehicle-licenses/history'){sendJson(res,200,await vehicleLicenseHistory(actor,await readJson(req)));return true;}
 if(req.method==='POST'&&url.pathname==='/api/vehicle-licenses/reuse'){sendJson(res,200,await reuseVehicleLicense(actor,await readJson(req)));return true;}
 if(req.method==='GET'&&url.pathname==='/api/vehicle-licenses/preview') {
  const id=await authorizeLicensePreview(actor,{fileId:url.searchParams.get('fileId'),vin:url.searchParams.get('vin')});
  const {record,body}=await readStoredFile(id);
  res.setHeader('Content-Type',record.mimeType);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy','sandbox');res.end(body);return true;
 }
 return false;
}
