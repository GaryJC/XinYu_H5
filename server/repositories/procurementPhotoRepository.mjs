import {HttpError} from '../http/HttpError.mjs';
export async function saveProcurementPhoto(db,user,fileId) {
 await db.query('insert into procurement_photos(file_id,shop_id,uploaded_by) values($1,$2,$3)',[fileId,user.shopId,user.id]);
}
export async function assertProcurementPhotos(db,shopId,ids) {
 if(!ids?.length)return;
 const {rows}=await db.query('select file_id from procurement_photos where shop_id=$1 and file_id=any($2::text[])',[shopId,ids]);
 if(rows.length!==ids.length)throw new HttpError(403,'铭牌照片不存在或不属于本门店');
}
