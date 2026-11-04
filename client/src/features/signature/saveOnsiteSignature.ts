import type { WorkOrder } from '../../../../shared/types';
import { workOrderApi } from '../work-orders/api/workOrderApi';

export async function saveOnsiteSignature(order: WorkOrder, token: string, imageBase64: string): Promise<WorkOrder> {
  try {
    const file = await workOrderApi.uploadFile({ orderId: order.id, kind: 'signature_image',
      fileName: `signature-${order.id}.png`, mimeType: 'image/png', imageBase64 });
    return await workOrderApi.signByToken(token, order.customer.name || '客户签名', file.id);
  } catch (error) {
    // A successful commit may lose its response. Return the persisted review
    // state too: saving a signature is distinct from staff confirmation.
    try {
      const current = await workOrderApi.findByToken(token);
      if (current?.id === order.id && current.signatureTokenUsed && current.customerSignatureFileId
          && ['pending', 'confirmed'].includes(current.customerSignatureReview?.state || '')) return current;
    } catch { /* Preserve the original actionable failure when recovery is unavailable. */ }
    throw error;
  }
}
