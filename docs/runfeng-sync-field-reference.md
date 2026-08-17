# `legacy_sync_outbox` 与润丰字段对应关系

H5 以 PostgreSQL 为主库。草稿不进入同步队列；客户完成签字后，系统创建一条
`legacy_sync_outbox.status = 'pending'` 事件，由润丰程序轮询处理。H5 API 不直接写
`qxwxb`、`qxwxmxb`、`qxclxxb`、`cxb` 或 `khxxb`。

## 队列与回填字段

| PostgreSQL 字段 | 含义 | 润丰处理 |
| --- | --- | --- |
| `event_id` | 同步事件和幂等键 | 消费端保存并防止同一事件重复插单 |
| `order_id` | H5 委托单号 | 业务来源标识，不得作为 `reid/dh/pgd` |
| `revision` | 同一委托单的同步版本 | 按版本顺序处理 |
| `event_type` | 当前为 `created` | 创建维修单 |
| `payload` | 完整委托单 JSON | 拆分写入润丰业务表 |
| `status` | `pending/processing/synced/failed` | 由领取和 ACK/失败函数维护 |
| `legacy_reid` | 润丰主记录标识 | 成功后回填 `qxwxb.reid` |
| `legacy_document_no` | 润丰内部单号 | 成功后回填 `qxwxb.dh` |
| `legacy_dispatch_no` | 润丰派工号 | 成功后回填 `qxwxb.pgd` |
| `last_error` | 最近一次错误 | 失败回填时填写 |

ACK 成功后，数据库函数同步更新 `work_orders.legacy_reid`、
`work_orders.legacy_document_no`、`work_orders.dispatch_no` 和
`work_orders.legacy_sync_status = 'synced'`。因此派工号在润丰处理成功后才出现在 H5。

## payload 关键字段

| payload 路径 | 润丰对应关系 |
| --- | --- |
| `order.department.code` | `qxwxb.bm` |
| `order.arrivalDate` | `qxwxb.jcrq`，消费端转换为润丰日期格式 |
| `order.vehicle.plate` | `qxwxb.ch` / `qxclxxb.ch` |
| `order.vehicle.vin` | `qxclxxb.sbdm` |
| `order.vehicle.mileage` | `qxwxb.lc` |
| `order.vehicle.model` | `cxb.qc`，车辆档案 `qxclxxb.cx` 的名称部分 |
| `order.vehicle.modelLegacyCode` | `cxb.bh`，车辆档案 `qxclxxb.cx` 的编码部分 |
| `order.customer.name` | `khxxb.mc` |
| `order.customer.legacyCode` | `khxxb.bm` / `qxclxxb.ssdw` |
| `order.customer.contact` | 联系人/送修人字段 |
| `order.customer.phone` | 联系电话字段 |
| `order.advisor` | `qxwxb.jcr` |
| `order.repairItems[]` | `qxwxmxb` 维修项目明细 |

## 已有车辆与新增主数据

H5 在录单时仍直接读取润丰主数据用于匹配，但不会写入润丰：

- 优先按车牌或 VIN 匹配 `qxclxxb`；已有车辆继续使用其现存车型和所属单位编码；
- 车型和所属单位使用 AutoComplete，可选择已有 `cxb`/`khxxb` 项；
- 找不到时允许员工新增。H5 根据中文名称生成拼音首字母默认编码：车型默认大写、
  所属单位默认小写，员工可以修改；
- 编码输入停止 350ms 后查询润丰，已被任何主数据占用时要求修改；
- 确认后的名称和编码分别保存在 PostgreSQL，并随 payload 一起交给润丰消费者。

润丰消费者处理新车辆时必须在同一个 SQL Server 事务内：

1. 再次按车牌或 VIN 查询 `qxclxxb`，防止轮询等待期间其他员工已经建档；
2. 已有车辆复用现存 `qxclxxb.cx` 和 `qxclxxb.ssdw`；
3. 新车辆按 `modelLegacyCode` 查询 `cxb.bh`。不存在时创建车型；如果编码已被不同名称
   占用，则回滚并通过失败接口提示员工修改；
4. 按 `customer.legacyCode` 查询 `khxxb.bm`，同样执行复用、创建或冲突回滚；
5. 创建车辆档案，其中 `qxclxxb.cx = modelLegacyCode + ' ' + model`，
   `qxclxxb.ssdw = customer.legacyCode`；
6. 创建 `qxwxb/qxwxmxb`，提交 SQL Server 事务后再 ACK PostgreSQL 事件。

例如：

```text
vehicle.modelLegacyCode = DZXPST
vehicle.model           = 大众-新帕萨特
customer.legacyCode     = grqdswjty

qxclxxb.cx   = DZXPST 大众-新帕萨特
qxclxxb.ssdw = grqdswjty
```

前端 debounce 查询只用于尽早提醒，最终唯一性必须由润丰消费者事务和数据库约束保证。
消费者不得只相信 H5 查询时的结果，也不得用中文名称代替编码。

## 失败与重试

消费者写润丰失败时必须回滚 SQL Server 事务，再调用失败回填函数。事件会显示“同步失败”，
并可在延迟后重新领取。只有 SQL Server 已成功提交后才能 ACK；ACK 会把状态改为“已同步”并
回填 `reid/dh/pgd`。

领取、批量 ACK、失败回填和权限说明见
[`legacy-sync-polling.md`](./legacy-sync-polling.md)。
