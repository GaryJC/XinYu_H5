# 润丰数据库轮询接入

H5 委托单以 PostgreSQL 为主库。保存草稿时只写 `work_orders`，不会创建同步事件。
客户完成签字后，系统在同一个 PostgreSQL 事务中把委托单状态改为 `已委托`，并向
`legacy_sync_outbox` 写入一条 `pending` 事件，不再由 H5 直接写 SQL Server。
后续草稿保存、派工、维修和结算状态变化不会再次加入润丰同步队列。启用已同步单四项更正后，专用编辑操作产生新的 `updated` 事件；详见 [更新对接说明](./runfeng-customer-vehicle-update.md)。

因此两类状态应分开理解：

- `work_orders.status` 是业务状态；草稿只显示 `草稿`。
- `legacy_sync_outbox.status` 是润丰队列状态；签字后的 `已委托` 才可能显示 `待拉取`。
- `work_orders.legacy_sync_status` 是队列状态在委托单表中的展示镜像，不是另一条队列。

润丰同步程序负责：

1. 从 PostgreSQL 原子领取待同步事件；
2. 在自己的 SQL Server 事务中写入或更新 `qxwxb`、`qxwxmxb`；
3. 成功后回填 `reid`、`dh`、`pgd`；
4. 失败时回填错误，系统会在延迟后允许再次领取。

## 事件领取

同一个 `order_id` 的事件严格按 `revision` 顺序领取。一次最多领取 100 条：

```sql
select *
from claim_legacy_sync_events('runfeng-production', 20);
```

重要字段：

- `event_id`：幂等键，同一个事件不得在 SQL Server 重复创建；
- `order_id`：H5 委托单号；
- `revision`：委托单版本；
- `event_type`：`created` 创建接车单；`updated` 仅更正四项信息及车辆档案，禁止新建维修单（默认关闭）；
- `payload`：版本化的完整委托单 JSON；
- `legacy_reid`、`legacy_document_no`、`legacy_dispatch_no`：已有旧系统关联，
  成功回填后用于关联旧系统记录。

字段映射：

- `payload.order.department.code` → `qxwxb.bm`
- `payload.order.vehicle.model` → `cxb.qc` / `qxclxxb.cx` 名称部分
- `payload.order.vehicle.modelLegacyCode` → `cxb.bh` / `qxclxxb.cx` 编码部分
- `payload.order.customer.name` → `khxxb.mc`
- `payload.order.customer.legacyCode` → `khxxb.bm` / `qxclxxb.ssdw`
- `payload.order.advisor` → `qxwxb.jcr`

例如 `vehicle.modelLegacyCode = "DZXPST"`、`vehicle.model = "大众-新帕萨特"` 时，
车辆档案车型按旧库格式写为 `DZXPST 大众-新帕萨特`。润丰应优先使用 payload
中已提供的编码，不要再次根据名称生成编码。完整规则见
[`runfeng-sync-field-reference.md`](./runfeng-sync-field-reference.md)。

领取使用 `FOR UPDATE SKIP LOCKED`，支持多个消费者并行工作。
领取优先处理累计领取次数为 0 的事件，再按可领取时间、创建时间排序。各工单互不等待，同一工单的后续版本仍须等待前序版本成功 ACK。

`processing` 自 `locked_at` 起满 10 分钟算一次超时。每轮最多领取 2 次：
首次失败或超时后至少延迟 5 分钟，第二次失败或超时转为
`failed` 并暂停自动拉取。消费端指定的更长延迟仍生效。超时也会保存原因，
无需润丰主动回报错误。API 每分钟以及每次领取时执行超时回收，每批最多 100 条。

`attempt_count` 保留累计领取次数，新增 `auto_attempt_count` 记录当前自动重试轮次的次数。
升级时已有未成功事件按现有累计次数初始化，已达到 2 次的待拉取/失败事件暂停，
正在领取的事件等本次完成或超时后再处理。

暂停后，由管理员先核对润丰是否已建单并修正数据，再使用已有数据库函数
`retry_legacy_sync_event(event_id)` 恢复。该函数只接受 failed，重置本轮次数，
保留原 event_id、revision、payload 和累计次数。本次未新增页面重试按钮。

新迁移保留原领取、成功回执、失败回执和重试函数签名，润丰原调用方式继续有效。
领取索引只覆盖尚可自动重试的 pending/failed 事件，超时回收使用既有 locked_at 部分索引。

原接口仍是至少一次投递。领取超时后仍在运行的旧任务存在晚回执风险，同名消费者
的旧 ACK 无法与新一轮领取区分。本次保持原事件标识及现有幂等约定，未修改润丰写库过程。

部署时先执行 `npm run migrate`，再重启 API 服务。此迁移不会立即批量重置事件，
下一次服务检查或润丰领取时开始恢复已超时事件。
本地隔离数据库验证：
`LEGACY_SYNC_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node --test test/legacySyncRecovery.integration.test.mjs`。

## 批量成功 ACK（推荐）

润丰必须在 SQL Server 事务提交成功之后执行 ACK：

```sql
select *
from acknowledge_legacy_sync_events(
  'runfeng-production',
  '[
    {
      "event_id": "event-id-1",
      "legacy_reid": 1028817,
      "legacy_document_no": 85641,
      "legacy_dispatch_no": "A66329"
    },
    {
      "event_id": "event-id-2",
      "legacy_reid": 1028818,
      "legacy_document_no": 85642,
      "legacy_dispatch_no": "A66330"
    }
  ]'::jsonb
);
```

一次最多回填 100 条，与领取上限一致。函数按传入顺序返回 `event_id` 和
`acknowledged`；如果某条不是该消费者领取的 `processing` 事件，该条返回 `false`，
润丰程序必须检查所有返回值。

ACK 成功后，PostgreSQL 自动回填：

- `work_orders.legacy_reid`
- `work_orders.legacy_document_no`
- `work_orders.dispatch_no`
- `work_orders.legacy_sync_status = 'synced'`
- `work_orders.legacy_synced_at`

ACK 后会将当前委托单标记为已同步，并保存旧系统关联。

## 批量失败回填（推荐）

```sql
select *
from fail_legacy_sync_events(
  'runfeng-production',
  '[
    {
      "event_id": "event-id-3",
      "error_message": "payload解析失败：缺少车辆VIN字段",
      "retry_after_seconds": 60
    },
    {
      "event_id": "event-id-4",
      "error_message": "SQL Server transaction rolled back",
      "retry_after_seconds": 120
    }
  ]'::jsonb
);
```

函数按传入顺序返回 `event_id` 和 `failed`。未填写 `retry_after_seconds` 时默认
60 秒；到期后事件可再次被领取。管理员也可以立即重试：

```sql
select retry_legacy_sync_event('event-id');
```

## 只读查询

联调期间，润丰账号拥有 `legacy_sync_outbox` 整张表的查询和写入权限，可以使用
`select`、`insert`、`update` 和 `delete`。该权限允许绕过领取及回填函数，生产联调
结束后应撤销写权限，仅保留 `select` 和专用同步函数。
普通查询不会领取或修改事件，未同步数据会在每次查询时继续返回：

```sql
select
  event_id,
  order_id,
  payload::text as payload_json,
  status
from legacy_sync_outbox
where status <> 'synced'
order by created_at;
```

直接查询只用于查看或联调，不会把事件变为 `processing`。批量和单笔回填函数都只
接受通过 `claim_legacy_sync_events` 领取、且 `consumer_id` 匹配的事件。

## 单笔兼容接口

原有的 `acknowledge_legacy_sync_event(...)` 和 `fail_legacy_sync_event(...)` 保留，
适用于单笔调试。生产轮询建议使用批量接口，避免每条接车信息单独往返 PostgreSQL。

## 数据库权限

数据库登录账号由部署环境单独管理，应用不依赖固定的 PostgreSQL 角色名。可由管理员向
实际使用的同步登录账号授予同步函数执行权限。下面用
`your_sync_login` 代表该账号：

```sql
grant connect on database your_database to your_sync_login;
grant usage on schema public to your_sync_login;

grant execute on function claim_legacy_sync_events(text, integer)
  to your_sync_login;
grant execute on function acknowledge_legacy_sync_events(text, jsonb)
  to your_sync_login;
grant execute on function fail_legacy_sync_events(text, jsonb)
  to your_sync_login;
```

生产账号不需要直接修改 `legacy_sync_outbox`。联调确需查看原始事件时可临时授予
`select`；`retry_legacy_sync_event` 建议只授权给新系统管理员。

## 幂等和写入规则

- `event_id` 是消费幂等键；
- `created` 必须在 SQL Server 事务内生成真实 `dh` 和 `pgd`；
- `updated` 必须保留原 `reid/dh/pgd`，使用四项字段白名单更新当前单和车辆档案；
- 四项信息以钉钉确认值为准，新单遇到已有车牌也适用；
- H5 暂不发送取消事件；
- SQL Server 事务提交失败时不得 ACK；
- 不允许通过 `MAX(pgd) + 1` 在 PostgreSQL 侧预生成 A 系列派工号；
- 日志中不得记录完整手机号、客户姓名、VIN 或整个 `payload`。
