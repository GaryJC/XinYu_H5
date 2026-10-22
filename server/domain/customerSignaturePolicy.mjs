import { HttpError } from '../http/HttpError.mjs';

export function isRemoteSignatureToken(token) {
  return typeof token === 'string' && /^sig_[a-f0-9]{64}$/.test(token);
}

export function assertRemoteSignatureToken(token) {
  if (!isRemoteSignatureToken(token)) throw new HttpError(404, '签字链接不存在或已失效，请联系服务顾问重新发送');
}

export function customerSignatureSession(order) {
  if (!order) throw new HttpError(404, '签字链接不存在或已失效，请联系服务顾问重新发送');
  if (order.signatureTokenUsed || order.customerSignatureFileId) return { state: 'signed' };
  if (order.signaturePurpose !== 'supplement' && (order.paperOrder || order.status !== '待客户签字')) throw new HttpError(409, '当前委托单不能签字，请联系服务顾问');
  return {
    state: 'pending', expiresAt: order.signatureExpiresAt || null,
    order: {
      id: order.id,
      shop: { name: order.shop.name, address: order.shop.address, phone: order.shop.phone },
      vehicle: { plate: order.vehicle.plate, model: order.vehicle.model, mileage: order.vehicle.mileage },
      customerName: order.customer.name, faultDescription: order.faultDescription,
      repairItems: order.repairItems.map(item => ({ name: item.name, laborFee: item.laborFee })),
      estimatedFee: order.estimatedFee || order.repairItems.reduce((sum, item) => sum + item.laborFee, 0),
      feeNote: order.feeNote, oldPartsHandling: order.oldPartsHandling, estimatedDeliveryAt: order.estimatedDeliveryAt
    }
  };
}
