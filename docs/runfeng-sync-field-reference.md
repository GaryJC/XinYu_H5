# `legacy_sync_outbox` 字段及 SQL Server 对应关系

`legacy_sync_outbox` 是 PostgreSQL 的同步队列表，不是 SQL Server 业务表的镜像。
因此大部分字段用于领取、锁定、重试和记录同步结果，在 SQL Server 中没有对应字段。

| PostgreSQL 字段 | 类型 | 字段含义 | SQL Server 对应字段/处理方式 |
| --- | --- | --- | --- |
| `event_id` | `text` | 同步事件唯一编号，也是消费幂等键。领取及成功、失败回填都使用该值。 | `qxwxb` 中暂无已确认的对应字段。润丰应在自己的同步日志或幂等记录中保存该值，防止同一事件重复生成接车单。 |
| `order_id` | `text` | H5 委托单编号，关联 PostgreSQL `work_orders.id`。 | 暂无已确认的 SQL Server 对应字段。不能直接当作 `qxwxb.reid`、`dh` 或 `pgd`。 |
| `revision` | `bigint` | 同一委托单的同步版本号，从 1 递增。 | 无直接对应字段；用于同步程序判断和记录事件版本。当前只同步首次创建，通常为 1。 |
| `event_type` | `text` | 事件类型：`created`、`updated`、`cancelled`；当前实际发送 `created`。 | 无直接对应字段；决定润丰执行新增、修改或取消操作。当前 `created` 表示新增 `qxwxb/qxwxmxb`。 |
| `payload_version` | `integer` | `payload` JSON 的结构版本，当前为 1。 | 无直接对应字段；仅用于润丰选择正确的 JSON 解析规则。 |
| `payload` | `jsonb` | 完整接车单业务数据，包含委托单主信息和 `order.repairItems` 维修项目数组。 | 不是单个 SQL Server 字段。应拆分后写入 `qxwxb` 主表和 `qxwxmxb` 维修项目表。当前已确认：`payload.order.department.code` → `qxwxb.bm`；`payload.order.customer.legacyCode` 是匹配到的 `khxxb.bm`，创建车辆档案时写入 `qxclxxb.ssdw`；`payload.order.advisor` → `qxwxb.jcr`。其他业务字段映射需由润丰依据旧库字段定义确认。 |
| `status` | `text` | 同步状态：`pending` 待领取、`processing` 处理中、`synced` 已成功、`failed` 失败待重试。 | 无直接对应字段；属于 PostgreSQL 队列状态，不应写入 `qxwxb/qxwxmxb`。 |
| `attempt_count` | `integer` | 事件被领取的次数，每次领取加 1。 | 无直接对应字段；用于重试和故障排查。 |
| `available_at` | `timestamptz` | 最早允许领取/重试的时间。 | 无直接对应字段；由 PostgreSQL 轮询程序使用。 |
| `locked_by` | `text` | 当前领取事件的消费者标识，例如 `runfeng-production`。 | 无直接对应字段；回填时传入的消费者标识必须与该值一致。 |
| `locked_at` | `timestamptz` | 事件被当前消费者领取的时间。 | 无直接对应字段；用于识别长时间未完成的任务。 |
| `legacy_reid` | `bigint` | SQL Server 接车单主记录内部编号，成功后由润丰回填。 | **`dbo.qxwxb.reid`** |
| `legacy_document_no` | `integer` | SQL Server 接车单单据号，成功后由润丰回填。 | **`dbo.qxwxb.dh`** |
| `legacy_dispatch_no` | `text` | SQL Server 派工单号，格式为 `A` 加数字，例如 `A66329`，成功后由润丰回填。 | **`dbo.qxwxb.pgd`** |
| `acknowledged_at` | `timestamptz` | 成功 ACK 的时间，状态变成 `synced` 时由 PostgreSQL 自动填写。 | 无直接对应字段；SQL Server 事务提交后再由 ACK 函数写入。 |
| `last_error` | `text` | 最近一次同步失败原因，最多保留 2000 个字符。 | 无直接对应字段；SQL Server 写入失败时，把异常摘要通过失败回填函数写到这里。 |
| `created_at` | `timestamptz` | 同步事件创建时间。 | 无直接对应字段；用于事件排序和排查，不等同于 SQL Server 的接车时间。 |
| `updated_at` | `timestamptz` | 同步事件最后更新时间，由 PostgreSQL 自动维护。 | 无直接对应字段；不需要写入 SQL Server。 |

## 直接对应关系汇总

```text
legacy_sync_outbox.legacy_reid         → dbo.qxwxb.reid
legacy_sync_outbox.legacy_document_no  → dbo.qxwxb.dh
legacy_sync_outbox.legacy_dispatch_no  → dbo.qxwxb.pgd

legacy_sync_outbox.payload.order.department.code → dbo.qxwxb.bm
legacy_sync_outbox.payload.order.customer.legacyCode → dbo.qxclxxb.ssdw
legacy_sync_outbox.payload.order.advisor         → dbo.qxwxb.jcr
```

前三项不是创建 SQL Server 记录前的输入值，而是润丰在 `qxwxb` 及维修项目写入成功、
SQL Server 事务提交后，再批量回填到 PostgreSQL 的结果值。

## 润丰读取时建议字段

```sql
select
  event_id,
  order_id,
  revision,
  event_type,
  payload_version,
  payload::text as payload_json,
  status,
  attempt_count,
  available_at,
  locked_by,
  locked_at,
  legacy_reid,
  legacy_document_no,
  legacy_dispatch_no,
  acknowledged_at,
  last_error,
  created_at,
  updated_at
from legacy_sync_outbox
order by created_at, event_id;
```
