# 已同步委托单四项更正：润丰对接与启用

## 可直接发给润丰的说明

继续使用 PostgreSQL Outbox 轮询和现有领取、ACK、失败回填函数，JSON schema 为
`xinyu.work-order-sync`，payload 版本仍是 `1`。

新增处理 `event_type = 'updated'`（JSON 中为 `eventType`）：使用原维修单的
`reid/dh/pgd` 更新当前单及对应车辆档案，不创建新维修单，不改其他历史维修单。
只更新联系人、联系方式、车型、所属单位四项；完整 payload 中的项目、金额、状态、签名等
均不是此次更新范围。新单 `created` 遇到已有车牌时，这四项也以员工在钉钉确认的信息为准。

| 含义 | 队列字段 / payload 路径 | 润丰处理 |
| --- | --- | --- |
| 派工号 | `legacy_dispatch_no` / `payload.order.dispatchNo` | 原单 `qxwxb.pgd`，示例 `A66329`，不是 H5 单号 |
| 维修单标识 | `legacy_reid` | 原单 `qxwxb.reid` |
| 内部单号 | `legacy_document_no` | 原单 `qxwxb.dh` |
| 联系人 | `payload.order.customer.contact` | 当前维修单及车辆档案的联系人字段，实际列名由润丰确认 |
| 联系方式 | `payload.order.customer.phone` | 当前维修单及车辆档案的电话字段，实际列名由润丰确认 |
| 车型 | `payload.order.vehicle.model`、`modelLegacyCode` | 核验 `cxb`，更新当前单和 `qxclxxb.cx` 的车型关联 |
| 所属单位 | `payload.order.customer.name`、`legacyCode` | 核验 `khxxb`，更新当前单及 `qxclxxb.ssdw` 的单位关联 |

**请润丰补充确认联系人、电话在维修单和车辆档案中的实际写入列名。** H5 现有反向读取使用
`qxwxb.lxr`（为空时读 `sxr`）、`qxwxb.lxdh`，这不能替代对实际保存流程和车辆档案列的确认。
不能通过修改共享 `khxxb` 联系方式来更改单车信息，以免影响同单位其他车辆。

## 领取与回填示例

```sql
select * from claim_legacy_sync_events('runfeng-production', 20);
```

一次领取的更新事件示意（示例值，不是生产单据）：

```json
{
  "event_id": "新的UUID",
  "order_id": "WT-20261017-EXAMPLE",
  "revision": 2,
  "event_type": "updated",
  "legacy_reid": 1028817,
  "legacy_document_no": 85641,
  "legacy_dispatch_no": "A66329",
  "payload": {
    "schema": "xinyu.work-order-sync",
    "version": 1,
    "eventId": "新的UUID",
    "eventType": "updated",
    "revision": 2,
    "occurredAt": "2026-10-17T08:00:00.000Z",
    "order": {
      "id": "WT-20261017-EXAMPLE",
      "dispatchNo": "A66329",
      "vehicle": { "plate": "鲁B12345", "vin": "LSVCH2A47CN165407", "model": "大众-新帕萨特", "modelLegacyCode": "DZXPST" },
      "customer": { "contact": "张三", "phone": "13000000001", "name": "测试单位", "legacyCode": "csdw" }
    }
  }
}
```

上例省略了不属于更新范围的 payload 字段，实际仍发送现有完整委托单结构。
`event_id/order_id/revision/event_type` 必须与 JSON 中对应信息一致，领取后派工号也必须一致。
首次尚未回填润丰编号时，更正事件可先以空关联排队；前一条事件 ACK 后，领取函数和触发器自动补齐原 `reid/dh/pgd` 及 `payload.order.dispatchNo`，润丰不得直接消费未领取的待处理记录。

在 SQL Server **提交成功之后**回填原来的三个编号：

```sql
select * from acknowledge_legacy_sync_events(
  'runfeng-production',
  '[{"event_id":"新的UUID","legacy_reid":1028817,"legacy_document_no":85641,"legacy_dispatch_no":"A66329"}]'::jsonb
);
```

逐条检查 `acknowledged`。更新事件的原单关联被数据库触发器保护，ACK 换成其他编号会失败。
SQL Server 回滚后调用现有 `fail_legacy_sync_events`；失败不生成第二个事件，延迟后重领原事件。
ACK 网络失败时，重领后根据持久化 `event_id` 日志返回原结果，不再次创建或重复执行副作用。

## 润丰消费约束

- `created` 使用现有完整开单逻辑；`updated` 使用四项字段白名单更新逻辑。未知事件类型失败回填，不能默认为创建。
- 按原 `reid/dh` 唯一定位并核对 `pgd`、车牌及非空 VIN。未命中、多条命中、来源不符或车牌/VIN 冲突应回滚；禁止按车牌选一张维修单或补建新单。
- 车型和单位按编码核验名称；缺失可按现有完整保存规则建档，编码与名称冲突则失败。更换关联，不重命名共用的 `cxb/khxxb` 记录。
- 当前维修单与车辆档案在同一个 SQL Server 事务中更新，保留项目、费用、结算、维修进度及其他历史单。
- `event_id` 是幂等键，`revision` 只在同一 `order_id` 内比较。领取函数已经保证同单版本顺序。
- 同车不同委托单可能由不同消费者并发处理。润丰需锁定车辆档案，在同步日志中持久化该车最后应用的 `(occurredAt, eventId)`；按 UTC 时间、再按 eventId 字典序比较。旧事件仍更正其指定维修单，但不得覆盖已应用较新事件的车辆档案；判断、写入和日志须同事务提交。`created` 与 `updated` 都遵守此规则，不能拿不同单的 revision 比大小。
- 日志只记录事件 ID、单号、版本和结果；不要输出完整姓名、电话、VIN 或 payload。

## H5 操作与启用顺序

1. 依次部署新增迁移 `202610170001_customer_vehicle_update.sql` 和 `202610170002_queued_customer_vehicle_updates.sql`，再部署应用；无需更改现有领取函数签名。
2. `RUNFENG_CUSTOMER_VEHICLE_UPDATE_ENABLED=false` 为默认值。本店顾问和管理员查看已签字单时，详情上方显示编辑入口；非负责顾问看到“仅负责人/管理员”的置灰提示。未启用时显示置灰的“修改联系及车辆信息（待启用）”，接口拒绝写入，不投放更新事件。
3. 润丰先完成上述消费规则适配，并确认四项的维修单/车辆档案列名；双方联调后，服务端设置 `RUNFENG_CUSTOMER_VEHICLE_UPDATE_ENABLED=true` 并重启 API，刷新列表后入口可用。该配置不能放到 `VITE_*`。
4. 本店管理员、负责该单的服务顾问，可编辑待拉取、拉取中和已同步的单据。首次尚无润丰关联也允许排队更正；已同步单要求完整关联。每次更正追加新版本，保留之前已签署及已领取的快照；首次建单 ACK 后再顺序领取后续更新。新旧车型和单位使用现有查询/新增组件，服务端保存时再次核验名称和编码。四项及编码必填，无变化不入队。
5. 更正前后值、操作人和时间保存在本地审计中；原签名和原 `created` 事件保持。保存实际修改后，列表、详情及开单页显示“待更新”标签；处理中或失败时保留，润丰成功 ACK 当前最新版本后消失。详情显示更正待拉取、处理中、失败或成功，点击“刷新列表”查询新状态。
6. 待拉取、拉取中允许继续更正，旧版本提交仍被拒绝；存在未完成更新时禁止反向刷新；后续“从润丰更新”始终保留钉钉的四项字段。其他归档字段仍沿用原刷新流程。
7. 已投放事件后关闭开关只阻止新增更正，不撤销在途任务；消费者应继续完成已有事件，不能回滚成不支持 updated 的版本。

新开单查到已有车牌时，历史车型/单位只用于填充默认值，已有明确编码的员工选择及联系人会保留。
新增车型/单位按钮仍使用原有独立建档接口；取消编辑不删除已建的共享主数据。

## 验收

- 分别更正四项及组合更正；同车其他历史单、共享主数据和已签署记录无批量变化。
- 并发保存同一版本只成功一份，待拉取/拉取中可连续编辑并按版本依次消费；旧版本、无权限、编码冲突、空值及越界字段被拒绝。
- SQL Server 回滚不 ACK，提交后 ACK 网络失败重试不重复建单；更新 ACK 必须使用原编号。
- 同车多单乱序及重试不会把车辆档案覆盖回旧值；后续新单的四项仍以钉钉确认值为准。
- 润丰客户端实际打开当前单，确认四项均可见，并验证下次开单默认信息。

本地验证：`npm run check`；事务集成测试使用显式本机临时数据库：

```sh
CUSTOMER_VEHICLE_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node --test test/customerVehicleUpdate.integration.test.mjs
```

测试自动创建、删除 `codex_customer_vehicle_test_*` 数据库，不读取应用环境文件，不连接润丰 SQL Server。
润丰消费者源码不在本仓库，SQL Server 事务、车辆档案显示及跨单顺序需双方联调验收。

关联润丰已有单据的纸质委托书也支持四项更正：初始同步版本为 0，首次更正生成版本 1 的 `updated` 事件，并携带原 `reid/dh/pgd`，不会生成 `created`。
