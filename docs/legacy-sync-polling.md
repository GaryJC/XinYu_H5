# 润丰数据库轮询接入

H5 委托单以 PostgreSQL 为主库。保存草稿时只写 `work_orders`，不会创建同步事件。
客户完成签字后，系统在同一个 PostgreSQL 事务中把委托单状态改为 `已委托`，并向
`legacy_sync_outbox` 写入一条 `pending` 事件，不再由 H5 直接写 SQL Server。
后续保存、派工、维修和结算状态变化不会再次加入润丰同步队列。

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
- `event_type`：当前固定为 `created`，代表一张新接车单；
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

领取使用 `FOR UPDATE SKIP LOCKED`，支持多个消费者并行工作。消费者崩溃后，
管理员可以将长时间处于 `processing` 的事件标记为失败或重新入队。

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

数据库登录账号由部署环境单独管理，应用不依赖固定的 PostgreSQL 角色名。联调期间，
可由管理员向实际使用的同步登录账号授权同步队列读写权限和批量同步函数。下面用
`your_sync_login` 代表该账号：

```sql
grant connect on database your_database to your_sync_login;
grant usage on schema public to your_sync_login;

grant select, insert, update, delete on table legacy_sync_outbox to your_sync_login;

grant execute on function claim_legacy_sync_events(text, integer)
  to your_sync_login;
grant execute on function acknowledge_legacy_sync_events(text, jsonb)
  to your_sync_login;
grant execute on function fail_legacy_sync_events(text, jsonb)
  to your_sync_login;
```

`retry_legacy_sync_event` 建议只授权给新系统管理员。

## 幂等和写入规则

- `event_id` 是消费幂等键；
- `created` 必须在 SQL Server 事务内生成真实 `dh` 和 `pgd`；
- 当前 H5 不发送修改或取消事件；
- SQL Server 事务提交失败时不得 ACK；
- 不允许通过 `MAX(pgd) + 1` 在 PostgreSQL 侧预生成 A 系列派工号；
- 日志中不得记录完整手机号、客户姓名、VIN 或整个 `payload`。
