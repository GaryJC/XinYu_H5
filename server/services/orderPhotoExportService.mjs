import { randomBytes } from 'node:crypto';
import { readOrderOverview } from '../repositories/orderOverviewRepository.mjs';
import { readStoredFile } from '../storage.mjs';
import { assertFileReadAccess } from '../repositories/fileRepository.mjs';
import { collectOrderPhotoAlbums, photoAlbumLabels } from '../../shared/orderPhotoAlbums.mjs';
import { buildOrderPhotoDocument } from './orderPhotoDocument.mjs';
import { HttpError } from '../http/HttpError.mjs';

const downloads = new Map();
const running = new Set();
function prune() { for (const [key,value] of downloads) if (value.expiresAt <= Date.now()) downloads.delete(key); }
const timer = setInterval(prune, 60000); timer.unref();
export function validatePhotoCategories(input) {
  const categories = input?.categories;
  if (!Array.isArray(categories) || !categories.length || categories.length > 3 || categories.some(key => !Object.hasOwn(photoAlbumLabels,key)) || new Set(categories).size !== categories.length) throw new HttpError(400,'请选择有效的照片分类');
  return categories;
}
export async function prepareOrderPhotoExport(id, input, user) {
  const categories = validatePhotoCategories(input);
  if (running.has(user.id) || running.size >= 3) throw new HttpError(429,'正在生成照片文档，请稍后重试');
  running.add(user.id);
  try {
    const {order,dispatch} = await readOrderOverview(id,user);
    const albums = collectOrderPhotoAlbums(order,dispatch.files);
    const photos = Object.keys(photoAlbumLabels).filter(key=>categories.includes(key)).flatMap(category=>albums[category].map(photo=>({...photo,category})));
    if (!photos.length) throw new HttpError(400,'所选分类暂无照片');
    if (photos.length > 300) throw new HttpError(413,'照片超过 300 张，请分分类导出');
    const body = await buildOrderPhotoDocument(order,photos,async fileId=> {
      await assertFileReadAccess(fileId,user);
      try { return (await readStoredFile(fileId)).body; }
      catch { throw new HttpError(502,'部分照片读取失败，未生成不完整文档，请稍后重试'); }
    });
    prune();
    for (const [key,value] of downloads) if (value.userId===user.id) downloads.delete(key);
    if ([...downloads.values()].reduce((sum,file)=>sum+file.body.length,body.length) > 96*1024*1024) throw new HttpError(503,'文件服务繁忙，请稍后重试');
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now()+5*60000;
    const fileName = `${order.vehicle.plate || order.id}-${categories.length===3?'全部照片':categories.map(key=>photoAlbumLabels[key]).join('-')}.docx`.replace(/[\r\n/\\]/g,'_');
    downloads.set(token,{body,fileName,expiresAt,userId:user.id});
    return {path:`/api/order-photo-documents/${token}.docx`,fileName,expiresAt:new Date(expiresAt).toISOString(),photoCount:photos.length};
  } finally {running.delete(user.id);}
}
export function readOrderPhotoExport(token) {
  prune(); const file = downloads.get(token);
  if (!file) throw new HttpError(404,'下载链接已过期，请重新导出');
  return file;
}
