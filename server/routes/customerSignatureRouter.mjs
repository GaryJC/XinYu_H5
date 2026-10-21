import { readJson, sendJson } from '../http/response.mjs';
import { loadCustomerSignature, submitCustomerSignature } from '../services/customerSignatureService.mjs';

export async function handleCustomerSignature(req, res, url) {
  if (req.method !== 'POST' || !['/api/public/customer-signature/session', '/api/public/customer-signature/sign'].includes(url.pathname)) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const input = await readJson(req);
  const result = url.pathname.endsWith('/session')
    ? await loadCustomerSignature(input?.token)
    : await submitCustomerSignature(input ?? {});
  sendJson(res, 200, result);
  return true;
}
