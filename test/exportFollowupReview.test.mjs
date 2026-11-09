import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import ts from 'typescript';
import { collectOrderPhotoAlbums, photoAlbumLabels } from '../shared/orderPhotoAlbums.mjs';
import { HttpError } from '../server/http/HttpError.mjs';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ||= 'local-export-review-session-secret';
const { createPrintPdfStore } = await import('../server/services/printPdfService.mjs');
const { handleApiRequest } = await import('../server/routes/apiRouter.mjs');
const { createTokenForUser } = await import('../server/auth.mjs');
const { pool } = await import('../server/database/pool.mjs');
const { handlePrintPdfDownload } = await import('../server/routes/printPdfRouter.mjs');
const { isOrderEntryRequest } = await import('../server/domain/orderEntryAccess.mjs');

const tokenOf = result => result.path.split('/').at(-1).replace(/\.(pdf|docx)$/, '');
const pdf = (userId, length) => ({ userId, pdfBase64: Buffer.from(`%PDF-${'x'.repeat(length - 5)}`).toString('base64'), fileName: '测试.pdf' });

test('rejected PDF replacement preserves the prior download and other users files', () => {
  const store = createPrintPdfStore({ maxBytes: 20 });
  try {
    const original = store.put(pdf('a', 6));
    const other = store.put(pdf('b', 6));
    assert.throws(() => store.put(pdf('a', 16)), error => error.status === 503);
    assert.equal(store.get(tokenOf(original)).body.length, 6);
    assert.equal(store.get(tokenOf(other)).body.length, 6);
    const replacement = store.put(pdf('a', 14));
    assert.equal(store.get(tokenOf(replacement)).body.length, 14);
    assert.throws(() => store.get(tokenOf(original)), error => error.status === 404);
    assert.equal(store.get(tokenOf(other)).body.length, 6);
  } finally { store.close(); }
});

function photoExportFixture() {
  let size = 20 * 1024 * 1024;
  const dependencies = {
    'node:crypto': { randomBytes },
    '../repositories/orderOverviewRepository.mjs': { readOrderOverview: async id => ({ order: { id, vehicle: {}, files: [{ id: 'photo', kind: 'other', mimeType: 'image/png' }] }, dispatch: { files: [] } }) },
    '../storage.mjs': { readStoredFile: async () => ({ body: Buffer.from('image') }) },
    '../repositories/fileRepository.mjs': { assertFileReadAccess: async () => {} },
    '../../shared/orderPhotoAlbums.mjs': { collectOrderPhotoAlbums, photoAlbumLabels },
    './orderPhotoDocument.mjs': { buildOrderPhotoDocument: async (_order, photos, read) => { await read(photos[0].id); return { length: size }; } },
    '../http/HttpError.mjs': { HttpError }
  };
  const source = readFileSync(new URL('../server/services/orderPhotoExportService.mjs', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, Buffer, setInterval: () => ({ unref() {} }), require: name => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  } });
  return { ...exports, size: value => { size = value; } };
}

test('rejected photo-document replacement preserves the prior download without exceeding the cache budget', async () => {
  const service = photoExportFixture();
  const input = { categories: ['reception'] };
  const original = await service.prepareOrderPhotoExport('one', input, { id: 'a' });
  service.size(60 * 1024 * 1024);
  const other = await service.prepareOrderPhotoExport('two', input, { id: 'b' });
  service.size(40 * 1024 * 1024);
  await assert.rejects(() => service.prepareOrderPhotoExport('three', input, { id: 'a' }), error => error.status === 503);
  assert.equal(service.readOrderPhotoExport(tokenOf(original)).body.length, 20 * 1024 * 1024);
  assert.equal(service.readOrderPhotoExport(tokenOf(other)).body.length, 60 * 1024 * 1024);
  service.size(36 * 1024 * 1024);
  const replacement = await service.prepareOrderPhotoExport('three', input, { id: 'a' });
  assert.throws(() => service.readOrderPhotoExport(tokenOf(original)), error => error.status === 404);
  assert.equal(service.readOrderPhotoExport(tokenOf(replacement)).body.length, 36 * 1024 * 1024);
  assert.equal(service.readOrderPhotoExport(tokenOf(other)).body.length, 60 * 1024 * 1024);
});

test('employees and unbound technicians can prepare their own PDFs while foreign orders remain forbidden', async t => {
  for (const role of ['employee', 'technician']) {
    const user = { id: `print-${role}`, name: '本人开单员工', role, active: true, shop_id: 'shop-hq' };
    const queries = [];
    const mock = t.mock.method(pool, 'query', async (sql, params) => {
      queries.push(sql);
      if (sql.includes('from users join auth_sessions')) return { rows: [user] };
      if (sql.includes('select advisor, shop_id from work_orders')) return { rows: [{ advisor: params[0] === 'other-owner' ? '其他员工' : user.name, shop_id: params[0] === 'other-shop' ? 'other' : user.shop_id }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    try {
      const token = createTokenForUser(user.id);
      const request = async orderId => {
        const req = Readable.from([Buffer.from(JSON.stringify(pdf(user.id, 10)))]);
        req.method = 'POST'; req.headers = { authorization: `Bearer ${token}` }; req.socket = {};
        let body;
        const res = { setHeader() {}, end(value) { body = value; } };
        await handleApiRequest(req, res, new URL(`/api/work-orders/${orderId}/print-pdf`, 'http://localhost'));
        return { status: res.statusCode, body: JSON.parse(body) };
      };
      const result = await request('own-order');
      assert.equal(result.status, 201);
      const headers = {};
      let downloaded;
      assert.equal(handlePrintPdfDownload({ method: 'GET' }, { setHeader(key, value) { headers[key] = value; }, end(value) { downloaded = value; } }, new URL(result.body.path, 'http://localhost')), true);
      assert.equal(downloaded.toString(), '%PDF-xxxxx');
      assert.equal(headers['Cache-Control'], 'private, no-store');
      const anonymous = { method: 'GET', headers: {} };
      await handleApiRequest(anonymous, { setHeader() {}, end(value) { downloaded = value; } }, new URL(result.body.path, 'http://localhost'));
      assert.equal(downloaded.toString(), '%PDF-xxxxx', 'native viewers use the opaque short-lived download capability');
      await assert.rejects(() => handleApiRequest(anonymous, {}, new URL(`/api/print-pdfs/${'0'.repeat(64)}.pdf`, 'http://localhost')), error => error.status === 404);
      await assert.rejects(() => handleApiRequest(anonymous, {}, new URL('/api/work-orders/own-order', 'http://localhost')), error => error.status === 401);
      await assert.rejects(() => request('other-owner'), error => error.status === 403);
      await assert.rejects(() => request('other-shop'), error => error.status === 403);
      assert.ok(queries.some(sql => sql.includes('select advisor, shop_id')));
    } finally { mock.mock.restore(); }
  }
});

test('the added opening exemption is limited to POST PDF preparation', () => {
  assert.equal(isOrderEntryRequest('POST', '/api/work-orders/own-order/print-pdf'), true);
  for (const [method, path] of [
    ['GET', '/api/work-orders/own-order/print-pdf'], ['DELETE', '/api/work-orders/own-order/print-pdf'],
    ['POST', '/api/work-orders/own-order/photo-document'], ['POST', '/api/dispatch/orders/own-order/actions']
  ]) assert.equal(isOrderEntryRequest(method, path), false);
});
