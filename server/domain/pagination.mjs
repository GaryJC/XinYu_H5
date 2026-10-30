import { HttpError } from '../http/HttpError.mjs';

export function pagination(query = {}) {
  const integer = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
      throw new HttpError(400, '分页参数无效');
    }
    return Number(value);
  };
  return { page: integer(query.page, 1, 1000000), pageSize: integer(query.pageSize, 20, 100) };
}
export function pageResult(items, query) {
  const { pageSize, page: requested } = pagination(query);
  const total = items.length;
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
}
