# 鑫宇 H5 与润丰维修系统轮询对接说明

版本：1.0  
对接方式：PostgreSQL Outbox 轮询  
适用范围：H5 客户签字后的维修委托单创建、车型/所属单位/车辆档案复用或新增、润丰单号回填

## 1. 对接目标

鑫宇 H5 负责录入委托单、OCR、客户签字以及保存结构化业务数据。客户完成签字后，H5 在
PostgreSQL 中生成一条待处理事件。润丰同步程序轮询领取事件，在润丰 SQL Server 中创建完整
维修单，成功后把润丰的 `reid`、内部单号和派工号回填给 H5。

本方案中：

- H5 API **不直接写入**润丰 `qxwxb/qxwxmxb/qxclxxb/cxb/khxxb`；
- 草稿不会进入润丰队列；
- 客户签字后事件状态为 `pending`，H5 显示“润丰：待拉取”；
- 润丰领取后状态为 `processing`，H5 显示“润丰：拉取中”；
- 润丰提交成功并 ACK 后状态为 `synced`，H5 显示“润丰：已同步”；
- 失败时状态为 `failed`，H5 显示错误原因，并允许延迟重试。

## 2. 双方职责

### 鑫宇 H5

- 保存委托单、车辆、客户、维修项目、签字等数据；
- 按车牌/VIN 查询润丰已有车辆，供员工复用已有车型和所属单位；
- 提供车型及所属单位 AutoComplete；
- 新名称默认生成拼音首字母编码，并在录入时查询编码是否已被占用；
- 客户签字后创建 `legacy_sync_outbox` 事件；
- 提供领取、成功 ACK 和失败回填的 PostgreSQL 函数；
- 根据 ACK 自动保存润丰编号并更新 H5 状态。

### 润丰同步程序

- 使用固定的 `consumer_id` 定时领取事件；
- 解析版本化 JSON payload；
- 以 `event_id` 做幂等，防止重复生成维修单；
- 在单个 SQL Server 事务内复用或创建车型、所属单位、车辆档案和维修单；
- 使用润丰现有保存逻辑补齐客户端要求的默认字段、状态字段及关联字段；
- SQL Server 提交成功后调用 ACK；失败时回滚并回填可读错误；
- 记录同步日志，便于按 `event_id/order_id` 排查。

## 3. 连接与权限

PostgreSQL 的地址、端口、数据库名、用户名和密码由鑫宇单独提供，不写入本文档。

推荐为润丰程序建立独立的最小权限账号，只授予：

```sql
grant usage on schema public to <runfeng_user>;
grant execute on function claim_legacy_sync_events(text, integer) to <runfeng_user>;
grant execute on function acknowledge_legacy_sync_events(text, jsonb) to <runfeng_user>;
grant execute on function fail_legacy_sync_events(text, jsonb) to <runfeng_user>;
grant execute on function acknowledge_legacy_sync_event(text, text, bigint, integer, text) to <runfeng_user>;
grant execute on function fail_legacy_sync_event(text, text, text, integer) to <runfeng_user>;
```

生产程序不需要直接 `insert/update/delete legacy_sync_outbox`。如联调阶段需要查看原始事件，
可临时授予 `select`，联调结束后撤销。

## 4. 状态流转

```text
客户完成签字
    ↓
pending（待拉取）
    ↓ claim_legacy_sync_events
processing（拉取中）
    ├─ SQL Server 成功提交 → ACK → synced（已同步）
    └─ SQL Server 回滚     → fail → failed（同步失败，延迟后可重新领取）
```

保存草稿或修改草稿不会产生事件。当前正式业务只产生 `event_type = created` 的首次创建事件。

## 5. 领取事件

建议每 5～10 秒领取一次，一次 20 条，最多允许 100 条：

```sql
select *
from claim_legacy_sync_events('runfeng-production', 20);
```

`consumer_id` 必须是非空且稳定的程序实例标识。ACK 和失败回填必须使用领取时相同的
`consumer_id`。

领取函数会原子地执行以下操作：

- 只选择到达 `available_at` 的 `pending/failed` 事件；
- 使用 `FOR UPDATE SKIP LOCKED` 防止多个消费者领取同一事件；
- 同一个 `order_id` 按 `revision` 顺序处理；
- 把状态更新为 `processing`；
- 设置 `locked_by/locked_at`；
- `attempt_count + 1`；
- 返回完整事件和 JSON payload。

关键返回字段：

| 字段 | 含义 |
| --- | --- |
| `event_id` | 全局事件编号，也是润丰幂等键 |
| `order_id` | H5 委托单号 |
| `revision` | 同一委托单的同步版本 |
| `event_type` | 当前为 `created` |
| `payload_version` | 当前为 `1` |
| `payload` | 完整委托单 JSON |
| `attempt_count` | 已领取次数 |
| `locked_by` | 当前消费者 |

## 6. payload 示例

```json
{
  "schema": "xinyu.work-order-sync",
  "version": 1,
  "eventId": "c2ea2a5d-f86d-4f15-97c6-b74acbed65d0",
  "eventType": "created",
  "revision": 1,
  "occurredAt": "2026-08-17T08:03:46.000Z",
  "order": {
    "id": "WT-20260817-18ACD5A6E34D",
    "status": "已委托",
    "dispatchNo": "",
    "arrivalDate": "2026-08-17",
    "shop": {
      "id": "shop-hq",
      "name": "抚顺路店",
      "address": "抚顺路店",
      "phone": ""
    },
    "advisor": "张三",
    "department": {
      "code": "A",
      "name": "机电一部"
    },
    "vehicle": {
      "plate": "鲁B12345",
      "vin": "LSVCH2A47CN165407",
      "mileage": "12000",
      "model": "大众-新帕萨特",
      "modelLegacyCode": "DZXPST",
      "purchaseDate": "2024-01-10"
    },
    "customer": {
      "name": "青岛水务集团有限公司",
      "legacyCode": "grqdswjty",
      "phone": "13000000001",
      "contact": "联系人",
      "address": "青岛市测试地址"
    },
    "inspection": {
      "belongings": ["行驶证"],
      "fuelLevel": "1/2",
      "exteriorIssues": []
    },
    "faultDescription": "车辆常规保养",
    "repairItems": [
      {
        "id": 1,
        "itemNo": 1,
        "name": "更换机油机滤",
        "laborFee": 180,
        "owner": "待派工",
        "status": "待派工",
        "startAt": "",
        "finishAt": "",
        "inspector": "待检验"
      }
    ],
    "estimatedFee": 180,
    "oldPartsHandling": "环保处理",
    "estimatedDeliveryAt": "",
    "settlementAmount": 0,
    "feeNote": "",
    "signatures": {
      "customer": "客户姓名"
    },
    "platformOrderNo": null,
    "createdAt": "2026-08-17T08:00:00.000Z",
    "updatedAt": "2026-08-17T08:03:46.000Z"
  }
}
```

## 7. 主要字段对应

以下为业务含义对应，润丰程序应结合现有客户端的完整保存逻辑写入，不要求 H5 100% 覆盖
润丰界面的所有字段。

| H5 payload | 润丰业务字段 |
| --- | --- |
| `order.department.code` | `qxwxb.bm` 部门编码 |
| `order.arrivalDate` | `qxwxb.jcrq` 进厂日期，转换为润丰日期格式 |
| `order.vehicle.plate` | `qxwxb.ch`、`qxclxxb.ch` 车牌号 |
| `order.vehicle.vin` | `qxclxxb.sbdm` VIN/底盘号 |
| `order.vehicle.mileage` | `qxwxb.lc` 进厂里程 |
| `order.vehicle.model` | `cxb.qc`，以及 `qxclxxb.cx` 名称部分 |
| `order.vehicle.modelLegacyCode` | `cxb.bh`，以及 `qxclxxb.cx` 编码部分 |
| `order.customer.name` | `khxxb.mc` 车主名称/所属单位 |
| `order.customer.legacyCode` | `khxxb.bm`、`qxclxxb.ssdw` |
| `order.customer.contact` | 联系人/送修人 |
| `order.customer.phone` | 联系电话 |
| `order.customer.address` | 客户/车辆地址 |
| `order.advisor` | `qxwxb.jcr` 服务顾问 |
| `order.faultDescription` | 故障描述/备注 |
| `order.repairItems[]` | `qxwxmxb` 维修项目明细 |

`order.id` 和 `event_id` 不是润丰的 `reid/dh/pgd`，不得直接当作润丰单号使用。

> 重要：润丰程序不能只执行最少字段的 `qxwxb INSERT`。此前验证表明，仅插入可查询的主记录
> 可能导致润丰客户端打开后车牌、车型、所属单位等字段无法正确加载。应复用润丰现有“保存维修
> 单”逻辑、存储过程或完整字段规则，补齐客户端依赖的默认值、内外单标记和关联键。

## 8. 已有车辆匹配

写入前必须先按车牌和 VIN 查询 `qxclxxb`：

1. 车牌命中已有车辆：优先复用该车辆；
2. VIN 命中已有车辆：复用该车辆；
3. 车牌和 VIN 分别指向不同车辆：停止处理并回填错误，不得自动合并；
4. 已有车辆必须继续使用其现存 `qxclxxb.cx` 和 `qxclxxb.ssdw`，不能用 OCR 名称覆盖；
5. 均未命中时，按下一节创建新主数据及车辆档案。

## 9. 新增车型、所属单位和车辆档案

H5 允许员工录入润丰不存在的车型和所属单位：

- 车型编码默认取中文拼音首字母并转大写，例如 `大众新帕萨特 → DZXPST`；
- 所属单位编码默认取中文拼音首字母并使用小写，例如
  `青岛水务集团有限公司 → qdswjtyxgs`；
- 员工可以修改默认编码；
- H5 的 debounce 查询只用于提前提醒，最终唯一性由润丰写入事务保证。

润丰消费者必须在**同一个 SQL Server 事务**中执行：

```text
BEGIN TRANSACTION

1. 再查 qxclxxb（车牌/VIN）
2. 若为新车辆：
   a. 按 modelLegacyCode 查询 cxb.bh
   b. 按 customer.legacyCode 查询 khxxb.bm
   c. 复用同名编码或创建缺失主数据
   d. 创建 qxclxxb 车辆档案
3. 使用润丰完整保存逻辑创建 qxwxb
4. 创建 qxwxmxb 项目明细
5. 记录 event_id 与生成的 reid/dh/pgd

COMMIT
```

编码处理规则：

| 情况 | 处理 |
| --- | --- |
| 编码不存在 | 创建主数据 |
| 编码存在且名称一致 | 复用已有主数据 |
| 编码存在但名称不同 | 整体回滚，回填“编码已被其他名称占用” |

建议的新车辆档案格式：

```text
qxclxxb.cx   = modelLegacyCode + ' ' + model
qxclxxb.ssdw = customer.legacyCode
qxclxxb.sbdm = vehicle.vin
qxclxxb.ch   = vehicle.plate
```

不得在领取事件后先单独提交 `cxb/khxxb`，再创建车辆或维修单，否则失败时会留下关联车辆为
0 的孤立主数据。

## 10. 幂等要求

`event_id` 是唯一幂等键。润丰端必须建立持久化同步日志或等价机制，至少保存：

```text
event_id（唯一）
order_id
处理状态
qxwxb.reid
qxwxb.dh
qxwxb.pgd
错误信息
处理时间
```

如果 SQL Server 已提交但 ACK 因网络失败，下一次处理同一 `event_id` 时必须返回之前生成的
`reid/dh/pgd`，不能再创建第二张维修单。

## 11. 成功 ACK

SQL Server 事务提交成功后再批量 ACK，一次最多 100 条：

```sql
select *
from acknowledge_legacy_sync_events(
  'runfeng-production',
  '[
    {
      "event_id": "c2ea2a5d-f86d-4f15-97c6-b74acbed65d0",
      "legacy_reid": 1028817,
      "legacy_document_no": 85641,
      "legacy_dispatch_no": "A66329"
    }
  ]'::jsonb
);
```

返回：

```text
event_id                              acknowledged
c2ea2a5d-f86d-4f15-97c6-b74acbed65d0 true
```

必须检查每条 `acknowledged`。返回 `false` 表示事件不是当前消费者持有的 `processing` 事件，
不得静默当作成功。

ACK 会自动更新 H5：

- `legacy_sync_status = synced`；
- `legacy_reid`；
- `legacy_document_no`；
- `dispatch_no`；
- `legacy_synced_at`。

## 12. 失败回填

SQL Server 事务失败时先回滚，再调用：

```sql
select *
from fail_legacy_sync_events(
  'runfeng-production',
  '[
    {
      "event_id": "c2ea2a5d-f86d-4f15-97c6-b74acbed65d0",
      "error_message": "车型编码 DZXPST 已被不同名称占用",
      "retry_after_seconds": 60
    }
  ]'::jsonb
);
```

错误信息最多保留 2000 字符。可恢复的网络错误建议 60～300 秒后重试；数据冲突应返回明确的
车型/单位名称和编码，便于员工修正。

## 13. 单笔兼容接口

联调时也可使用单笔函数：

```sql
select acknowledge_legacy_sync_event(
  '<event_id>',
  'runfeng-production',
  1028817,
  85641,
  'A66329'
);

select fail_legacy_sync_event(
  '<event_id>',
  'runfeng-production',
  'SQL Server transaction rolled back',
  60
);
```

生产环境建议使用批量接口。

## 14. 验收用例

双方联调至少覆盖：

1. 已有车牌：复用现有车辆、车型和所属单位；
2. VIN 命中但车牌未命中：仍复用已有车辆；
3. 车牌/VIN 冲突：失败且不产生任何新记录；
4. 新车辆、已有车型、已有单位：只新增车辆和维修单；
5. 新车型和新单位：同一事务创建主数据、车辆和维修单；
6. 编码与不同名称冲突：事务回滚并显示明确错误；
7. 同一 `event_id` 重复处理：只产生一张维修单；
8. SQL Server 提交后 ACK：H5 显示已同步并出现派工号；
9. SQL Server 回滚后 fail：H5 显示同步失败，重试不产生半条数据；
10. A/B/F/J 等部门派工号能够正常回填；
11. 润丰客户端打开生成的维修单时，车牌、车型、所属单位、联系人、电话、里程和项目均可见；
12. 草稿不出现在轮询结果中。

## 15. 上线检查

- PostgreSQL 专用账号和网络白名单已配置；
- 轮询程序使用固定 `consumer_id`；
- SQL Server 端存在 `event_id` 唯一幂等记录；
- 使用润丰完整保存逻辑，而不是最小字段 INSERT；
- 新主数据和维修单在同一事务；
- ACK 一定晚于 SQL Server COMMIT；
- 监控 `failed` 事件和长时间停留在 `processing` 的事件；
- 日志不得输出数据库密码、客户完整手机号或其他敏感信息；
- 先用 mock 批次联调，再处理真实签字订单。

## 16. 相关测试命令

鑫宇侧生成待拉取 mock：

```powershell
npm run mock:runfeng:refresh
```

成功后输出中应出现：

```text
work_order_status      = 已委托
work_order_sync_status = pending
event status           = pending
```

润丰领取后，H5 页面应依次显示“待拉取 → 拉取中 → 已同步”；成功 ACK 后同时显示润丰派工号。
