import { readJson,sendJson } from '../http/response.mjs';
import { purchaseDocumentAccess,purchaseDocumentConfig,processPurchaseDocuments } from '../services/purchaseDocumentService.mjs';
import { HttpError } from '../http/HttpError.mjs';
export async function handlePurchaseDocuments(req,res,url,user){
 if(!url.pathname.startsWith('/api/purchase-documents/'))return false;
 purchaseDocumentAccess(user);res.setHeader('Cache-Control','no-store');
 const action=url.pathname.slice('/api/purchase-documents/'.length);
 if(req.method==='GET'&&action==='config'){sendJson(res,200,purchaseDocumentConfig(user));return true;}
 if(req.method==='POST'&&['preview','generate'].includes(action)){sendJson(res,200,await processPurchaseDocuments(user,await readJson(req),action));return true;}
 throw new HttpError(404,'接口不存在');
}
