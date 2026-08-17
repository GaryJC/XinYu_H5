# H5 直接写入润丰字段对应关系

新建委托单和保存草稿只写 PostgreSQL。客户完成签字时，Node API 在一个 SQL Server
`SERIALIZABLE` 事务内完成编号分配、车辆档案复用或创建、维修单主表和项目明细写入。
写入成功后，H5 将 SQL Server 标识回写 PostgreSQL；不再等待润丰轮询或回填。

旧的 `legacy_sync_outbox` 表和领取/ACK 函数暂时保留，用于识别历史数据和兼容已部署
迁移，但新签字流程不会再创建 `pending` 事件。

## 编号与幂等

| PostgreSQL | SQL Server | 处理方式 |
| --- | --- | --- |
| `work_orders.id` | `qxwxb.bzxx` | 写为 `H5:<委托单号>`，重试时先查询该标记，防止重复插单 |
| `work_orders.legacy_reid` | `qxwxb.reid` | SQL Server identity，插入后用 `SCOPE_IDENTITY()` 读取 |
| `work_orders.legacy_document_no` | `qxwxb.dh` | 在锁定 `qxwxb` 后取当前最大值加 1 |
| `work_orders.dispatch_no` | `qxwxb.pgd` | 在同一锁定事务中按部门派工号序列取最大数字加 1，例如 `A66659`、`B1275` |

`dh` 和 `pgd` 必须在同一个 SQL Server 事务内生成，不能在浏览器或 PostgreSQL 中用
`MAX + 1` 预生成。编号查询使用 `TABLOCKX, HOLDLOCK`，避免 H5 并发签字生成相同编号。
派工号前缀按真实库现有规则生成：`A→A`、`B→B`、`F→F`、`J→J`，机电二部
`M` 与机电一部共用 `A` 系列。

## `qxwxb` 维修单主表

| H5 字段 | SQL Server 字段 | 说明 |
| --- | --- | --- |
| `department.code` | `bm` | 润丰部门编码，例如 `A` |
| 固定空字符串 | `wd` | 创建内单；不创建 `wd='1'` 的外部维修单 |
| 自动生成 | `dh` | 内部单据号 |
| `arrivalDate` | `jcrq` | 写入前转换成 `YYYY.MM.DD`，例如 `2026.08.17` |
| 服务端当前时间 | `jcsj` | `HH:mm` |
| `vehicle.plate` | `ch` | 车牌号 |
| 已有车辆 `qxclxxb.cx`，否则车型编码加名称 | `cx` | 例如 `DZXPST 大众-新帕萨特` |
| `customer.contact`，为空时使用单位名称 | `sxr` | 送修人 |
| 维修项目名称合并 | `wxnr` | 维修内容 |
| 项目工费合计 | `fyhj`、`xmfy` | 当前 H5 只写项目工费，不创建材料费用 |
| `faultDescription` | `bz` | 故障描述/备注 |
| `advisor` | `jcr` | 服务顾问姓名 |
| 按部门序列自动生成 | `pgd` | `A/B/F/J` 系列派工号 |
| `vehicle.mileage` | `lc` | 进厂里程 |
| `customer.phone` | `lxdh` | 联系电话 |
| 固定 `小修` | `wxlb` | 初始维修类别 |
| `customer.contact` | `lxr` | 联系人 |
| 已有车辆 `qxclxxb.ssdw`，否则 `customer.legacyCode` | `ssdw` | `khxxb.bm`，不是中文单位名称 |
| 固定 `0` | `ywd` | 尚未生成外部维修单 |
| 固定 `0` | `zcbz` | 新内单初始值 |
| `H5:<work_orders.id>` | `bzxx` | H5 幂等来源标记 |

## `qxwxmxb` 维修项目明细

每个 H5 `repairItems` 元素写一条 `lb='项目'` 的记录：

| H5 字段/值 | SQL Server 字段 |
| --- | --- |
| 固定空字符串 | `wd` |
| 主表 `dh` | `dh` |
| 固定 `项目` | `lb` |
| `repairItems[].name` | `hh` |
| 固定 `1` | `sl` |
| `repairItems[].laborFee` | `dj`、`je`、`gs` |
| 项目顺序，从 1 开始 | `Xh` |

H5 不写 `lb='材料'`，也不直接写 `ckdb1/ckdb2`。仓库仍由润丰客户端按派工号生成
出库单并追加材料明细。

## 车辆档案、车型和所属单位

写维修单前按车牌或 VIN 查询 `qxclxxb`：

- 已有车辆：继续使用该车辆现存的 `cx` 和 `ssdw`，避免相同车辆产生不同编码；
- 新车辆：车型和所属单位先搜索现有主数据；员工可以复用候选项，也可以点击“新增车型”或
  “新增所属单位”；
- 新增主数据时，H5 按中文名称自动生成拼音首字母编码：车型默认大写，所属单位默认小写，
  与润丰现存习惯一致。车型编码最多 10 位，所属单位编码最多 50 位，只允许英文字母和数字；
  员工可以直接修改自动生成的编码并保留其大小写；
- 编码输入停止 350ms 后，H5 查询 `cxb.bh` 或 `khxxb.bm`。即使该主数据当前关联 0 辆车，
  也视为编码已占用；重复时显示占用该编码的名称，并要求员工修改；
- 客户签字时，服务端在同一 `SERIALIZABLE` 事务中再次检查编码。编码不存在则先插入
  `cxb`/`khxxb`，随后创建 `qxclxxb`；如果编码已经被不同名称占用，整个事务回滚并提示修改；
- 新车辆的 `qxclxxb.cx` 使用 `modelLegacyCode + ' ' + model`，`ssdw` 使用
  `customer.legacyCode`，VIN 写入 `sbdm`；
- 所属单位编码来自 `khxxb.bm`，例如 `grqdswjty`；车型编码来自 `cxb.bh`，例如
  `DZXPST`。中文名称和编码不得互相替代。

前端 debounce 查询用于尽早提醒，不作为最终唯一性保证；最终以 SQL Server 主键和签字事务
中的再次查询为准。因此多人同时使用同一新编码时，不会生成部分主数据或半张委托单。

旧库大量字段是 `char/varchar`，写入前会按旧编码的字节长度截断；日期不会把
PostgreSQL 的 `YYYY-MM-DD` 原样写进润丰。

## 失败行为

SQL Server 写入失败时，签字事务不会完成，签字 token 保持可重试状态，H5 会直接显示
写入失败原因。SQL Server 已提交但 PostgreSQL 回写失败时，再次请求会通过
`qxwxb.bzxx = H5:<委托单号>` 找到原记录并复用同一 `reid/dh/pgd`，不会创建第二张维修单。
