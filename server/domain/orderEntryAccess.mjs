// Entry permissions do not grant dispatch, inspection, settlement or administration.
export function isOrderEntryRequest(method, path) {
  if (method === 'GET' && ['/api/company-system/departments', '/api/users', '/api/work-orders', '/api/dashboard'].includes(path)) return true;
  if (method === 'POST' && [
    '/api/work-orders', '/api/files', '/api/ocr/vehicle-license', '/api/ocr/license-plate', '/api/ocr/vin',
    '/api/company-system/vehicles/lookup', '/api/company-system/vehicle-references/search',
    '/api/company-system/vehicle-references/code-check', '/api/company-system/vehicle-references',
    '/api/vehicle-licenses/history', '/api/vehicle-licenses/reuse'
  ].includes(path)) return true;
  if (method === 'GET' && path === '/api/vehicle-licenses/preview') return true;
  if (['GET', 'PUT', 'DELETE'].includes(method) && /^\/api\/work-orders\/[^/]+$/.test(path)) return true;
  if (method === 'GET' && /^\/api\/files\/[^/]+\/content$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/(?:files\/[^/]+\/attach|work-orders\/[^/]+\/(?:license-exception|signature-token|ocr-records|paper-order\/(?:resolve|submit))|ocr-records\/[^/]+\/confirm)$/.test(path)) return true;
  return (method === 'GET' && /^\/api\/signatures\/[^/]+$/.test(path)) || (method === 'POST' && /^\/api\/signatures\/[^/]+\/sign$/.test(path));
}
