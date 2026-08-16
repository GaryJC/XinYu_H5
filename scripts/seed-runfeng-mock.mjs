import { pool } from "../server/database/pool.mjs";
import { createWorkOrder } from "../server/db.mjs";
import { enqueueLegacySyncEvent } from "../server/repositories/legacySyncOutboxRepository.mjs";

const DEFAULT_BATCH = "RUNFENG-MOCK-20260731-V1";
const batch = String(process.env.RUNFENG_MOCK_BATCH || DEFAULT_BATCH).trim();
const cleanup = process.argv.includes("--cleanup");
const refresh = process.argv.includes("--refresh");

if (!batch.startsWith("RUNFENG-MOCK-")) {
  throw new Error("RUNFENG_MOCK_BATCH must start with RUNFENG-MOCK-");
}

try {
  if (cleanup) {
    const deleted = await pool.query(
      `
        delete from work_orders
        where fee_note = $1
        returning id
      `,
      [batch]
    );
    console.log(JSON.stringify({
      batch,
      deletedOrderIds: deleted.rows.map((row) => row.id),
      deletedCount: deleted.rowCount
    }, null, 2));
  } else {
    if (refresh) {
      await pool.query("delete from work_orders where fee_note = $1", [batch]);
    }
    const existing = await findBatchOrders();
    if (existing.length) {
      console.log(JSON.stringify({
        batch,
        created: false,
        message: "Mock batch already exists",
        events: existing
      }, null, 2));
    } else {
      const createdOrderIds = [];
      try {
        for (const draft of mockDrafts()) {
          const order = await createWorkOrder(draft, draft.advisor);
          createdOrderIds.push(order.id);
          await markMockOrderReadyForRunfeng(order);
        }
      } catch (error) {
        if (createdOrderIds.length) {
          await pool.query("delete from work_orders where id = any($1::text[])", [createdOrderIds]);
        }
        throw error;
      }

      console.log(JSON.stringify({
        batch,
        created: true,
        events: await findBatchOrders()
      }, null, 2));
    }
  }
} finally {
  await pool.end();
}

async function markMockOrderReadyForRunfeng(order) {
  const client = await pool.connect();
  const next = {
    ...order,
    status: "已委托",
    updatedAt: new Date().toISOString(),
    signatures: { ...order.signatures, customer: "润丰联调测试签字" }
  };
  try {
    await client.query("begin");
    await client.query(
      "update work_orders set status = '已委托', updated_at = now() where id = $1",
      [order.id]
    );
    await client.query(
      `
        insert into signatures (order_id, signer_type, signer_name)
        values ($1, 'customer', $2)
        on conflict (order_id, signer_type) do update set
          signer_name = excluded.signer_name,
          signed_at = now()
      `,
      [order.id, next.signatures.customer]
    );
    await enqueueLegacySyncEvent(client, next, "created");
    await client.query(
      "insert into audit_logs (order_id, actor, action) values ($1, $2, $3)",
      [order.id, order.customer.name || "联调客户", "润丰联调 mock 完成委托并进入同步队列"]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function findBatchOrders() {
  const { rows } = await pool.query(
    `
      select
        work_order.id as order_id,
        work_order.status as work_order_status,
        work_order.legacy_sync_status as work_order_sync_status,
        work_order.department_code,
        work_order.department_name,
        work_order.advisor,
        work_order.vehicle_plate,
        work_order.vehicle_model,
        work_order.vehicle_model_legacy_code,
        work_order.customer_name,
        work_order.customer_legacy_code,
        event.payload #>> '{order,vehicle,modelLegacyCode}' as payload_model_legacy_code,
        event.payload #>> '{order,customer,legacyCode}' as payload_customer_legacy_code,
        event.event_id,
        event.revision,
        event.event_type,
        event.status
      from work_orders work_order
      join legacy_sync_outbox event
        on event.order_id = work_order.id
      where work_order.fee_note = $1
      order by work_order.created_at, event.revision
    `,
    [batch]
  );
  return rows;
}

function mockDrafts() {
  const base = {
    dispatchNo: "",
    arrivalDate: "2026-07-31",
    status: "草稿",
    shop: {
      id: "shop-hq",
      name: "抚顺路店",
      address: "",
      phone: ""
    },
    technician: "待派工",
    inspector: "待检验",
    inspection: {
      belongings: ["行驶证"],
      fuelLevel: "1/2",
      exteriorIssues: []
    },
    oldPartsHandling: "环保处理",
    estimatedDeliveryAt: "2026-08-01 18:00",
    settlementAmount: 0,
    feeNote: batch,
    signatures: {},
    platformOrderNo: null,
    ocrRecords: [],
    platformSyncRecords: [],
    outboundOrders: [],
    settlementStatements: []
  };

  return [
    {
      ...base,
      department: { code: "A", name: "机电一部" },
      advisor: "联调测试顾问-张三",
      vehicle: {
        plate: "鲁BTEST01",
        vin: "LSVTEST2607310001",
        mileage: "12000",
        model: "大众-新帕萨特",
        modelLegacyCode: "DZXPST",
        purchaseDate: "2024-01-10"
      },
      customer: {
        name: "个人（水务集团）",
        legacyCode: "grqdswjty",
        phone: "13000000001",
        contact: "联调联系人一",
        address: "联调测试地址一"
      },
      faultDescription: "联调测试：车辆常规保养",
      repairItems: [
        repairItem(1, "更换机油机滤", 180),
        repairItem(2, "全车检查", 80)
      ],
      estimatedFee: 260
    },
    {
      ...base,
      department: { code: "B", name: "保险部" },
      advisor: "联调测试顾问-李四",
      vehicle: {
        plate: "鲁BTEST02",
        vin: "LSVTEST2607310002",
        mileage: "35600",
        model: "奥迪A6",
        modelLegacyCode: "ADA6",
        purchaseDate: "2022-08-15"
      },
      customer: {
        name: "青岛水务集团有限公司",
        legacyCode: "qdswjtyxgs",
        phone: "13000000002",
        contact: "联调联系人二",
        address: "联调测试地址二"
      },
      faultDescription: "联调测试：前保险杠划伤",
      repairItems: [
        repairItem(1, "前保险杠喷漆", 600)
      ],
      estimatedFee: 600
    },
    {
      ...base,
      department: { code: "M", name: "机电二部" },
      advisor: "联调测试顾问-王五",
      vehicle: {
        plate: "鲁BTEST03",
        vin: "LSVTEST2607310003",
        mileage: "68800",
        model: "大众-帕萨特",
        modelLegacyCode: "DZPST",
        purchaseDate: "2020-05-20"
      },
      customer: {
        name: "青岛水务集团有限公司",
        legacyCode: "jtyxgs",
        phone: "13000000003",
        contact: "联调联系人三",
        address: "联调测试地址三"
      },
      faultDescription: "联调测试：制动系统异响",
      repairItems: [
        repairItem(1, "制动系统检查", 120),
        repairItem(2, "更换前制动片", 260)
      ],
      estimatedFee: 380
    }
  ];
}

function repairItem(id, name, laborFee) {
  return {
    id,
    name,
    laborFee,
    owner: "待派工",
    status: "待派工",
    startAt: "",
    finishAt: "",
    inspector: "待检验"
  };
}
