import {procurementAccess} from '../domain/procurement.mjs';
import {validateRepairPhoto} from './repairPhotoService.mjs';
import {transaction,pool} from '../database/pool.mjs';
import {currentActor} from '../repositories/procurementRepository.mjs';
import {saveProcurementPhoto,assertProcurementPhotos} from '../repositories/procurementPhotoRepository.mjs';
import {saveUploadedFile,readStoredFile} from '../storage.mjs';
import {HttpError} from '../http/HttpError.mjs';
export async function uploadProcurementPhoto(user,input) {
 procurementAccess(user);validateRepairPhoto({...input,purpose:undefined});
 return transaction(async db=>{
  const fresh=await currentActor(user,db);procurementAccess(fresh);
  if(fresh.shopId!==user.shopId)throw new HttpError(403,'门店权限已变更');
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`procurement-photo:${user.id}:${input.requestId}`]);
  const prior=await db.query('select f.id from files f join procurement_photos p on p.file_id=f.id where f.uploaded_by=$1 and f.upload_request_id=$2 and p.shop_id=$3',[user.id,input.requestId,user.shopId]);
  if(prior.rows.length)return {id:prior.rows[0].id};
  const file=await saveUploadedFile({kind:'other',fileName:input.fileName,mimeType:input.mimeType,imageBase64:input.imageBase64,uploadedBy:user.id,uploadRequestId:input.requestId,database:db});
  await saveProcurementPhoto(db,user,file.id);return {id:file.id};
 });
}
export async function procurementPhoto(user,id) {
 procurementAccess(user);await assertProcurementPhotos(pool,user.shopId,[id]);return readStoredFile(id);
}
