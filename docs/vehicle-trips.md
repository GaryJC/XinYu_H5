# 出车申请与公司车辆管理

## 使用

- 所有在职、未停用员工均可进入“出车申请”。本人即驾驶员，不代他人申请或还车。
- 选择启用车辆，填写事由、可选备注，拍摄 1–9 张公里数照片，点击“提交并出车”。提交成功即进入“用车中”，服务端自动记录出车时间，无须管理员审批或再次确认出车。
- 车辆处于“用车中”或“待收车审核”时不能再次出车。提交冲突会整体失败，不留下新申请、附件记录或通知；请改选车辆或等待收车审核通过。
- 还车时拍摄另一组公里数照片，点击“提交还车审核”，进入“待收车审核”。提交时间与审核时间分别记录；审核期间车辆仍保持占用。
- 本店其他管理员查看本次照片后“审核通过”或“退回重拍”。通过后进入“已还车”并释放车辆；退回须填写原因，申请回到“用车中”，驾驶员重新拍照提交。不能审核自己的还车。
- 每次退回后使用新的还车轮次，保留之前已提交的照片。旧轮次照片不可用于新一轮还车，旧页面不能审核新一轮资料。
- 公里数只保存照片，不识别或计算。仅提供 `capture="environment"` 拍照入口，不提供相册入口；相机实际唤起行为由手机／钉钉 WebView 实现。
- 历史“待审批／待出车”记录不会批量改为出车。申请人可在详情补拍并“确认出车”，或取消；原审批、时间及已完成记录保留。已出车的旧申请也按新流程提交还车审核。
- 管理员维护公司车辆，停用后不能新出车，已出车记录仍可还车与审核。历史车辆信息使用申请时快照。

## 数据及接口

新增迁移：`202611090002_vehicle_trip_return_review.sql`。在原有车辆、申请、附件、操作及通知表上增加收车审核状态、审核人／时间／退回原因、还车轮次和占用查询索引；不改变历史申请状态或伪造历史审核人。

- `GET /api/company-vehicles`：本店启用车辆；管理员 `?all=true` 查看停用车辆。
- `POST /api/company-vehicles`、`PUT /api/company-vehicles/:id`：管理员维护车辆。
- `GET /api/vehicle-trip-requests`：有权查看的记录；支持 `scope=return-review` 查询待收车审核。原有 `all/mine/using/pending` 查询仍保留，`pending` 仅用于历史待审批记录。
- `POST /api/vehicle-trip-requests`：传 `vehicleId/reason/note/departurePhotos/requestId`，成功即出车。`departurePhotos` 为 1–9 个图片 Base64 字符串，总计不超过 12 MiB。
- `GET /api/vehicle-trip-requests/:id`：详情、照片（含 `returnRound`）、历史操作、出还车及审核信息。
- `POST /api/vehicle-trip-requests/:id/return`：申请人以 `fileIds` 提交本轮还车照片，进入待审核。客户端不能传入出还车时间。
- `POST /api/vehicle-trip-requests/:id/approve-return`：本店其他管理员审核通过，必须传当前 `returnRound`。
- `POST /api/vehicle-trip-requests/:id/reject-return`：本店其他管理员退回，必须传当前 `returnRound` 及 `reason`。
- 原 `approve/reject/cancel/depart` 路径保留处理历史未出车申请；旧审批通过也须校验照片、启用状态及占用，并立即出车。
- `POST /api/vehicle-trip-requests/:id/attachments`：上传还车照片或补拍旧申请出车照片。新客户端上传还车照片时同时传 `returnRound` 防止跨轮误传。申请已有出车照片时拒绝重复上传。
- `GET /api/files/:id/content`：未提交照片仅上传人可见；已确认照片仅申请人及本店管理员可见，保留门店隔离。

所有写操作使用稳定的 `requestId`；相同请求重试返回首次结果，不重复保存、通知或更新时间，同编号不同内容返回 409。审核操作还须核对轮次，防止旧页面审核后来重提的照片。车辆行锁串行化同车申请／旧申请出车，审核状态由申请行锁保护。

申请、照片数据库记录、操作和通知在同一事务内提交。物理图片存储不参与数据库事务回滚，失败时可能遗留未引用对象，沿用现有上传存储机制。

## 钉钉通知

- 自动出车与旧申请确认出车：通知本店其他有效管理员，文案明确已出车，不再要求出车审批或重复上传。
- 提交还车：通知本店其他有效管理员审核；申请人本人即使是管理员也不接收自己的审核通知。
- 审核通过、退回：通知申请人；退回消息包含原因。
- 历史驳回、取消仍使用原通知路径。
- 发送前重新校验当前状态、轮次、人员权限；旧轮次还车通知不会在再次提交后重新生效。上传照片本身不通知。

沿用 `DISPATCH_NOTIFICATION_MODE`、`DISPATCH_APP_URL`、`DINGTALK_AGENT_ID`、`DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、企业 ID 及每 5 秒的现有通知 worker。生产管理员名单同步失败不会回退到本地名单。模拟发送仅限开发／测试，没有其他审核人时保留待审核记录和通知重试。

## 验证与上线

- 部署前应用新增迁移，前后端和通知 worker 一起更新；未应用迁移时新版不能启动业务操作。旧代码不支持待收车审核，不能直接回滚而忽略新状态。
- `npm run check` 检查单元测试、类型和构建。
- 用本机 `DISPATCH_TEST_ADMIN_URL` 运行 `test/vehicleTrips.integration.test.mjs` 与 `test/operationsFollowupReview.test.mjs`，测试创建并清理独立临时库，不使用现有业务库或真实通知。
- 设置 `VEHICLE_TRIP_UI_TEST=true` 并提供 `DISPATCH_PLAYWRIGHT_MODULE`、`DISPATCH_CHROME_PATH` 可检查手机申请、收车、管理员退回／通过、照片轮次、通知链接及权限。手机实际相机须在钉钉真机核验。
- 性能：沿用现有图片压缩、12 MiB 合计限制与 16 MiB HTTP 请求上限；不新增依赖、轮询或后台进程。每次申请增加一次带索引的占用查询；退回轮次及审核信息使用同一申请行，普通列表无新增关联查询。上线验收需确认并发同车仅一笔成功、审核前持续占用、图片大小受限和通知不重复；未做大规模延迟基准测试。
