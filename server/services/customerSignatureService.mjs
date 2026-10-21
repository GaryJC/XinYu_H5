import sharp from 'sharp';
import { findWorkOrderByToken, signWorkOrderByToken } from '../db.mjs';
import { assertRemoteSignatureToken, customerSignatureSession } from '../domain/customerSignaturePolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { saveUploadedFile } from '../storage.mjs';

export async function loadCustomerSignature(token) {
  assertRemoteSignatureToken(token);
  return customerSignatureSession(await findWorkOrderByToken(token));
}

export async function normalizeCustomerSignature(imageBase64) {
  if (typeof imageBase64 !== 'string' || imageBase64.length > 2_800_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new HttpError(400, '请完成手写签名，签名图片须为不超过 2 MB 的 PNG');
  }
  const buffer = Buffer.from(imageBase64.split(',')[1], 'base64');
  if (buffer.length > 2 * 1024 * 1024) throw new HttpError(400, '签名图片不能超过 2 MB');
  try {
    const image = sharp(buffer, { limitInputPixels: 4_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || metadata.width < 2 || metadata.height < 2 || (metadata.pages || 1) !== 1) throw new Error('Invalid signature');
    // Decode and re-encode instead of trusting the supplied MIME type or bytes.
    return `data:image/png;base64,${(await image.png().toBuffer()).toString('base64')}`;
  } catch {
    throw new HttpError(400, '签名图片无效，请清除后重新手写签名');
  }
}

export async function submitCustomerSignature({ token, imageBase64, confirmed } = {}) {
  assertRemoteSignatureToken(token);
  if (confirmed !== true) throw new HttpError(400, '请先核对并确认委托信息');
  const session = await loadCustomerSignature(token);
  if (session.state === 'signed') throw new HttpError(409, '此委托单已完成签字，请勿重复提交');
  const image = await normalizeCustomerSignature(imageBase64);
  await signWorkOrderByToken(token, null, null, (database, order) => saveUploadedFile({
    orderId: order.id, kind: 'signature_image', fileName: `signature-${order.id}.png`,
    mimeType: 'image/png', imageBase64: image, database
  }));
  return { state: 'signed' };
}
