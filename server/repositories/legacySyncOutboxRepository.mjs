import { randomUUID } from "node:crypto";

export const INSERT_LEGACY_SYNC_EVENT_QUERY = `
  insert into legacy_sync_outbox (
    event_id, order_id, revision, event_type, payload_version, payload,
    legacy_reid, legacy_document_no, legacy_dispatch_no
  ) values (
    $1, $2, $3, $4, 1, $5::jsonb,
    $6, $7, $8
  )
`;

export async function enqueueLegacySyncEvent(client, order, eventType = "updated") {
  const eventId = randomUUID();
  const revisionResult = await client.query(
    `
      update work_orders
      set
        legacy_sync_revision = legacy_sync_revision + 1,
        legacy_sync_status = 'pending',
        legacy_sync_error = null
      where id = $1
      returning
        legacy_sync_revision,
        legacy_reid,
        legacy_document_no,
        dispatch_no
    `,
    [order.id]
  );
  const revision = Number(revisionResult.rows[0]?.legacy_sync_revision || 0);
  if (!revision) {
    throw new Error(`Cannot enqueue legacy sync for missing work order: ${order.id}`);
  }

  const payload = buildLegacySyncPayload({
    eventId,
    revision,
    eventType,
    order
  });
  await client.query(INSERT_LEGACY_SYNC_EVENT_QUERY, [
    eventId,
    order.id,
    revision,
    eventType,
    JSON.stringify(payload),
    revisionResult.rows[0]?.legacy_reid || null,
    revisionResult.rows[0]?.legacy_document_no || null,
    revisionResult.rows[0]?.dispatch_no || null
  ]);
  return { eventId, revision };
}

export function buildLegacySyncPayload({ eventId, revision, eventType, order }) {
  return {
    schema: "xinyu.work-order-sync",
    version: 1,
    eventId,
    eventType,
    revision,
    occurredAt: new Date().toISOString(),
    order: {
      id: order.id,
      status: order.status,
      dispatchNo: order.dispatchNo || "",
      arrivalDate: order.arrivalDate || "",
      shop: {
        id: order.shop?.id || "",
        name: order.shop?.name || "",
        address: order.shop?.address || "",
        phone: order.shop?.phone || ""
      },
      advisor: order.advisor || "",
      department: {
        code: order.department?.code || "",
        name: order.department?.name || ""
      },
      technician: order.technician || "",
      inspector: order.inspector || "",
      vehicle: {
        plate: order.vehicle?.plate || "",
        vin: order.vehicle?.vin || "",
        mileage: order.vehicle?.mileage || "",
        model: order.vehicle?.model || "",
        purchaseDate: order.vehicle?.purchaseDate || ""
      },
      customer: {
        name: order.customer?.name || "",
        legacyCode: order.customer?.legacyCode || "",
        phone: order.customer?.phone || "",
        contact: order.customer?.contact || "",
        address: order.customer?.address || ""
      },
      inspection: order.inspection || {
        belongings: [],
        fuelLevel: "1/2",
        exteriorIssues: []
      },
      faultDescription: order.faultDescription || "",
      repairItems: (order.repairItems || []).map((item, index) => ({
        id: Number(item.id || index + 1),
        itemNo: index + 1,
        name: item.name || "",
        laborFee: Number(item.laborFee || 0),
        owner: item.owner || "待派工",
        status: item.status || "待派工",
        startAt: item.startAt || "",
        finishAt: item.finishAt || "",
        inspector: item.inspector || "待检验"
      })),
      estimatedFee: Number(order.estimatedFee || 0),
      oldPartsHandling: order.oldPartsHandling || "环保处理",
      estimatedDeliveryAt: order.estimatedDeliveryAt || "",
      settlementAmount: Number(order.settlementAmount || 0),
      feeNote: order.feeNote || "",
      signatures: order.signatures || {},
      platformOrderNo: order.platformOrderNo || null,
      createdAt: order.createdAt || "",
      updatedAt: order.updatedAt || ""
    }
  };
}
