# 润丰数据库轮询接入

H5 委托单以 PostgreSQL 为主库。创建、修改和状态变化会在同一个 PostgreSQL
事务中写入 `legacy_sync_outbox`，不再由 H5 直接写 SQL Server。

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
- `event_type`：`created`、`updated` 或 `cancelled`；
- `payload`：版本化的完整委托单 JSON；
- `legacy_reid`、`legacy_document_no`、`legacy_dispatch_no`：已有旧系统关联，
  更新事件应优先使用这些字段定位旧记录。

字段映射：

- `payload.order.department.code` → `qxwxb.bm`
- `payload.order.advisor` → `qxwxb.jcr`

领取使用 `FOR UPDATE SKIP LOCKED`，支持多个消费者并行工作。消费者崩溃后，
管理员可以将长时间处于 `processing` 的事件标记为失败或重新入队。

## 成功 ACK

润丰必须在 SQL Server 事务提交成功之后执行 ACK：

```sql
select acknowledge_legacy_sync_event(
  'event-id',
  'runfeng-production',
  1028817,
  85641,
  'A66329'
);
```

ACK 成功后，PostgreSQL 自动回填：

- `work_orders.legacy_reid`
- `work_orders.legacy_document_no`
- `work_orders.dispatch_no`
- `work_orders.legacy_sync_status = 'synced'`
- `work_orders.legacy_synced_at`

如果 ACK 对应的不是最新版本，只回填旧系统关联，不会错误地把更新版本标记为已同步。

## 失败回填

```sql
select fail_legacy_sync_event(
  'event-id',
  'runfeng-production',
  'SQL Server transaction rolled back',
  60
);
```

事件会显示为 `failed`，60 秒后可再次被领取。管理员也可以立即重试：

```sql
select retry_legacy_sync_event('event-id');
```

## 最小权限

不要向润丰开放 `work_orders`、用户、签名或文件表，也不要提供 PostgreSQL 管理员账号。
创建专用登录账号后，仅授权三个同步函数：

```sql
grant connect on database your_database to runfeng_sync;
grant usage on schema public to runfeng_sync;

grant execute on function claim_legacy_sync_events(text, integer)
  to runfeng_sync;
grant execute on function acknowledge_legacy_sync_event(text, text, bigint, integer, text)
  to runfeng_sync;
grant execute on function fail_legacy_sync_event(text, text, text, integer)
  to runfeng_sync;
```

`retry_legacy_sync_event` 建议只授权给新系统管理员。

## 幂等和写入规则

- `event_id` 是消费幂等键；
- `created` 必须在 SQL Server 事务内生成真实 `dh` 和 `pgd`；
- `updated` 使用事件返回的旧系统关联更新原记录；
- SQL Server 事务提交失败时不得 ACK；
- 不允许通过 `MAX(pgd) + 1` 在 PostgreSQL 侧预生成 A 系列派工号；
- 日志中不得记录完整手机号、客户姓名、VIN 或整个 `payload`。
