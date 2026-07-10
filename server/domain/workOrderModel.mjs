export function workOrderValues(order) {
  const inspection = order.inspection || { belongings: [], fuelLevel: "1/2", exteriorIssues: [] };
  return [
    order.id,
    order.status,
    order.advisor || "林佳",
    order.technician || "待派工",
    order.inspector || "待检验",
    order.dispatchNo || "",
    order.arrivalDate || "",
    order.shop?.id || "shop-hq",
    order.shop?.name || "上海虹桥店",
    order.shop?.address || "上海市闵行区虹桥汽修服务中心",
    order.shop?.phone || "021-6000-8618",
    order.vehicle?.plate || "",
    order.vehicle?.vin || "",
    order.vehicle?.mileage || "",
    order.vehicle?.model || "",
    order.vehicle?.purchaseDate || "",
    order.customer?.name || "",
    order.customer?.phone || "",
    order.customer?.contact || "",
    order.customer?.address || "",
    JSON.stringify(inspection),
    order.faultDescription || "",
    Number(order.estimatedFee || 0),
    order.oldPartsHandling || "环保处理",
    order.estimatedDeliveryAt || "",
    Number(order.settlementAmount || 0),
    order.feeNote || "",
    order.platformOrderNo || null,
    parseDate(order.createdAt),
    parseDate(order.updatedAt)
  ];
}

export function rowToWorkOrder(row, repairItems, signatures, auditLog, ocrRecords, syncRecords, outboundOrders, settlements) {
  return {
    id: row.id,
    dispatchNo: row.dispatch_no || "",
    arrivalDate: row.arrival_date || "",
    status: row.status,
    createdAt: formatDate(row.created_at),
    updatedAt: formatDate(row.updated_at),
    shop: {
      id: row.shop_id || "shop-hq",
      name: row.shop_name || "上海虹桥店",
      address: row.shop_address || "上海市闵行区虹桥汽修服务中心",
      phone: row.shop_phone || "021-6000-8618"
    },
    advisor: row.advisor,
    technician: row.technician,
    inspector: row.inspector,
    vehicle: {
      plate: row.vehicle_plate,
      vin: row.vehicle_vin,
      mileage: row.vehicle_mileage,
      model: row.vehicle_model,
      purchaseDate: row.vehicle_purchase_date
    },
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      contact: row.customer_contact,
      address: row.customer_address
    },
    inspection: normalizeInspection(row.inspection),
    faultDescription: row.fault_description,
    repairItems: repairItems.map((item) => ({
      id: Number(item.client_item_id),
      name: item.name,
      laborFee: Number(item.labor_fee || 0),
      owner: item.owner,
      startAt: item.start_at || "",
      finishAt: item.finish_at || "",
      inspector: item.inspector || "待检验",
      status: item.status || "待派工"
    })),
    estimatedFee: Number(row.estimated_fee || 0),
    oldPartsHandling: row.old_parts_handling,
    estimatedDeliveryAt: row.estimated_delivery_at,
    settlementAmount: Number(row.settlement_amount || 0),
    feeNote: row.fee_note,
    signatures: signatures.reduce((acc, item) => ({ ...acc, [item.signer_type]: item.signer_name }), {}),
    signatureToken: row.signature_token || undefined,
    signatureTokenUsed: row.signature_token_used ?? undefined,
    platformOrderNo: row.platform_order_no || undefined,
    ocrRecords: ocrRecords.map(rowToOcrRecord),
    platformSyncRecords: syncRecords.map((item) => ({
      id: item.id,
      orderId: item.order_id,
      platformOrderNo: item.platform_order_no,
      status: item.status,
      message: item.message,
      syncedAt: formatDate(item.synced_at)
    })),
    outboundOrders: outboundOrders.map((item) => ({
      id: item.id,
      orderId: item.order_id,
      dispatchNo: item.dispatch_no,
      platformOrderNo: item.platform_order_no,
      technician: item.technician,
      status: item.status,
      createdAt: formatDate(item.created_at),
      items: (item.items || []).map((child) => ({
        id: child.id,
        repairItemId: Number(child.repair_item_id),
        name: child.name,
        quantity: Number(child.quantity || 0),
        picked: Boolean(child.picked)
      }))
    })),
    settlementStatements: settlements.map((item) => ({
      id: item.id,
      orderId: item.order_id,
      dispatchNo: item.dispatch_no,
      plate: item.plate,
      technician: item.technician,
      amount: Number(item.amount || 0),
      source: item.source,
      matchStatus: item.match_status,
      syncedAt: formatDate(item.synced_at)
    })),
    auditLog: auditLog.map((item) => ({
      at: formatDate(item.at),
      actor: item.actor,
      action: item.action
    }))
  };
}

function normalizeInspection(value) {
  const inspection = value || {};
  return {
    belongings: Array.isArray(inspection.belongings) ? inspection.belongings : [],
    fuelLevel: inspection.fuelLevel || "1/2",
    exteriorIssues: Array.isArray(inspection.exteriorIssues) ? inspection.exteriorIssues : []
  };
}

export function createOrderFromDraft(draft) {
  const at = nowString();
  return {
    ...draft,
    dispatchNo: draft.dispatchNo || "",
    arrivalDate: draft.arrivalDate || new Date().toISOString().slice(0, 10),
    shop: draft.shop || {
      id: "shop-hq",
      name: "上海虹桥店",
      address: "上海市闵行区虹桥汽修服务中心",
      phone: "021-6000-8618"
    },
    id: createOrderId(),
    createdAt: at,
    updatedAt: at,
    auditLog: []
  };
}

function createOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `WT-${stamp}-${Math.floor(100 + Math.random() * 900)}`;
}

export function createSignatureToken(orderId) {
  return `sig_${orderId}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}_${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}


export function rowToOcrRecord(row) {
  return {
    id: row.id,
    orderId: row.order_id || undefined,
    field: row.field,
    source: row.source,
    fileId: row.file_id,
    status: row.status,
    value: row.value,
    confidence: Number(row.confidence || 0),
    error: row.error || undefined,
    createdAt: formatDate(row.created_at),
    confirmedAt: row.confirmed_at ? formatDate(row.confirmed_at) : undefined
  };
}


export function repairActionText(action) {
  const labels = {
    assign: "按项目指派维修技师",
    pick: "确认领料",
    start: "维修项目开工",
    finish: "维修项目完工提报",
    inspect: "维修项目检验通过"
  };
  return labels[action] || "更新维修项目";
}

export function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function buildTrend(orders) {
  const day = countBy(orders, (order) => (order.arrivalDate || order.createdAt || "").slice(0, 10) || "未登记");
  const entries = Object.entries(day).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([label, value]) => ({ label, value }));
}

export function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = row[key];
    result.set(value, [...(result.get(value) || []), row]);
  }
  return result;
}

export function parseDate(value) {
  if (!value) return new Date();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

export function nowString() {
  return formatDate(new Date());
}

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

