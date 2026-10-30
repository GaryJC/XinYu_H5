import {uploadProcurementPhoto,procurementPhoto} from '../services/procurementPhotoService.mjs';
import {readStoredFile} from '../storage.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { readJson,sendJson } from '../http/response.mjs';
import * as service from '../services/procurementService.mjs';
function sendPhoto(res,file) {res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',file.record.mimeType);res.end(file.body);}
const cookieName='procurement_supplier';
async function readInput(req) {const input=await readJson(req);if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'请求内容必须是JSON对象');return input;}
function sessionCookie(req) {return (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1)||'';}
export async function handleSupplierPortal(req,res,url) {
  if(!url.pathname.startsWith('/api/supplier-portal/'))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const photo=url.pathname.match(/^\/api\/supplier-portal\/photos\/([^/]+)$/);
  if(photo&&req.method==='GET'){await service.authorizePortalPhoto(sessionCookie(req),photo[1]);sendPhoto(res,await readStoredFile(photo[1]));return true;}
  if(req.method==='POST') {
    // JSON-only mutations and same-origin checks prevent form-based and cross-site session injection.
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new HttpError(415,'请使用JSON请求');
    if(req.headers.origin) {let origin;try{origin=new URL(req.headers.origin);}catch{throw new HttpError(403,'来源无效');}if(origin.host!==req.headers.host)throw new HttpError(403,'不允许跨站提交');}
    if(req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'不允许跨站提交');
  }
  if(req.method==='POST'&&url.pathname==='/api/supplier-portal/verify') {
    const result=await service.verifyPortal(await readInput(req),req.socket.remoteAddress||'unknown');
    const secure=process.env.APP_ENV==='production'||req.socket.encrypted;
    res.setHeader('Set-Cookie',`${cookieName}=${result.session}; HttpOnly; SameSite=Strict; Path=/api/supplier-portal; Max-Age=${result.maxAge}${secure?'; Secure':''}`);
    sendJson(res,200,{ok:true});return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/supplier-portal/resume') {sendJson(res,200,await service.resumePortal(sessionCookie(req),await readInput(req)));return true;}
  if(req.method==='GET'&&url.pathname==='/api/supplier-portal/me') {sendJson(res,200,await service.portal(sessionCookie(req)));return true;}
  if(req.method==='POST'&&url.pathname==='/api/supplier-portal/quote') {sendJson(res,200,await service.quote(sessionCookie(req),await readInput(req)));return true;}
  if(req.method==='POST'&&url.pathname==='/api/supplier-portal/feedback') {sendJson(res,200,await service.feedback(sessionCookie(req),await readInput(req)));return true;}
  throw new HttpError(404,'接口不存在');
}
export async function handleProcurement(req,res,url,user) {
  if(!url.pathname.startsWith('/api/procurement/'))return false;
  res.setHeader('Cache-Control','no-store');
  const suffix=url.pathname.slice('/api/procurement/'.length),method=req.method;
  const photo=suffix.match(/^photos\/([^/]+)$/);
  if(photo&&method==='GET'){sendPhoto(res,await procurementPhoto(user,photo[1]));return true;}
  let result;
  if(suffix==='photos'&&method==='POST'){sendJson(res,200,await uploadProcurementPhoto(user,await readInput(req)));return true;}
  if(suffix==='suppliers'&&method==='GET')result=await service.listSuppliers(user);
  else if(suffix==='suppliers'&&method==='POST')result=await service.updateSupplier(user,null,await readInput(req));
  else if(/^suppliers\/[^/]+$/.test(suffix)&&method==='PUT')result=await service.updateSupplier(user,suffix.split('/')[1],await readInput(req));
  else if(suffix==='tenders'&&method==='GET')result=await service.listTenders(user,Object.fromEntries(url.searchParams));
  else if(suffix==='tenders'&&method==='POST')result=await service.publishTender(user,await readInput(req));
  else if(/^tenders\/[^/]+$/.test(suffix)&&method==='GET')result=await service.tenderDetail(user,suffix.split('/')[1]);
  else if(/^tenders\/[^/]+\/actions$/.test(suffix)&&method==='POST')result=await service.tenderAction(user,suffix.split('/')[1],await readInput(req));
  else if(suffix==='analytics'&&method==='GET')result=await service.analytics(user,url.searchParams.get('from'),url.searchParams.get('to'),url.searchParams.get('category'));
  else if(suffix==='reports'&&method==='GET')result=await service.reports(user);
  else if(suffix==='reports'&&method==='POST')result=await service.createReport(user,await readInput(req));
  else if(/^reports\/[^/]+$/.test(suffix)&&method==='GET')result=await service.reportDetail(user,suffix.split('/')[1]);
  else if(/^reports\/[^/]+\/actions$/.test(suffix)&&method==='POST')result=await service.reportAction(user,suffix.split('/')[1],await readInput(req));
  else throw new HttpError(404,'接口不存在');
  sendJson(res,200,result);return true;
}
