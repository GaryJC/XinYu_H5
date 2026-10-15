import { HttpError } from "../http/HttpError.mjs";
const text = value => String(value ?? "").trim();

export function legacyDate(value) {
  const source = text(value);
  if (!source) return "";
  const match = source.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/);
  if (!match) throw new HttpError(409, "润丰进厂/交车日期格式无效，原数据未修改");
  const result = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== result) throw new HttpError(409, "润丰日期无效");
  return result;
}
const money = value => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n >= 1e10) throw new HttpError(409, "润丰金额无效，原数据未修改");
  return n;
};
export function buildLegacyRefresh(snapshot, existingItems, hasExecution) {
  const { header: h, vehicle: v, customer: c } = snapshot;
  if (!/^[A-Z][0-9]+$/.test(text(h.pgd))) throw new HttpError(409, "润丰派工号无效");
  if (!v && text(h.ch) !== text(snapshot.originalPlate)) throw new HttpError(409, "润丰未找到对应车辆档案，无法核对 VIN");
  if (!c && text(h.ssdw)) throw new HttpError(409, "润丰未找到对应客户档案，原数据未修改");
  const used = new Set();
  const sourceIds = new Set();
  let nextId = Math.max(0, ...existingItems.map(i => Number(i.client_item_id)));
  const items = snapshot.items.map((item, index) => {
    const sourceId = Number(item.reid);
    const name = text(item.hh);
    if (!Number.isSafeInteger(sourceId) || sourceId < 1 || sourceIds.has(sourceId) || !name) throw new HttpError(409, "润丰维修项目标识或名称无效");
    sourceIds.add(sourceId);
    let existing = existingItems.find(i => Number(i.legacy_item_reid) === sourceId);
    if (!existing) {
      const matches = existingItems.filter(i => i.legacy_item_reid == null && !used.has(i.id) && text(i.name) === name);
      // Initial linking by name is allowed only when unique on both sides.
      if (matches.length === 1 && snapshot.items.filter(i => text(i.hh) === name).length === 1) existing = matches[0];
    }
    if (existing) used.add(existing.id);
    return { sourceId, clientId: existing ? Number(existing.client_item_id) : ++nextId, itemNo: index + 1,
      name, laborFee: money(item.je), existing };
  });
  const removed = existingItems.filter(i => !used.has(i.id));
  if (hasExecution && (removed.length || items.some(i => !i.existing))) {
    throw new HttpError(409, "润丰项目清单已增删或首次匹配不明确，且本单已有派工/领料记录；请先核对项目，避免覆盖维修进度");
  }
  return { fields: {
    dispatch_no: text(h.pgd), arrival_date: legacyDate(h.jcrq), estimated_delivery_at: legacyDate(h.jhrq),
    vehicle_plate: text(h.ch), vehicle_mileage: text(h.lc),
    ...(v ? { vehicle_vin: text(v.sbdm), vehicle_model: text(v.model_name), vehicle_model_legacy_code: text(v.model_code) } : { vehicle_model: text(h.cx) }),
    customer_legacy_code: text(h.ssdw), ...(c ? { customer_name: text(c.mc), customer_address: text(c.jydz) } : {}),
    customer_contact: text(h.lxr) || text(h.sxr), customer_phone: text(h.lxdh),
    fault_description: text(h.wxnr), estimated_fee: money(h.fyhj)
  }, items, removed };
}
