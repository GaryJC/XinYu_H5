import {selectSingleVehicleLicense,assertLicenseReuseIdentity} from './vehicleLicenseHistoryRepository.mjs';
import { HttpError } from "../http/HttpError.mjs";

// Called inside the draft's transaction: a failed attachment rolls back the draft too.
export async function attachDraftVehicleLicense(client, order, userId) {
  const fileId = order.inspection?.vehicleLicenseFileId;
  if (fileId === undefined) return;
  if (typeof fileId !== "string" || !fileId.trim()) throw new HttpError(400, "行驶证图片 ID 不正确");
  const {rows} = await client.query(`select * from files where id=$1 and kind='vehicle_license'
    and (order_id=$2 or (order_id is null and uploaded_by=$3)) for update`, [fileId, order.id, userId || null]);
  if (!rows.length) throw new HttpError(400, "行驶证照片不存在、无权使用或已关联其他委托单");
  assertLicenseReuseIdentity(rows[0],order.vehicle?.vin);
  if(order.inspection?.replacedPhotoIds?.includes(fileId))throw new HttpError(409,"该行驶证已替换，请重新上传");
  await client.query("update files set order_id=$2 where id=$1", [fileId,order.id]);
  await client.query("update ocr_records set order_id=$2 where file_id=$1 and (order_id is null or order_id=$2)", [fileId,order.id]);
  await selectSingleVehicleLicense(client,order.id,fileId,order.inspection,order.vehicle?.vin);
}
