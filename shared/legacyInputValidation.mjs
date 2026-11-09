export function legacyTextBytes(value) {
  return [...String(value ?? "")].reduce((total, char) => total + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
}

export function legacyTextError(value, maxBytes, label) {
  return legacyTextBytes(value) > maxBytes
    ? `${label}过长，最多${maxBytes}位字母数字，汉字占2位` : "";
}

export function legacyReferenceNameError(kind, name) {
  // Creation writes the model name to BOTH cxb.mc (50 bytes) and cxb.qc (100).
  return legacyTextError(name, kind === "model" ? 50 : 150, kind === "model" ? "车型名称" : "所属单位名称");
}

export function legacyOrderInputErrors(order) {
  const vehicle = order.vehicle || {};
  const customer = order.customer || {};
  const fields = [
    [vehicle.vin, 20, "VIN/底盘号"],
    [vehicle.mileage, 20, "进厂里程"],
    [vehicle.modelLegacyCode, 10, "车型编码"],
    [vehicle.model, 100, "车型"],
    [vehicle.modelLegacyCode && vehicle.model ? vehicle.modelLegacyCode.trim() + " " + vehicle.model.trim() : "", 100, "车型编码及名称合计"],
    [customer.name, 150, "车主名称/所属单位"],
    [customer.legacyCode, 50, "所属单位编码"],
    [customer.contact, 100, "联系人"],
    [customer.phone, 50, "联系电话"],
    [order.department?.code, 50, "部门编码"],
    [order.advisor, 20, "服务顾问"]
  ];
  return fields.map(([value, max, label]) => legacyTextError(value, max, label)).filter(Boolean);
}
