import { readOrderOverview } from '../repositories/orderOverviewRepository.mjs';
import { prepareOrderPhotoExport, readOrderPhotoExport } from '../services/orderPhotoExportService.mjs';
import { readJson, sendJson } from '../http/response.mjs';
export function handleOrderPhotoDownload(req,res,url) {
  const match=url.pathname.match(/^\/api\/order-photo-documents\/([a-f0-9]{64})\.docx$/);
  if (!match || !['GET','HEAD'].includes(req.method)) return false;
  const file=readOrderPhotoExport(match[1]);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Length',file.body.length);
  res.setHeader('Content-Disposition',`attachment; filename="order-photos.docx"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g,'%27')}`);
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(req.method==='HEAD'?undefined:file.body); return true;
}
export async function handleOrderOverview(req,res,url,user) {
  const match=url.pathname.match(/^\/api\/work-orders\/([^/]+)\/(overview|photo-document)$/);
  if(!match) return false;
  const id=decodeURIComponent(match[1]);
  if(req.method==='GET'&&match[2]==='overview') {sendJson(res,200,await readOrderOverview(id,user));return true;}
  if(req.method==='POST'&&match[2]==='photo-document') {sendJson(res,201,await prepareOrderPhotoExport(id,await readJson(req),user));return true;}
  return false;
}
