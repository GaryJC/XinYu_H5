import type { CustomerSignatureInput, CustomerSignatureSession } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';

export const customerSignatureApi = {
  session: (token: string) => request<CustomerSignatureSession>('/api/public/customer-signature/session', {
    method: 'POST', skipAuth: true, body: { token }
  }),
  sign: (input: CustomerSignatureInput) => request<CustomerSignatureSession>('/api/public/customer-signature/sign', {
    method: 'POST', skipAuth: true, body: input
  })
};
export function customerSignatureLink(token: string) {
  return `${location.origin}/customer-signature#${encodeURIComponent(token)}`;
}
