# Engineering Handoff

## 车辆卡片样式微调 — 2026-11-11

- 后续按批注将车型段落下方 margin 从 24px 缩为 12px；浏览器计算样式核对生效。用户正在编辑车辆弹窗，未关闭或干扰表单。

- 按页面批注为保险信息增加 14px/16px 内边距、8px 行间距及浅底色；用 flex 间距替代 br，保留长文字自动换行。编辑按钮加装饰性 Pencil 图标并保留文字，停用按钮使用 Ant Design danger，启用按钮保持正常样式。
- 类型检查与 diff 检查通过；在用户当前 533×679 浏览器核对保险区留白、图标和红色停用按钮。未点击停用或改动车辆数据，未部署。

## 公司车辆保险及 Excel 导入 — 2026-11-10

- 用户要求车辆管理维护保险、过期不能出车、Excel 批量更新，确认提前 30/7/1 天及到期当天通知管理员和服务顾问。实现另含过期一次提醒，首次导入或恢复服务只补当前阶段。按北京时间自然日，到期当天有效、次日过期；未录入／未生效也禁止申请、审批及旧确认出车，已出车可还车。服务端在车辆行锁内复查，不只依赖前端禁选。
- 新迁移 `202611100002_company_vehicle_insurance.sql` 新增起止日期、明细 JSON、去重通知表及到期索引。本地开发库已应用，生产未应用。上传原 Excel（实际验证解析 10 辆）按新车牌匹配，预览后整批事务保存；保留现有 ID、品牌、启停状态，表外车辆不删。新车品牌暂取车型列；原车牌只留备注，不按多个历史牌号猜测匹配。年审原文保留，保险列拆起止日期。3 MB/500 行/16 MB 展开上限，重复牌号及无效日期拒绝，重传不重复建车。
- 提醒沿用现有钉钉发送及结果查询，按车／保险到期日／阶段／接收人唯一键去重，发送前复查当前保险和用户岗位；已续保或阶段过时取消旧待发消息。发送前校验失败可重试，发送结果未知不盲目重发；lease 防重复领取。每小时扫描一次，每分钟最多处理 10 条，按门店合并管理员与顾问岗位同步；无新增客户端轮询或业务请求扫描。真实钉钉送达未验收，未发送真实消息。
- `npm run check`：1079 通过、35 环境跳过，类型／构建／包体预算通过；隔离库测试覆盖过期阻止申请和审批、恢复、导入权限／幂等／保留停用、提醒去重／续保取消／发送前故障重试。Chrome 390 px 导入预览及长文字卡片通过，原用车 360/390 px 流程仍通过。日志 `/tmp/insurance-final-check.log`、`/tmp/insurance-integration.log`、`/tmp/insurance-worker-check.log`；截图 `output/playwright/trip-approval-correction/insurance-*-mobile.png`。
- 测试注意：已关闭 Ant Design Modal 仍可能保留 DOM，同文案应限定车辆卡片选择器；截图前滚动到预览卡片等待定位稳定。部署先迁移再同步代码，并及时导入保险，旧车缺保险会被拦截；未部署、未推送、未导入生产车辆。操作说明 `docs/vehicle-insurance.md`。

## 指定生产单删除及 SSH 通道 — 2026-11-10

- 用户授权删除 `WT-20261026-8A6A8D6A7724`。通过现有 SSH 别名 `xinyu_new`、`C:\apps\XinYu_H5` 的生产配置及 `delete-production-test-orders.mjs` 先预览后精确删除。预览为待处理纸质委托书、无车牌／派工号／润丰关联；执行返回唯一 deletedPostgresOrderIds，润丰 found=false。删除后再次只读预览明确两库均无此单；脚本此时返回 1 属于“不存在”校验，不是删除失败。
- DMS 插件 `/register` 404 与 SSH 无关，不应直接判断所有生产访问不可用。先检查已有 SSH 配置；该 Windows SSH 默认 shell 是 PowerShell，多条命令用分号，不能用 cmd 的单个 `&`。精确主键删除未重启服务、未修改其他单据或车辆主数据，无持续运行开销。

## Windows 部署锁冲突 — 2026-11-10

- 用户提供的部署日志在 `deploy-windows.ps1` 获取 `.deployment.lock` 的 `File.Open` 处失败；尚未安装、迁移或切换。文件存在不等于锁残留，异常说明有活跃句柄占用，仅凭日志不能确定具体进程。先检查同一 AppPath 的上一轮云效部署，等待完成或确认卡住后取消该部署，勿删除锁或停止业务 PM2。
- 新增 `DeploymentLockTimeoutSeconds`（默认 300、范围 0–3600），只重试 Windows sharing/lock violation 32/33，每 2 秒尝试、每 15 秒提示；超时停止，其他 IO 错误立即抛出。继续持有排他锁至 finally 释放。无竞争时无等待，无业务请求开销；流水线总超时需计入等待上限。
- `npm run check` 通过；新增 Windows 子进程锁测试覆盖占用超时、释放后继续及成功后句柄释放，本机 macOS 跳过，尚未在 Windows 实跑。部署包须重新生成，旧包重试不会获得新逻辑。未连接服务器、未清锁、未推送或重新部署。

## 申请凭证改回公里数照片 — 2026-11-10

- 用户再次明确：申请上传**公里数照片**，不是行驶证。本节覆盖下方“用车流程最终更正”的凭证类型；审批通过即出车、收车交照片直接完成的状态流程不变。
- 新申请恢复 `departurePhotos`，服务端必填校验及新记录 `departure_evidence=mileage`；前端恢复仪表盘示例、公里数预览与驳回提示，保留仅拍照入口。已存历史 `license` 类型不重新标注；已应用迁移不改写，本次不需新增迁移。
- 全量 `npm run check` 通过（1049 通过、32 环境依赖跳过，类型、构建及资源预算通过）。临时数据库 + Chrome 完整申请／审批／还车测试通过，包含 360/390 px 页面。UI 集成读取 `dist`，必须先等构建结束再运行；与构建并发会读到旧文案。日志 `/tmp/mileage-correction-check.log`、`/tmp/mileage-correction-integration.log`，截图 `output/playwright/trip-approval-correction/`。未部署、未推送。

## 本地工作台加载失败 — 2026-11-10

- `localhost:5175` 显示“无法完成登录或加载数据／服务器处理失败”时，用户身份和统计仍能显示，实际失败的是列表查询。只读复现 PostgreSQL `42703: column wo.legacy_approved does not exist`，本地数据库缺 7 项迁移；隔离测试库已应用全部迁移，不能据此认为日常开发库也已更新。
- 确认 `.env.local` 数据库地址为本机后，用现有迁移脚本补齐缺失迁移（至 `202611100001`），未访问生产数据库。列表查询恢复：共 68 条，首批 20 条；浏览器刷新后错误提示消失、无号单据按创建时间降序展示。无需修改登录或排序代码。

## 无派工号单据置顶 — 2026-11-10

- 用户要求替代旧“空派工号最后”规则：按派工号排序时，无派工号单据始终置顶，组内按工单创建时间晚→早；有派工号继续按既有数字尾号及完整号码规则排序。派工号升／降序均适用；显式创建／更新／派工／完工时间排序保持原有规则。
- 共用比较器优先使用 `createdAtIso`，再使用 `createdAt`；无有效时间的旧数据排在无号组末尾。SQL 必须在 LIMIT/OFFSET 前应用同一规则，不能只重排当前页。派工任务、完工项目、运营项目和待定跟进补传原工单创建时间，不以派工或完工时间冒充创建时间。
- 注意 `work_orders.dispatch_no` 为 NOT NULL，数据库无号测试应使用空字符串／空格；共享比较器另覆盖 null／缺失值。新增分页回归覆盖无号跨页、两个派工号方向、保留创建时间排序；无新增数据库查询或迁移。
- 验证：`npm run check` 通过（1049 通过、32 项环境依赖跳过，类型、构建、资源预算通过）；本机临时数据库分页集成通过，测试库已清理。日志 `/tmp/unnumbered-sort-check.log`、`/tmp/unnumbered-sort-integration.log`。本次未改布局、未部署、未推送。

## 用车流程最终更正 — 2026-11-10

- 用户明确更正：申请时上传的是**行驶证**；出车仍须人工审批，通过即自动出车，不是申请即出车。收车提交公里数照片后直接完成，不再人工审核。本节替代下面 11 月 9 日的自动出车／收车审核规则，不得仅凭“自动出车”省略审批。
- 新申请改传 `licensePhotos`，保存为待审批，审批事务同时记录审批人与出车时间；待审批禁止调用 depart 绕过审批。旧缺照片待审批可补拍，补拍立即确认供审批人查看；旧待出车兼容入口保留，不能批量出车造成车辆冲突。
- 新迁移 `202611100001_vehicle_trip_approval_departure.sql` 区分 `departure_evidence=license/mileage`，旧公里数照片不重标为行驶证；将已有还车时间的待收车审核记录转为已还车，保留时间且不伪造审核人。历史审核字段／轮次／照片保留，旧审核接口停止推进状态。部署先顺序应用迁移，再同步更新前后端与通知 worker。
- 工作台待办、筛选与通知恢复出车待审批；批准消息明确已出车，收车消息明确已归还。旧“申请即出车”和“收车待审核”消息载荷不在新状态下复活。新申请使用行驶证拍照入口，不再展示仪表盘示例；还车保留公里数拍照。无新依赖、轮询或列表关联查询，继续使用车辆行锁及占用索引，未做大规模性能基准。
- 验证：最终全量检查通过，1047 项通过、32 环境依赖跳过，类型／构建／资源预算通过；隔离数据库申请流程及并发占用共 7 项通过；最终 Chrome + 临时数据库流程通过，含旧待收车审核迁移、旧待审批补拍、行驶证真实预览、审批即出车、直接还车、待办跳转、360/390 px 换行与间距。照片懒加载须滚动到整个照片容器，只有标题可见时图片可能仍在视口外。
- 日志 `/tmp/trip-correction-final-check.log`、`/tmp/trip-correction-integration.log`、`/tmp/trip-correction-ui-final.log`；截图 `output/playwright/trip-approval-correction/`。未部署、未推送、未改现有业务库、未发送真实通知；钉钉真机相机仍未验证。保留其他并行工作区修改。

## 自动出车、人工收车审核 — 2026-11-09

- 本节替代下节的“出车前审批／本人再次确认”规则。新申请拍照后提交即进入用车中，出车时间由服务端记录，不伪造审批人。还车先提交本次照片进入待收车审核，本店其他管理员通过后才进入已还车并释放占用；退回须填写原因，回到用车中重新拍照。管理员不能审核自己的还车。
- 新增 `202611090002_vehicle_trip_return_review.sql`，部署前须应用并一起更新前后端和通知 worker。迁移只增加状态、审核字段、轮次及占用索引，不批量改变历史申请状态。当天 `202611090001` 已用于其他迁移，不复用其版本号。旧待审批／待出车可由本人补拍并确认出车或取消，旧已完成申请保留原记录；旧 approve API 仍校验照片、启用与占用并直接出车。
- 收车审核前继续占用车辆。新申请与历史出车都在车辆行锁下检查用车中和待收车审核两种状态，新增非唯一部分索引支持查询；不添加可能被历史数据阻塞的唯一约束。普通列表不增加关联查询，无新依赖、轮询或后台进程；未进行大规模性能基准。
- 还车照片和申请均保存 `returnRound`。退回递增轮次，旧照片和操作快照保留，不能重用于新提交；审核必须携带当前轮次。上传幂等键也包括轮次，否则同一图片再次拍传可能返回上一轮附件。通知发送／接收人解析同样核对轮次，旧待审核通知不会在重提后复活；旧 create 通知的待审批载荷不能变成“自动出车”通知。
- 工作台 TodoOverview 的统计、分类文案和 WorkbenchPage 跳转一起改为 `return-review`，否则新审核虽然在申请详情可操作，却不会出现在管理员待办。历史 `pending` 查询仍保留。
- 最终 `npm run check` 全部通过（999 通过、30 环境依赖跳过，类型／构建／资源预算均通过）；隔离 PostgreSQL 的完整流程与并发占用 7 项通过；最终 Chrome + 临时库 UI 全流程通过，含360/390 px长文字、退回弹窗及提示间距、照片真实加载、两轮还车、桌面和工作台待办跳转。日志 `/tmp/auto-trip-final-check.log`、`/tmp/auto-trip-integration.log`、`/tmp/auto-trip-ui-final.log`；截图 `output/playwright/trip-return-review/`。
- 初次全量检查遇到并行工作区的 workbench 资源预算超限；隔离快照还原本次用车前端修改后仍超限，未通过放宽预算解决。随后最新工作区的最终全量检查已通过。浏览器检查需先滚动到照片区再等待懒加载实际图片，不应先定位尚未生成的图片角色；不要用临时 toast 的自动消失作为业务完成条件。
- 未部署、未推送、未修改现有业务数据库或发送真实钉钉消息；未验证钉钉真机相机。保留工作区其他并行修改。

## 申请用车时拍摄公里数照片 — 2026-11-09

- 新申请必须带 1–9 张 `departurePhotos`，照片、附件确认、申请、操作及通知在同一数据库事务内保存。提交后照片即为已确认凭证，审批人可查看；不能等到出车时才确认附件，否则审批人看不到。出车仍须由本人确认，保留车辆停用、同车占用、审批与时间记录规则。
- 已有申请照片时，出车从服务端读取已确认照片，拒绝重复上传。历史无照片申请仍可在批准后补拍，不能直接移除旧上传 API 或旧申请的入口。还车继续独立拍照并确认。
- 申请及出还车共用 `TripCameraInput`，仅保留 `capture="environment"` 拍照入口；桌面／各钉钉 WebView 对原生 capture 的实现不同，Chrome 自动化只验证入口属性和照片处理，没有验证手机实际相机。不要将其描述为服务端能证明照片来自实时拍摄。
- 图片沿用客户端压缩；Base64 合计限制 12 MiB，为现有 16 MiB HTTP 请求上限留余量，不新增依赖或迁移。操作幂等指纹包括申请照片，相同请求重试不会重复建立申请或附件。存储对象与数据库事务不共用回滚机制，失败事务不会留下业务记录，但仍可能遗留未引用的存储对象，和原上传路径一致。
- 验证：`npm run check` 通过（988 通过、30 项环境依赖跳过，类型与构建通过）；本机隔离 PostgreSQL 的申请流程与车辆并发占用测试全部 7 项通过。最终 Chrome + 隔离数据库流程验证通过，覆盖缺照片、损坏照片／多图中途失败、超量／超大、重复请求、审批前预览、批准后无上传控件、拍照预览及移除后提交、360/390 px 换行与间距、桌面布局及权限隔离。截图在 `output/playwright/trip-notifications/`，日志在 `/tmp/vehicle-trip-{check,integration,ui}.log`。
- 浏览器测试注意：Ant Design Form 的 name 渲染为表单 id；虚拟 Select 用键盘选择；必填标签含星号，提交按钮过渡期可能带 loading 可访问名称。使用稳定的控件定位和视口截图，避免 fullPage 截图的移动端固定层重复。现有大包警告仍在；未部署、未推送、未修改现有业务数据。

## UI review — 2026-11-04

- Keep page titles, actions, counts, and layout responsible for orientation. Avoid adding slogans, repeated navigation explanations, role summaries, or repeated photo-preview instructions.
- Keep information that changes a user's decision: required photo angles, signature-link invalidation, deletion consequences, permission restrictions, synchronization failures, and analytics definitions. Do not remove accessibility labels when simplifying visible copy.
- Do not derive a comparison metric from a current total. The old `MetricCard` displayed its current value as a fabricated increase over yesterday; it now displays only the supplied value.
- Use `CopyTextButton` for text and links. Direct Clipboard API calls can fail in older DingTalk WebViews and insecure contexts; the shared copy utility handles the fallback and restores focus inside dialogs.
- Keep procurement API mutations in `useProcurement`; page components compose forms and close drawers after successful saves. Preserve the existing refresh order and error handling.
- Remove styles and configuration that become unused when removing explanatory UI. Check both mobile and desktop layouts after doing so.
- The root handoff file did not exist before this review. The separate `docs/runfeng-integration-handoff.md` covers the Runfeng integration.

## Verification

- `npm run check`: tests, TypeScript checking, and production build passed (798 passed, 21 skipped).
- Browser checks covered the mobile technician list, mobile/desktop workbench, and desktop procurement list using the local development server.
- Actual DingTalk device testing and deployment were not performed. The build still reports chunks over 500 kB for the existing chart/PDF bundles.

## Company vehicle search — 2026-11-04

- Vehicle management filters the complete loaded list by plate, brand, or model in `useCompanyVehicles`, ignoring case and surrounding whitespace. If the list API becomes paginated, move search to the server to avoid searching only the loaded page.
- Adding a hook while the development page is open can leave React hot reload with the previous hook order and a blank page. Reload once before diagnosing this as a persistent runtime issue; a fresh load passed the browser checks.
- `npm run check` passed (798 passed, 21 skipped). Browser checks verified model search, case/whitespace handling, no matches, and clearing back to all eight local vehicles.

## All-employee order entry — 2026-11-04

- All supported employee roles can create orders, upload opening documents, use vehicle recognition/reference lookup, edit their own unsigned orders, and initiate customer signatures. Existing same-shop and responsible-person checks still apply. Ownership follows the existing `advisor` name field; creating an order sets it from the authenticated employee.
- `server/domain/orderEntryAccess.mjs` explicitly lists opening dependencies that do not require a technician's Runfeng employee binding. Do not extend this exception to dispatch, inspection, settlement, administration, or signature review.
- Direct dispatch still requires advisor/manager permissions. Remote customer signatures still require the existing advisor/manager review. Paper-order processing by other employee roles is limited to their own orders.
- When checking file ownership, require a nonempty user ID/name before comparing; two missing values must never grant access.
- `npm run check` passed: 806 passed, 21 skipped. New tests cover opening endpoint access for employee roles and ownership/cross-shop rejection. Browser verification was unavailable in this turn because the browser connection failed; no deployment was performed.

## Archive toolbar — 2026-11-04

- Search has its own full-width row. Date shortcuts use a compact selected state and an equal-width mobile layout; reset appears only when filters or sorting differ from the defaults.
- Bulk Runfeng refresh now shows its scope and preservation notice in a confirmation popover before starting. Keep this notice available even when reducing persistent helper text.
- Automated checks passed; browser preview remains unavailable because the browser connection failed. Verify the mobile toolbar and confirmation placement on a device before deployment.
- Follow-up: removed the workbench's “归档查询” heading and left-aligned the action row; the separate overview page retains its “工单全览” heading. Set the header's column alignment explicitly: `align-items: center` centers mobile titles/actions when the global `.panel-header` switches to a column.
- Mobile “自定义” and “更多筛选” opened the same drawer. Keep only four date shortcuts on mobile and put custom dates in the drawer; include an active custom date range in the “更多筛选” count. Desktop retains its separate date editor.
- Follow-up browser verification succeeded: the mobile toolbar has four date shortcuts, and “更多筛选” → “创建日期” → “自定义” exposes both date fields. All 18 archive tests and the production build passed.

## Code and permission review — 2026-11-04

- Opening-photo authorization must match `GET /api/files/:id/content`; thumbnails use the same path with `?size=thumbnail`. The former `/api/files/:id` and `/thumbnail` whitelist did not match the real route, so ordinary employees and unbound technicians could upload photos but could not preview them. Keep the downstream file ownership/shop checks in place.
- Technician and inspector work-order lists must include their own orders as well as assigned tasks. Preserve the shop predicate around the entire union, and cover both paginated and unpaginated queries. Empty identity fields must not establish ownership.
- Paper-order notifications intentionally permit some cross-shop reads. Those reads must never return `signatureToken` or `signatureTokenUsed`, including for managers and employees with the same name. Same-shop authorization uses all current role memberships.
- `replaceSignatures` runs during unrelated order saves, workflow transitions and synchronization. Its conflict update must not rewrite `signed_at` when the signer name is unchanged; preserve the existing signature file reference too.
- Every production Runfeng reference lookup/code-check must reject missing configuration instead of returning mock reference data. Keep development/test fixtures available only outside production.
- JSON API bodies are objects. Reject `null`, arrays and primitives with 400 before route handlers destructure them. Empty bodies remain `{}`. Unexpected exceptions are logged on the server and return a generic 500 message; explicit `HttpError` messages remain actionable.
- The older paper-order integration test used the owner's name with a technician role and expected rejection. That expectation became invalid after all-employee opening; it also mutated shared fixtures and caused misleading downstream failures. Use an unrelated employee for rejection checks and a separate fixture for owner success.
- Verification: `npm run check` with `REVIEW_TEST_ADMIN_URL`, `WORKFLOW_TEST_ADMIN_URL`, `PAPER_ORDER_TEST_ADMIN_URL` and `PAGINATION_TEST_ADMIN_URL` pointed at the local test PostgreSQL server passed: 847 tests passed, 18 skipped, zero failures; TypeScript and production build passed. These suites create/drop their own temporary databases and use temporary uploads. No existing business database, production service, or Git remote was modified. No browser/device test was performed in this review.
- Performance: no additional per-request database round trips, dependencies, background workers or schema changes. List queries add the existing advisor ownership condition; signature persistence avoids unnecessary timestamp updates. Large-volume query latency was not benchmarked. The existing chart/PDF chunks still exceed 500 kB.
- Online dependency advisory scanning was not completed: automatic approval rejected the dependency-metadata transfer, and the user chose local code review only. Do not retry it without new authorization. `answer-me-with-html` was not installed; the review report is a self-contained HTML file at `docs/code-review-2026-11-04.html`.

## Role navigation priority — 2026-11-04

- Keep role priorities in `primaryNavByRole`: technician/outsourcing → 我的维修, warehouse → 配件申请, inspector → 检验任务, advisor → 委托开单, employee → 出车申请, manager → 工作台. Use the primary role for ordering and all role memberships for visibility.
- Filter unauthorized/disabled entries before moving the primary entry to the front. Move only the filtered array so shared configuration and the remaining navigation order stay intact. Desktop, the mobile drawer, and the bottom bar all consume `visibleNavItems`; adding a generally available entry must not displace role-specific work from the first position.
- TypeScript checking and production build passed. Browser checks verified the first bottom-nav entry for technician, warehouse, inspector, employee, advisor, and manager, plus the technician's full menu. Restored the original technician test identity afterward.

## Task detail simplification — 2026-11-04

- Keep assignment and start-work instructions out of persistent task-detail paragraphs. Project cards, owner controls, selection state and action buttons provide the structure; retain conditional validation and conflict messages. Removed the repeated assignment, outsourced workflow and parts/start-work explanations.
- Render additional-repair/rework reasons as a full-width field in the existing overview definition list. A standalone paragraph inherited oversized body text; using the shared 12 px label / 14 px value styles keeps the reason consistent with other fields while preserving line breaks and wrapping.
- Verification: TypeScript and production build passed; `git diff --check` passed. Browser checks covered desktop and the reported 527 × 679 viewport, verified the reason typography and absence of the removed copy, and confirmed the project/owner controls remain visible. No business data was changed. The existing large-bundle build warning remains.

## Single-shop follow-up review — 2026-11-04

- The user currently operates one shop and asked to prioritize other defects. Keep existing shop isolation; do not remove checks or expand cross-shop functionality. Continue local-only review without online dependency advisory scanning.
- Dispatch mutations can commit before an HTTP 408/5xx response reaches the client. Preserve the original request ID, body and expected version across ambiguous failures; only definitive rejections clear the pending request. Generate the request ID inside the action's try/finally so WebView random-source failures cannot leave the busy flag locked.
- Pending project names used to accept 200 characters while repair editing and local writeback validation accept 100. The shared limit is now 96, reserving four characters for the 【待定】 prefix. Both draft and registration inputs use it. Existing stored names are not truncated or rewritten; historical overlong entries need explicit correction. The actual Runfeng varchar encoding/byte limits still require its existing server validation and were not verified against a live SQL Server.
- Reject malformed draft pending rows and duplicate IDs before writing. Two rows with the same ID previously duplicated one stable repair item and confirmation history. Same-name rows with distinct IDs remain valid.
- Removed the complete 润丰同步说明 disclosure and its unused icon/styles. 查看维修项目 now uses #1677ff and retains its accessible label and 44 px click area. Browser checks verified the removal and that the blue action scrolls to the matching project without modifying business data.
- Regression evidence: 9 of 11 new cases failed before fixes; the targeted 40-case suite passes afterward. Final `npm run check`: 822 passed, 22 environment-dependent tests skipped, zero failures; TypeScript and build passed. Separately, the dispatch, pending-repair and inspection-deferred PostgreSQL suites passed all 42 cases in temporary local databases; the pending suite passed again after the final name-limit change. `git diff --check` passed. No deployment or push was performed.

## Repair lifecycle follow-up — 2026-11-04

- Personal parts transitions replace the task's shared request with the worker's request while running the scoped policy. Carry the original shared request into start checks, preserving per-person material allocation. The initial full-preparation requirement was superseded by the user's explicit partial-start rule below. Record the actual item owner as the starter and preserve personal pauses. A blocked start must not fabricate start timestamps or participants.
- Accepting a reassignment may have no pending items because existing work is already in progress. Preserve that progress and its original timestamps/actors; do not leave the accepted task in 待接单 merely because no new item starts.
- `reopenRepairTask` must allocate IDs below `repairItemIdFloor`, current/catalog IDs and deferred IDs. Looking only at the current catalog reuses deleted negative IDs across rounds and conflates historical project identities. Persist the new floor with the round.
- Additional project names accepted by `reopen-repair` now have the same 100-character limit as editing, completion submission and local writeback validation. The dialog uses the same limit. Existing stored names are not silently truncated. Pending-repair names still use their separate 96-character limit to reserve the 【待定】 prefix.
- When scheduler deletion leaves only previously inspected projects, restore 维修完成 and enqueue the final writeback snapshot in the same transaction. Otherwise a cancelled settlement addition strands the task in 维修中 with nothing left to submit. Keep completed/submitted items immutable; removal must never mark an uninspected remaining item complete. Replay retains the same event and writeback rather than duplicating them. Writeback validation failures are recorded for handling rather than blocking the local cancellation.
- PostgreSQL integration cleanup can race with connection shutdown: `pool.end()` may resolve before every client emits `end`; an immediate forced database drop then produces “terminating connection due to administrator command”. The deferred-inspection suite now awaits client shutdown, following the existing dispatch/repair-round suites.
- Verification: the new lifecycle regression file passes all 14 cases, including both shared/personal preparation orders, preparation vs issue, acceptance/registration, pauses, history, ID allocation, length boundaries and deletion guards. The four local PostgreSQL suites (dispatch, repair rounds, pending repairs, deferred inspection) pass all 44 cases, with temporary databases automatically removed. The detailed results are in `docs/code-review-repair-lifecycle-2026-11-04.html`. Review remains local-only; no dependency advisory upload, production write, deployment or push.
- Final `npm run check`: 836 passed, 22 environment-dependent tests skipped, zero failures; TypeScript and production build passed. The existing chart/PDF chunk-size warning remains. `git diff --check` passed.

## Runfeng field sizes and independent worker progress — 2026-11-04

- The user explicitly authorized read-only verification of Runfeng column metadata after questioning the earlier 100-character explanation. Actual `dbo.qxwxmxb.hh` is `varchar(200)` and `wxr` remains `varchar(100)`. Fixed-text conversion checks show a Chinese character uses 2 bytes and 【待定】 uses 8. Do not describe 200 bytes as 200 Chinese characters or assume both columns were enlarged.
- The SQL writeback/preflight still used 100 bytes for both strings and converted project names through varchar(100), so 51–100 Chinese characters could be rejected despite fitting the enlarged name field. Project names now use 200 bytes for preflight, transaction validation and conversion; employee strings remain 100 bytes. H5 repair editing/reopen/completion retains 100 characters and pending names retain 96. No Runfeng schema or business rows were changed; actual write integration tests remain gated off without separate authorization.
- Personal parts requests must advance each worker independently. Regression covers A's request becoming ready, A starting and submitting while B still waits, then B becoming ready and completing their own submission without altering A's evidence. Whole-order stage may be 维修中 while individual items remain 待开工. Do not wait for all workers' requests or restart completed/submitted coworkers when another request becomes ready.
- The user clarified: **本人部分备齐即可开工**. Internal repairs now start when any line in that worker's request is prepared/issued; shared requests start only the designated recipient of prepared lines. A legacy whole-batch confirmation with no recipient allocation cannot bypass someone else's separate unprepared request. Keep all pending lines in the warehouse's 部分备齐/待备料 lists. Preparation arriving while another worker is already working must still start the newly ready worker. Started items retain their original timestamps and actors; pauses retain their state with an updated resume stage. Photo-only requests still require whole-request confirmation because they have no per-line readiness.
- Start availability is shared by the server and client through `canStartRepairWithParts`. Completion remains gated on fully prepared own/shared requests; outsourced workflows retain the previous full-preparation rule. Do not reuse `hasUnpreparedParts` as an internal start gate or hide the start button merely because remaining personal lines are pending.
- Authorized SQL verification used metadata and fixed-text conversions only: 100 Chinese project characters passed; employee strings over 100 bytes and unsupported characters were rejected. No actual Runfeng writeback was executed.
- Final verification after the partial-start change: `npm run check` passed (841 passed, 22 environment-dependent tests skipped, 0 failures), including TypeScript and production build; all 44 cases in the four local PostgreSQL suites passed. The 17-case lifecycle file includes the new warehouse visibility/pause/timestamp scenarios, and the primary-action tests exercise partial readiness without permitting early completion. `git diff --check` passed. No browser/device test, deployment or push was performed; the pre-existing bundle-size warning remains.

## Partial preparation labels — 2026-11-04

- Technician cards already use shared `partsStatus`, which distinguishes 部分备齐 when some lines are prepared/issued but the batch is not complete. The selected WT-DEMO-REPAIR-01 had one wholly pending oil line, so its 待备料 label was correct. Do not fabricate a partial state to match an example screenshot.
- Parts summaries and the technician detail notice now use that same partial-state predicate, avoiding 待仓库备料/等待仓库备料 when some material is already ready. Preserve line-level 已备齐/待备料 and completed/issued labels; no extra helper copy was added.
- Verified real components with isolated mock props at 527 × 679 and 1280 × 800, without modifying business records. Removed the temporary preview page and reset the viewport. Screenshot: `/tmp/parts-status-preview-mobile.png`. The 23 relevant tests, TypeScript/production build, and `git diff --check` passed; the existing bundle-size warning remains.

## Role-state explanation and remaining UI gaps — 2026-11-04

- While answering the user's request for the current role views, a local simulation of the real domain and client functions confirmed that `personalTask` filters items and personal parts but retains the whole-task stage (except individual pauses). Thus A partially ready and working / B unprepared leaves B's projects 待开工 and start disallowed, but B's card/detail header incorrectly suggests 正在维修. This presentation gap remains unfixed in the explanation turn; do not report it as already solved.
- Internal `DispatchTaskDetail` shows `task.partsRequirement` only; it maps personal `partsRequests` only for outsourced history. Manager/inspector details therefore lack a per-worker parts summary and can show 尚未登记 despite personal requests. Also unfixed in this explanation turn.
- The model has one `responsibleId` per project. It supports multiple workers on one order, not independent progress for multiple workers on one project. Material lines are not mapped to repair-item IDs; partial personal readiness starts the worker's eligible pending projects together.
- A submitted personal batch can be inspected before coworkers finish: `hasPendingInspection` and the 待检验 filter include mixed-progress orders. Whole-task stage remains 维修中 until the remaining submissions/completion permit a transition. The role comparison is documented in `docs/multi-technician-role-status-2026-11-04.html`.

## Role-state display fixes — 2026-11-04

- The user clarified that parts must be judged by each technician's own request; part-to-project binding is neither needed nor a missing feature. Keep the existing personal partial-preparation start rule.
- Resolved both display gaps above. `technicianTaskStatus` derives the card/detail header from the worker's actual items and submission record. A working / B waiting now renders 正在维修 / 待开工; A submitted or inspected renders 待检验 / 维修完成 while the whole order may remain 维修中. Preserve pause, acceptance, review, empty-item, outsourced and legacy unsubmitted-item semantics. This is a label projection: do not overwrite `personalTask.stage`, which also drives editing and submission actions. Task category filters/counts still use the existing whole-order rules.
- Removed the redundant “等待其他项目/维修工完成” text; a submitted batch may already be inspected. The existing inspection notice now follows the personal status.
- `TaskPartsSummary` renders personal requests under owner names and retains shared material separately. Dispatch detail, order overview and repair-round history reuse it; do not show an empty shared placeholder when personal requests exist or omit shared parts when personal requests are present. Outsourced inherited requests retain their historical label.
- Verification: 58 targeted tests passed, including real domain transitions, personal status rendering, action gates and shared/personal material rendering. TypeScript and production build passed; existing large-chunk warning remains. Browser checks covered 527 × 679 and 1280 × 800 with isolated mock props, plus a read-only existing technician detail. Screenshot: `/tmp/repair-role-status-verified.jpg`. Temporary preview files were removed and viewport reset. No business records were changed; no deployment or push.

## Interactive multi-worker dummy data — 2026-11-04

- User requested runnable dummy data. `npm run mock:multi-repair` created six local orders `WT-DUMMY-MULTI-20261104-01` through `-06`, plates `鲁B测料01`–`06`, dispatch numbers `DUMMY-MP-01`–`06`. Search `DUMMY-MP` with the all-results filter to find every scenario. Stable IDs plus a transaction advisory lock make reruns skip existing orders and preserve testing progress.
- Scenarios: both waiting; A partially ready/B waiting; A fully ready/B partially ready; A submitted/B waiting; A inspected/B partially ready; A personally paused with some material ready/B waiting. A is 李富强 (`u_dev_technician`), B is 维修工乙（模拟） (`u_demo_parts_technician_b`). Each order has two A projects, one B project, three material lines per worker, a clearly labeled local nameplate placeholder and one repair-evidence placeholder per worker.
- The development persona dropdown previously could not log in as B. Added `technician-peer` under the existing development-auth guard. The local fixture script supplies only this mock account's missing binding with synthetic code `DM002`, labeled 本地测试（非润丰员工）; it never overwrites an existing binding or queries Runfeng. Do not use this mock identity/binding in production.
- Entry script rejects nonlocal/production databases, real repair writeback and real DingTalk notification mode. Domain transitions and repositories create consistent task items/history without queueing external messages or syncs. Real writeback was disabled and notifications were mock in the local environment. Browser verification only changed login/navigation, not test-order progress.
- Created 6 orders successfully; reruns skipped all 6. Verified A/B status lists, B login, all three placeholder images loading, and inspector visibility of A's pending batch on 04 while B waits. For the mixed-progress order 04 (whole stage 维修中), the existing file policy requires the inspector to claim inspection before reading repair images; start with “开始检验”. Five authenticated-role tests, syntax checks, TypeScript/build and diff whitespace checks passed; the existing large-chunk warning remains. Restored 李富强 and left the page filtered to `DUMMY-MP`; screenshot: `/tmp/repair-dummy-data-created.jpg`. Local PostgreSQL required sandbox escalation; no production access, deployment or push.

## Multi-worker review and warehouse verification — 2026-11-04

- A personal `edit-repair-items` scope inherits the whole order's working stage. New projects must also pass `canStartRepairWithParts` before inheriting a started state; otherwise an unprepared coworker can bypass the gate by adding a project. Preserve existing started items, partial preparation, personal pauses and later warehouse-triggered starts.
- Resolved the previously documented personal category/count gap. `personalRepairStage` is shared by labels and explicit `personal=true` list queries. Bind that scope to the authenticated worker; never infer it from `technicianId`, since managers/inspectors use that filter for whole-order work. Return original tasks, and do not overwrite `personalTask.stage` used by mutation controls. Personal completion dates use the worker's inspected items. A warehouse+technician membership must not bypass personal date filtering via the warehouse's ordinary history exception.
- Mixed-progress pending inspection now grants eligible independent inspectors the same photo preview as whole-order pending inspection. Reuse `hasPendingInspection` and `canInspect`; read execution mode/review flags in the existing file query. Keep shop, active-role, self-inspection and file-modification restrictions. The previous dummy-data note requiring claim before photo preview is superseded. Removed the inaccurate all-workers-must-finish submission paragraph.
- Warehouse tests cover personal and shared preparation, issue, grouped preparation, remaining pending material after a coworker's submission/inspection, pause preservation, duplicate lines, stale versions and idempotent recipient notifications. Browser verification confirmed DUMMY-MP's 12 requests (5 pending, 4 partial, 3 ready) and order 02's five remaining selectable lines. No dummy order progress was changed.
- New integration regression persists/reloads a mixed order, verifies unprepared new projects, personal lists/counts, unclaimed inspector photo access, continued warehouse preparation after coworker submission/inspection, and replay without duplicate pickup notifications. Three PostgreSQL suites passed all 44 cases in temporary local databases and cleaned them up.
- Pitfall: passing all of `.env.local` into isolated tests leaks development Runfeng simulation/allowlist switches. This changed a stubbed worker test's path and caused a misleading failure. The successful runner retained the local PostgreSQL URL but stripped RUNFENG_/SQLSERVER_/LEGACY_/DINGTALK_ variables, explicitly disabled real repair writeback and used mock notifications. Never enable real writeback to repair a test fixture.
- Details: `docs/multi-repair-review-2026-11-04.html`; updated the earlier role comparison to reflect the now-fixed personal filters. Review remains local only; no deployment, remote dependency scan, production writes or push.
- Final verification: `npm run check` passed (853 passed, 22 environment-dependent tests skipped, zero failures), including TypeScript/build; `git diff --check` passed. Existing chart/PDF chunk warnings remain. Browser A's six dummy tasks classified as 4 in progress / 1 inspection / 1 completed; B's same six classified as 6 in progress / 0 inspection / 0 completed. A's inspection tab showed only 04. All three photos on unclaimed 04 loaded for the inspector. Restored the initial manager identity and order 02 detail after read-only browser checks.

## Continued review: review additions and inspection handover — 2026-11-04

- The review adapter reuses the ordinary edit transition with stage 维修中 and then restores 回审. A redundant post-edit loop forcibly started every new item, overriding the personal material gate added in the previous review. Removed that loop; unprepared personal additions stay 待开工 with no fabricated start time. No-parts/partially ready additions retain their existing valid behavior. After partial warehouse preparation, a review worker can explicitly start pending work; submission still waits for complete preparation. The ordinary 回审 scheduling behavior was not broadened.
- During mixed-progress inspection, a dual inspector/technician can be assigned unfinished repair work by selective reassignment or ordinary project editing. Previously their active inspection claim remained even though self-inspection checks correctly blocked them, preventing another inspector from claiming. Release the claim after these scheduling changes when the claimed inspector no longer qualifies. Keep completed item evidence and historical inspector attribution; unrelated edits retain a still-valid claim.
- Queue a new inspection job whenever an active pending inspection loses its claim, including the existing review-addition path. The consumer previously recognized only submission/retry event types and would mark a scheduling-triggered job obsolete. Derive the newest relevant event from actual inspection jobs instead; use the existing per-order event lookup and the queue's primary key, with no additional database round trip or schema change. A later unrelated edit must not invalidate the notice; newer inspection jobs still supersede older jobs. Existing recipient checks exclude repair participants and request replay remains idempotent.
- Before fixes, four of five targeted domain cases failed; a database regression then reproduced the replacement job being marked obsolete. The integration fixture must supply all four binding fields (code, name, department, bound_at) to satisfy `users_legacy_employee_binding_complete`, even for a synthetic dual-role user in an isolated test database.
- Final verification: `npm run check` passed (859 passed, 22 environment-dependent tests skipped, zero failures), including TypeScript and build. All 46 cases in the dispatch, deferred-inspection and repair-round PostgreSQL suites passed in automatically cleaned local test databases. Tests cover review editing/preparation/start/submission, selective reassignment, inline editing, review additions, replacement-recipient fanout, unrelated later edits, replay and preservation of valid/historical claims. `git diff --check` passed; existing chart/PDF large-chunk warnings remain.
- Report: `docs/repair-review-followup-2026-11-04.html`. No existing dummy progress, external notifications, Runfeng data, deployment or Git remote was changed. Browser/device interaction was not needed for these server-side fixes; actual DingTalk delivery was not tested. Local-only review remains in force.

## Continued review: delayed notices, signing and personal states — 2026-11-04

- A queued pickup notice can cover multiple lines or applications. Partial issuance used to invalidate the whole notice via `every`, losing reminders for remaining ready lines. `currentPartsNotification` now resolves the delivery payload from the original notification scope, matching request revision, recording time, repair round, line index, preparation time and recipient; it removes issued/stale lines and rebuilds the summary. It never adds subsequently prepared lines or mutates stored notification evidence. Keep the Boolean validator API for other callers. The worker delivers the resolved payload without another database query or queue write. Legacy whole-batch/photo requests retain their behavior, and an empty remaining scope cancels delivery.
- Upcoming-deadline reminders now reuse `hasSubmittedPersonalWork` to exclude workers whose own work has been submitted or inspected while coworkers remain active. Apply the same exclusion inside the existing candidate SQL before its 100-row limit; otherwise already handled coworkers can keep inactive candidates at the front and starve later actionable orders. Preserve old per-item completion that still needs formal submission, unfinished additions, pauses, role checks and outsourced exclusions. A temporary-table regression verifies 110 already-finished orders cannot occupy the candidate batch.
- Reject a personal `pause` after submission or inspection completion, even if the whole order remains 维修中. Otherwise stale requests can create a personal pause after the UI has hidden the resume controls. A worker with a new/returned unfinished item may still pause; do not confuse an old workerSubmissions entry with completed current work.
- The inspection-deferred scheduling service bypasses the normal edit transition. Mirror the active inspection-claim reconciliation there: when the claimed inspector becomes a repair worker and pending inspection remains, clear only the invalid claim and enqueue one replacement-inspection job in the same transaction. Preserve valid claims, historical inspected items, and the deferred entry's original inspector. Replay must not queue twice. Database regression covers both conflicting and unrelated scheduling plus actual replacement-recipient resolution and later inspection.
- `signWorkOrderByToken` accepted missing, blank or non-string signer values. `replaceSignatures` could omit the customer row while the token was still consumed and onsite confirmation advanced the order. Validate the signer/file ID and require exactly one persisted customer signature when binding the file before consuming the token. Invalid requests roll back and can retry the original session. Remote signatures still derive the signer server-side and await staff review; supplemental signatures preserve active repair status. Existing dispatch integration fixtures used object signers despite the client API's `signature: string` contract; update those fixture calls instead of preserving invalid input.
- Test pitfalls: a synthetic legacy employee code must fit varchar(5); supply separate SQL parameters for text/varchar fixture columns to avoid PostgreSQL's inconsistent inferred parameter types. The pending-repair integration suite also needed the previously documented `connectionsClosed` wait after `pool.end()` and before dropping its temporary database. Its sporadic forced-disconnect failure was a test teardown race, not a workflow failure. The workflow recovery suite's old partial-preparation expectation was updated to the user's established partial-start rule, while retaining the full-preparation submission guard.
- Final verification: `npm run check` passed (874 passed, 24 environment-dependent tests skipped, zero failures), including TypeScript/build. Seven regression files run with local PostgreSQL passed all 87 cases with zero skips/failures: dispatch, deferred inspection, repair rounds, pending repairs, workflow recovery, access follow-up and notification follow-up. Temporary databases were removed; reminder-query temporary tables were rolled back. Logs: `/tmp/repair-continued-check.log` and `/tmp/repair-continued-integration.log`. `git diff --check` passed; existing chart/PDF chunk-size warnings remain.
- Report: `docs/continued-review-notifications-signatures-2026-11-04.html`. No existing dummy progress, production/Runfeng data, real notifications, deployment or push. No browser interaction was needed for these server-side fixes. Local-only review remains in force.

## Other modules: fleet, order entry, signatures and mock recovery — 2026-11-04

- After rechecking the previous notification/signature fixes, review moved to other modules. A vehicle row lock alone did not prevent two different trip applications from both departing: after acquiring the existing vehicle lock, query for another 用车中 request and reject with 409. Multiple pending/approved applications remain allowed. Real concurrent tests verify one winner, atomic rejection (no attachment confirmation/operation/notification), other vehicles remaining usable, and retry after the first vehicle is returned. No schema change or historical-row cleanup was performed.
- Customer/vehicle corrections on formal orders did not invalidate an already opened supplemental-signature page. Revoke unused signature tokens inside the same correction transaction, before the outbox commit. No-op updates retain the current session; an outbox failure rolls back both data and token revocation. Existing used tokens, signature images/timestamps/review records and signed historical long project names remain intact. Old public pages are rejected before image storage; a fresh session displays the corrected data.
- Both onsite-signature callers now use `saveOnsiteSignature`. If upload/signing loses its response, read the same token and require the expected order ID, a consumed token, a persisted signature file and a pending/confirmed review state before recovering success. No mutation is retried by the recovery read, and normal successful signing adds no lookup. Preserve the original error if recovery is unavailable or the order is unsigned/foreign. A subsequent archive-list refresh failure must not turn a committed signature into a submission failure; show a separate refresh error.
- Saving a signature is not the same as staff confirmation. A second device can switch the same reusable token from onsite to remote mode while the original onsite dialog remains open. Both ordinary successful responses and recovered responses can therefore have review.state=pending. The dialog now uses the returned review state for confirmation copy, marks the saved signature complete to stop repeat submission, and accurately displays 待核对确认. The same result logic handles the sharing panel's update. Tests execute the real dialog click handler and assert that pending signatures never display 已确认/已提交润丰.
- Opening input still allowed 200-character ordinary repair names, while editing/submission accepted only 100. A real database reproduction created, signed, dispatched and accepted a 101-character project, then its unchanged edit failed. New/create/save input uses shared server `normalizeDraftRepairItems` with a 100-character bound; unsigned historical long projects are stopped before signing and require explicit correction. The editor and draft validator use 100 for ordinary work and the existing `pendingRepairNameMaxLength` (96) for pending work. Existing signed/history paths do not run this new draft validation, and no stored name is truncated. Runfeng's verified 200-byte field limit remains unchanged. Update test import stubs when adding a shared constant; do not route business imports through unrelated modules solely to satisfy test stubs.
- Mock repair-writeback retry previously reset its queue while retaining a structurally invalid snapshot with missing employee bindings. Extracted recovery returns a validated repaired snapshot; the real path keeps its prior persistence behavior. In mock mode, save the result only to `repair_writeback_simulations.snapshot`, and let the simulator reuse that isolated snapshot. Never change real task status/error/attempts/snapshot or perform SQL Server/dispatch-number preflight during mock recovery. Valid original or simulated snapshots remain immutable despite later employee-binding changes; synced/manual real jobs remain ineligible. Five new stub regressions plus existing real-path stub tests verify these boundaries. Updated `docs/repair-inspection-writeback.md` with the isolated recovery behavior.
- Test maintenance: the older vehicle-trip integration still expected employee and unbound-technician order-entry routes to return 403, contradicting the established all-employee opening policy. Updated those expectations to 200 and added assertions that dispatch remains 403. Its temporary database cleanup now awaits all pool connection end events before dropping the database. Local integration runners must point business connections at newly created temporary databases, not the existing URL used only for administrative database creation; keep real Runfeng writes and external notification delivery disabled.
- Final verification: `npm run check` passed (894 passed, 26 environment-dependent skips, zero failures), including TypeScript and build. Ten regression files with local PostgreSQL passed all 100 cases with no skips/failures: new opening/signature correction, new fleet occupancy, existing vehicle trips, customer/vehicle corrections, workflow recovery, signature access, dispatch, repair rounds, pending repairs and contact/signature migration. Temporary databases were removed. Logs: `/tmp/other-modules-check.log`, `/tmp/other-modules-integration.log`; signature before/after reproduction is `/tmp/other-review-signature-before.log` and `/tmp/other-review-signature-after.log` (the final targeted run passes 23 cases). `git diff --check` passed; existing large chart/PDF chunk warnings remain.
- Report: `docs/other-modules-review-2026-11-04.html`. No existing dummy progress, real Runfeng data, real messages, online advisory scan, deployment or push. Browser/device interaction was not performed in this round; frontend recovery and displayed outcome were checked with real client functions/dialog handlers under controlled responses. Review conclusions apply to the covered paths, not a guarantee that every project module is defect-free.

## Procurement, exports and workload follow-up — 2026-11-04

- A stale award modal could settle newly amended quantities/prices after another purchaser reopened and closed the tender. `settle` now requires the displayed `expectedVersion`, checked after the existing tender row lock and before lazy deadline freezing. This ordering lets an already elapsed deadline, displayed as closed, settle using the version the user actually read. Invalidation changes increment the parent tender version in the same transaction; repeating the same reason is a no-op. An explicit winner selection must never silently become a failed tender after every offer becomes invalid. The client captures the displayed version in the confirmation callback; missing/stale versions return 409 and require a fresh confirmation.
- Quote idempotency must compare original normalized request fields before calculating a new total from current tender quantities. `quoteRequestInput` excludes only derived totals, retaining terms version, prices, freight, delivery time, compliance, decline state and note. A committed replay returns success without creating another quote/notice or changing the historical amount; genuinely new requests still validate current terms and deadlines. Do not treat an old successful request as a new quote: the supplier hook retires its request ID immediately after a successful response, before refreshing portal data. Only ambiguous responses retain the ID for retry. Regression includes another device declining between two identical deliberate quotes and a failed refresh after successful saving.
- The documented Nginx proxy connects from loopback and appends the actual client address to X-Forwarded-For. Using the socket address alone made all suppliers share the same verification limit. `localProxyClientAddress` trusts only the documented loopback forms and a fully valid IP chain, selecting its last address. Public direct callers cannot choose their limiter key using forwarded headers; absent/malformed headers fall back to the socket. Scope is procurement verification only, not unrelated audit metadata. Tests cover independent clients, a shared actual client despite forged prefix addresses, invalid chains, public spoofing and IPv6 loopback forms. Parsing adds no database/network request.
- PDF and photo-DOCX cache replacement used to delete the user's prior valid handoff before checking global capacity. Calculate retained capacity excluding that user's prior file, and only revoke old links after successful preparation. Capacity rejection preserves all old files; exact-budget replacement still succeeds. Tests use bounded stores or fake document lengths rather than allocating large documents. Download capabilities retain their existing short lifetime and random tokens.
- Ordinary employees/unbound technicians could open their own order but mobile PDF preparation was rejected by the global role gate. Only POST `/api/work-orders/:id/print-pdf` joins the existing order-entry exemption. Downstream same-shop/owner checks remain required; foreign orders, dispatch and photo-document export are not added. Tests execute the real API route with database stubs and verify authorized preparation, foreign-owner/shop rejection, opaque downloads and continued authentication for business endpoints.
- Workload statistics still used whole-batch readiness and applied all shared material to every worker. Derive waiting/outbound flags from relevant lines: personal requests follow their applicant owner, shared lines their recipient, and unallocated legacy material remains shared. Partial readiness can count both waiting preparation and pending outbound; issued lines count neither. Outsourced tasks include inherited personal requests. Project progress remains the source of working/waiting/inspection state, and no material-to-project binding is introduced. Four new tests failed before the fix and pass afterwards; another reviewer checked the rule boundaries.
- Local pagination integration passed, covering stable ordering/counts, search/date/status/person filters, role visibility and shared warehouse request pagination. No additional pagination or business-analytics defect was reproduced in this pass.
- Final verification: `npm run check` passed with 909 passes, 27 environment-dependent skips and zero failures; TypeScript and production build passed. Local isolated PostgreSQL procurement suites passed all 21 cases and pagination integration passed its additional case (22 total, zero skips/failures). Temporary databases were removed. Independent reviewers checked procurement version/idempotency and workload ownership boundaries. `git diff --check` passed. Logs: `/tmp/procurement-export-check.log` and `/tmp/procurement-export-pagination.log`; report: `docs/procurement-export-review-2026-11-04.html`. Existing chart/PDF bundle-size warnings remain. Browser/device interaction was not performed; local real-hook/route tests used controlled responses. No existing dummy progress, real Runfeng data, real messages, online advisory scan, deployment or push.

## Technician monthly project reconciliation — 2026-11-05

- Added the independent 完工核对 page to technician/outsourcing navigation, including a direct mobile bottom-nav entry. Default to the current Shanghai calendar month and allow month selection. Show individual completed projects, vehicle, dispatch/order number, completion date and project count. The user explicitly excluded labor-hour calculations and ultimately removed the proposed 正在维修 category.
- Completion uses an item's 已完工 status and inspectedAt, with task.completedAt only as a legacy fallback. Include the user's completed items while coworkers remain active. Preserve archived repair rounds and exclude the archived copy of the current round. Attribute unowned legacy items only when a single technician is unambiguous. Unknown completion dates cannot be assigned to a month and are excluded.
- Keep queries in a dedicated repository, ownership/month logic in a domain module, actor authorization and pagination in a service, and the response contract in shared/types.ts. The endpoint is scoped to the authenticated user and shop. It returns twenty projects per page. Historical rows are independent of current assignment for reconciliation, while opening the existing task detail continues to enforce existing dispatch access permissions.
- Cards open the existing technician detail in a drawer within the reconciliation page. Preserve the mounted list and selected month on close, then refresh the loaded pages. Do not navigate to 我的维修 for this entry point, as that loses the reconciliation context. Honor busy/photo-upload close guards.
- Verification passed with npm run check (956 passed, 29 environment-dependent skips, zero failures), TypeScript and production build. Five focused domain cases cover month boundaries, per-item completion, ownership, archived rounds and ambiguous legacy records. A local transaction with temporary tables verified the repository's current-round deduplication, shop isolation and owner isolation, then rolled back. Mobile browser verified two completed dummy projects, opening the correct repair order, and closing back to 完工核对 with the month and list retained. Existing chart/PDF chunk warnings remain. The initial browser request during a server hot restart returned 502 and succeeded on refresh.

## Completed-project reconciliation review — 2026-11-05

- Explicit user requirement verified in SQL and domain regressions: individual 已完工 projects count even while coworkers remain active and the whole order is still 维修中. Never add whole-task completion, current technician membership, or order settlement as a prerequisite for historical personal project counts.
- Reproduced two date defects before fixing. prepareSettlementAssignment clears whole-task completedAt when adding pre-settlement work. Legacy already-completed projects lacking inspectedAt consequently disappeared and later inherited the new month's whole-task completion. Preserve their known former date as item.completionRecordedAt before clearing the task field. This is JSON metadata using the existing storage schema, not an invented inspection timestamp. Clear it alongside inspection evidence on send-review. Date selection now uses inspectedAt, preserved legacy completion, outsourced item finishAt, then the task fallback. Outsourced partial completions previously waited for or inherited the whole-order completion month.
- Reproduced a SQL/domain mismatch with technicianIds JSON null. Domain nullish fallback resolves the single technicianId, while SQL IS NULL only matched absent keys. Normalize JSON null using nullif before the fallback predicate. The repository regression verifies foreign shop and unrelated worker exclusion.
- Extended actual repair-round integration to query monthly lists after a second reopen and reassignment. Original technician retains both round-zero completions, the new technician retains both round-one completions, and the current round's archived copy is excluded. Same-name projects and reused item IDs in distinct rounds remain distinct work. An isolated SQL fixture verifies mixed-progress A=2/B=0 and 27 records across two pages without duplicate keys.
- Verification: npm run check passed with 959 passes, 30 environment-dependent skips and zero failures, including TypeScript/build. The two separately enabled PostgreSQL suites passed with zero skips/failures and cleaned up their temporary resources. Their final run also verifies updated expectations for preserved legacy metadata after cancelling an addition and reopening. git diff --check passed. Existing chart/PDF bundle warnings remain. Logs are /tmp/monthly-review-before.log, /tmp/monthly-review-sql-before.log, /tmp/monthly-review-sql-after.log and /tmp/monthly-review-check.log. Report is docs/completed-project-review-2026-11-05.html.
- Unknown historical dates still cannot be assigned to a month. Previously lost dates are not fabricated. Historical detail access retains existing dispatch authorization even though monthly counts preserve former owners. This pass changed backend date preservation/query compatibility and tested them locally; no browser layout changes were made.

## Reconciliation cards grouped by dispatch order — 2026-11-05

- User requested prominent dispatch numbers and all projects for the same dispatch order in one card. The card now uses a large blue dispatch number, secondary vehicle plate, and per-project completion dates/repair rounds. Missing dispatch numbers use the order ID. Group by stable order ID so unrelated orders with identical or empty display numbers cannot merge.
- Group on the server before pagination via groupBy=order. Paginating raw projects first would split one dispatch card between pages, especially on desktop. The existing ungrouped endpoint response remains available for callers without the grouping option. Grouped results return order total for paging and counts.projects for the month-wide project total. Same-order projects from distinct rounds retain their distinct keys within one card.
- Regression verifies 26 projects across two rounds stay together while 20 other orders paginate separately, preserving all 46 projects. npm run check passed with 960 tests passing, 30 environment-dependent skips and zero failures, plus typecheck/build and git diff --check. Existing chart/PDF bundle warnings remain. Mobile browser verified DUMMY-MP-05 appears once with both completed projects, a prominent number, and the overall total still shows 2 projects. Log is /tmp/completed-project-group-check.log.

## Technician priority category and assignment dates — 2026-11-05

- 我的维修 now defaults to the first 待处理 category, containing personal 维修中 and 回审 only. Keep 进行中 unchanged (待开工/维修中/暂停), and classify multi-worker tasks using personalRepairStage before matching. Filtering and badge counting run on the server before pagination.
- 派工日期 uses independent assignedFrom/assignedTo filters against assignedAt; do not reuse from/to, which represent completion dates elsewhere. Dates include the entire selected Shanghai calendar day, allow open bounds, and exclude missing assignment dates only while a range is active. Search and category switching preserve the selected assignment dates.
- Added regressions for personal priority membership/counts, assignment day boundaries, open/empty ranges, invalid dates and completed orders whose completion month differs. npm run check passed, including TypeScript/build; existing large-bundle warnings remain. Browser verified default 待处理 (19 local tasks, including 回审), the mobile tab layout and opening/closing the date drawer. IAB automation did not successfully populate native date inputs; actual picker selection remains a device/manual check, while server range behavior is covered by tests. No deployment or push.

## Larger technician categories — 2026-11-05

- Enlarged category text to 18 px, counts to 17 px and hit areas to 60 px high. Mobile uses three equal columns (two below 361 px); desktop uses six. All six categories stay visible without horizontal scrolling. Selected state uses blue fill/outline as well as text color.
- Ant Segmented items retain content widths inside CSS grid unless width:100% is explicit; verified equal approximately 124 × 60 px targets in the current mobile browser. Keep technician-scoped selectors stronger than dispatch.css mobile overrides. Search's extra 全部 category wraps naturally.
- TypeScript/build passed; git diff --check passed. Browser visually checked all six enlarged categories and measured equal target sizes. Existing large-bundle warnings remain. No deployment or push.
- Follow-up preference: reduced categories to 46 px high, 16 px labels and 15 px counts. Added stable key-based pastel colors (blue/amber/teal/purple/coral/green); selected outline matches category color and keyboard focus remains visible. Keep labels and outlines so color is not the sole indicator. Mobile browser visual check and TypeScript/build passed; existing bundle warnings unchanged.
- 待处理 now partitions filtered tasks into 回审 then 维修中 before server pagination, preserving existing order within each group and leaving other categories unchanged. Use personalRepairStage for personal queries. Linear partition adds no database queries. Targeted filter/count/workload tests passed (13), including a review task originally beyond page one, stable within-group order and no input mutation; git diff --check passed.
- 派工日期 now provides workbench-style 全部/今天/昨天/近7天/自定义 shortcuts. Seven days includes today and the preceding six Shanghai calendar days; selecting 全部 clears both date bounds. Custom range drawer remains available and other filters are preserved. TypeScript/build, Shanghai midnight/month-boundary checks and git diff --check passed. Mobile browser verified 近7天 narrows 待处理 from 19 to 2 with matching counts. Existing bundle warnings remain; no deployment or push.
- Updated user requirement: 待处理 includes 回审 plus all 进行中 states (待开工/维修中/暂停). Stable pre-pagination priority is 回审 → 返工 → 其他. Rework classification matches card badges: repairRound with roundKind other than additional, or legacy rework flag without a round; additional repair is not rework. Personal pauses are included, own completed/inspection work remains excluded. Targeted personal/count/workload suite passed all 14 tests, covering group order, membership, counts and pagination. No deployment or push.
- Completed-project total now identifies user.name + selected YYYY年M月 + 已完工项目. The label wraps on narrow screens while the total stays intact. TypeScript and diff checks passed; mobile browser verified 李富强 · 2026年11月 · 已完工项目 with 2 项.

## Technician list sort — 2026-11-05

- 我的维修 now defaults to assignedAt ascending; the sort control belongs inside the date/filter panel (not beside the separate refresh button). Supports assignedAt and dueAt in both directions. Search, date changes and category switches preserve sort; restoring default category after clearing search must merge filters rather than discard date/sort.
- Apply sorting in queryDispatchTasks before pagination, separate from count calculation. Only personal lists change their default; existing management/warehouse defaults remain. 待处理 retains 回审 → 返工 → 其他 ahead of chosen time ordering. Missing/invalid timestamps remain last in both directions; ties preserve prior stable order. No new DB queries; one timestamp parse per filtered task and an in-memory sort.
- npm run check passed: 966 passed, 30 skipped, zero failures plus TypeScript/build. Regression checks cover all four sorts, missing timestamps, urgent not overriding assignment time, unchanged non-personal defaults, input immutability, grouping and page-one priority. Subsequent filter-panel placement build and diff checks passed. Mobile browser verified dropdown choices and switching assignment direction, then restored earliest first. Existing bundle warnings remain. No deployment or push.

## Completed-project filters — 2026-11-05

- Added 所选月份/今天/昨天/近7天/自定义 completion-date shortcuts and completion-time ascending/descending sorting inside the reconciliation filter panel. Month selection clears date bounds while retaining sort. Explicit date ranges override month so cross-month weeks are not truncated; summary shows the actual active range and filtered project count.
- Filter and sort personal completed projects before order grouping and pagination. Preserve shop/owner checks and round deduplication; completed dates use the existing per-item fallback rules. Missing explicit dates retain monthly endpoint behavior. Shared CompletedProjectFilters carries range/sort fields.
- npm run check passed (966 passes, 30 skips), then all 10 completed-project domain tests passed including new inclusive Shanghai-day bounds, open ranges, sorting/group order and invalid inputs. Mobile browser verified filter layout and monthly total. Existing bundle warnings remain; no deployment or push.

## Completion filter reset and technician deferred badge — 2026-11-05

- URLSearchParams stringifies explicit undefined fields as "undefined". Returning from date shortcuts to 所选月份 and open-ended custom ranges triggered 日期无效. Omit empty/undefined request parameters at dispatchApi.myCompletedProjects. Two actual API-serialization regressions failed before the fix and passed afterward; all 12 API/domain cases pass. TypeScript/build and diff checks passed. On request failure show — rather than a misleading zero project total.
- Removed the technician card's 待定 count: inspectionDeferredCount deliberately includes both pending and scheduled inspection-deferred entries for inspector tracking. Scheduled items already appear as normal repair work for technicians, so the aggregate badge was misleading. Preserve inspection workflows and tracking data.

## Detailed technician categories — 2026-11-05

- Replaced the technician 进行中 tab with 待开工/维修中/暂停 and added 返工, retaining 待处理/待接单/待检验/回审/已完成 in a three-column grid. Existing backend 进行中 API semantics stay available. Badges use server personal-stage counts under current filters.
- 返工 is an overlapping active-work filter: legacy rework or non-additional repair round, in 待接单/待开工/维修中/暂停/待检验/回审. Exclude personally completed work and additional repairs; keep its ordinary stage tab membership. Default 待处理 grouping/order is unchanged.
- npm run check passed: 970 passes, 30 skips, no failures plus TypeScript/build; git diff --check passed. Regressions cover stages, rework/additional/complete boundaries, personal pause and search counts. Mobile browser shows 7 waiting, 18 working, 2 paused and 5 rework in the current local fixture. Existing bundle warnings remain; no deployment or push.

## Current-code review findings — 2026-11-05

- Review only: no business-code changes. npm run check passed (970 passes, 30 skips, zero failures, TypeScript/build); environment-dependent database suites were not enabled. Two pure-memory reproductions using actual applyDispatchAction inspection transitions confirmed missing coverage: (1) rejected additional round retains roundKind=additional and rework=true but is excluded from 返工 and its priority; (2) A-only rejection marks unrelated working B as personal rework because filters retain whole-task flags. Future fixes should share a personal rework predicate across filters/counts/sorting and retain the user's reverted decision: rework may still overlap ordinary status tabs.
- Nonblocking performance cleanup: completed-project detail creates a full dispatch controller with hidden list and unused myCounts requests/30-second refresh. No timing benchmark performed. Report: docs/current-code-review-2026-11-05.html. answer-me-with-html skill was not found; generated standalone HTML instead. No deployment or push.

## Multi-worker follow-up review — 2026-11-05

- Review only; no business-code changes. User clarified that multi-worker repair has no whole-order primary technician. Treat members equally and keep individual project/progress/material scopes; do not interpret technicianIds[0] or the legacy technicianId field as elevated authority. The reviewed permission paths do not grant the first member extra rights. Whole-order DispatchSheetSummary and WarehouseVehicleInfo still label the team “主修人”; record this as stale terminology rather than a demonstrated permission defect.
- Three new issues reproduced with actual domain functions and pure-memory fixtures: (1) selective and whole-order reassignment retain the old worker's unprepared personal parts request, but the new worker's start/submission gate finds no matching request and can bypass the outstanding material requirement; (2) personalRepairStage returns whole-order 回审 before checking own submitted/completed items, so A remains in 待处理/回审 even after personal submission or inspection while B still reviews; (3) cancelInspectionDeferred removes a worker who lost their last item but leaves workerPauses, causing a later new assignment to that worker to inherit the obsolete pause. Existing normal reassign/edit paths already prune departed workers' pauses.
- Do not describe the first issue as a warehouse deadlock: while the task is active, warehouse staff can still prepare the former worker's request and designate the new recipient. Do not fix it by making every coworker's request block everyone. The review-status issue affects 我的维修 categories/counts/display; it does not prove completed-project reconciliation data is missing. Preserve whole-task workflow stages when correcting personal display projections.
- Verification: 17 related test files passed all 163 cases with no failures/skips; log /tmp/multiworker-review-existing-tests.log. Additional scripts /tmp/multiworker-parts-reassignment-review.mjs, /tmp/multiworker-review-status-repro.mjs and /tmp/multiworker-cancel-pause-repro.mjs reproduced the new gaps; corresponding .log files contain results. No database integration, browser/device check, full build, production access, external message, deployment or push in this pass. Report: docs/multiworker-followup-review-2026-11-05.html. Prior two rework classification findings remain open and were not counted again.

## Completed-project inspection principle review — 2026-11-05

- User reiterated the central rule: personal projects completed AND passed inspection within the selected/current month. Use the individual inspection-pass date in Shanghai time, independent of whole-order completion, coworkers' unfinished projects, current roster membership or any supposed primary technician. Previously authorized explicit date ranges still override the selected month; do not treat the existence of historical/custom queries as a new defect.
- Review only, no business-code changes. Confirmed one new mismatch with the strict inspection rule: internal A submits (待检验), the mixed team is reassigned to outsourced, and complete-outsourced turns A's still-owned project into 已完工 without inspectedAt/inspectedBy. technicianCompletedProjects accepts its outsourced finishAt and counts it for A. Reproduced using actual domain transitions and actual repository SQL with transaction-local temporary tables. Old tests explicitly allow outsourced completion, so their passing results do not satisfy this newly emphasized rule. Do not blanket-exclude outsourced orders: personally inspected projects from before the conversion must remain eligible. Preserve justified legacy internal inspection completion fallbacks rather than blindly requiring inspectedAt for every historical row.
- Verified normal A-passed/B-working, A-returned/B-passed, inspection-deferred, and review-A-repassed/B-working behavior. The previous personal 回审 tab defect does not prevent correct completed-project reconciliation. Real transitions across Shanghai month boundaries show October submission/November inspection belongs to November, November submission/December inspection belongs to December, and an earlier A inspection date stays in November when B completes the whole order in December. Month-end millisecond bounds, non-first roster membership, departed owners, historical round deduplication, grouped pagination and client response-generation guards also checked.
- Verification: 21 domain/API/pagination tests passed, plus both local PostgreSQL integration tests (completed snapshots and repair rounds), zero failures/skips in the successful runs. Local network access first returned sandbox EPERM; approved execution then passed. The snapshot fixtures used rolled-back temporary tables; the rounds suite created and automatically dropped its own database. Disabled real Runfeng writes and used mock notification sending. Logs: /tmp/completed-principle-unit.log, /tmp/completed-principle-integration.log; extra reproductions: /tmp/completed-project-inspection-lifecycle-repro.mjs, /tmp/completed-project-inspection-sql-repro.mjs, /tmp/completed-project-month-boundary-review.mjs and /tmp/completed-project-owner-round-review.mjs. Report: docs/completed-inspection-principle-review-2026-11-05.html. No existing business records, production data, external messages, deployment or push; no full rebuild/browser-device validation in this review-only pass.

## Personal review/working category — 2026-11-05

- Replaced the technician UI default 待处理 entry with 回审&维修中. The new server filter and count accept only personal 回审 or 维修中, excluding personal pauses and unstarted/submitted/completed work. Retained the older 待处理 query for existing callers. Review-first sorting applies to the new filter as well. The long label and count stack to fit mobile columns.
- npm run check passed (971 passed, 30 environment-dependent skips, zero failures). After the sort adjustment, all 12 focused personal-filter/sort tests passed. Browser verified the selected new category displays 19 = 1 review + 18 working. git diff --check passed.

## Technician typography refinement — 2026-11-05

- Reduced personal status-category text from 16px to 14px and counts from 15px to 14px. The longer combined category uses 13px text. Enlarged only the task-card dispatch number from 12px to 16px with medium-bold weight, preserving the secondary label and fallback order-ID size. TypeScript and git diff --check passed; mobile browser verified the larger dispatch number in the task card.

## Three multi-worker review fixes — 2026-11-05

- User authorized fixing the three multi-worker findings. Added an explicit handover guard for selected/whole/inline project reassignment: unresolved personal material belonging to a changing project owner must be handled before internal reassignment. Since applications are per person and not mapped to project IDs, do not guess how to split or migrate requests. Warehouse staff may resolve an unprepared request (including changing it to none) without the absent applicant; prepared/issued evidence remains unchanged. Unrelated coworker assignments stay available. Outsourced workflows retain their existing all-request gates; switching back to internal also checks outstanding inherited personal requests so changing modes cannot bypass the guard. This deliberately blocks reassignment until the relevant request is resolved; it does not implement automatic material handover.
- Personal review display now recognizes own submitted/fully inspected items before returning 回审. Whole-task workflow stage stays 回审 until the team finishes; individual pauses and legacy unsubmitted work retain their prior behavior. The detail review instruction now uses the personal status, avoiding a misleading request to resubmit already handled work. Both legacy 待处理 and newer 回审&维修中 categories inherit the corrected projection.
- Cancelling an inspection-deferred item prunes pauses only for workers leaving the current roster, matching ordinary reassignment/edit behavior. Rejoining with a later new project no longer revives the removed pause; coworkers' pauses and pauses for workers with remaining projects are preserved.
- Added test/multiworkerReviewFixes.test.mjs: the initial six tests reproduced four failures before the fixes; final eight cases cover three reassignment entry points, partial/photo requests, warehouse resolution, mode switching, independent coworkers, review submission/inspection counts, cancellation and rejoining. Fixed a priority-test fixture that incorrectly used already-submitted personal review work as actionable review; it now uses unfinished review items.
- Final npm run check passed: 979 passing, 30 environment-dependent skips, zero failures, TypeScript/build passed. git diff --check passed. Log: /tmp/multiworker-fix-check.log; initial reproduction: /tmp/multiworker-fix-before.log. Existing large chart/PDF chunk warning remains. No deployment/push or existing business-data changes; no browser or enabled database integration run in this fix pass. The separately reviewed completed-project outsourced/no-inspection mismatch is outside these three fixes and remains open.

## 润丰车辆档案锁定 — 2026-11-06

- 开单的手输车牌和 VIN 原先只更新草稿。现在离开输入框时用当前两个标识查询，修改标识时作废旧请求。重新打开可编辑草稿也要重新匹配，否则档案锁会丢失。
- 润丰命中时，车型和所属单位连同编码以档案为准。档案缺项须在润丰补全；不能把 OCR 或上一辆车的值留在禁用的输入框。候选、新增及异步新增结果同样须遵守锁定状态。

## 同车多个润丰单位 — 2026-11-06

- 按车辆档案编号取第一条会漏掉同车已有单位。车型沿用匹配档案，所属单位按编码去重；同车牌有多个不同 VIN 时须核对 VIN，避免把其他车辆的单位混入名单。多单位新单默认待选，重新打开草稿只恢复仍在名单中的编码。
- 鲁B08S3Q 本地车牌手输及相册 OCR 均命中大众和三个单位，分别选中太保E养车与个人（保险）。两条路径均验证单位输入只读、没有新增入口、车型禁用。第一张合成车牌的 Q 被识别成 G，使用 Q 尾部清晰的新图重新走真实 OCR 后正确命中。测试未保存委托。

## 详情联系信息更正 — 2026-11-06

- 原弹窗允许更正四项。现在详情入口和 API 仅允许联系人、电话，SQL 只写这两项业务字段；旧客户端夹带车型或单位会收到 400。更新事件保留原快照和关联，新增 updatedFields 区分历史四项事件与新两项更正，润丰端需识别字段范围。

## 同车多个润丰车型 — 2026-11-06

- 润丰同车牌、同 VIN 也可能有不同车型编码。开单时车型与单位分别按编码去重。多车型新单需明确选择，重开草稿时只恢复仍在本车名单内的车型编码。
- 鲁B8WF70 的手输及相册车牌 OCR 均出现长安（CA）与铃木-天语（LMTY），新单默认待选。两条路径分别选中不同车型，自由输入均被阻止，均无新增车型入口，未保存委托。

- 新开单时联系人由调度手填。行驶证 OCR 的所有人、润丰历史单位、单位匹配和手选单位都只更新所属单位；回归时需同时检查空白联系人和已经手填的联系人。

## 润丰车牌原文确认

- 去掉内部空格、横线或间隔点只能用于查找候选。即使 OCR 字符串和某条档案完全相同，只要存在多个候选车牌原文，仍须先确认。确认时按原文限定车型和单位的来源。VIN 单查同样需要找出车牌写法不同的关联记录。
- 真实档案核对：鲁BQ6362 对应上汽、首汽（保险）；鲁B Q6362 对应大通、首汽租赁有限责任公司青岛分公司。

- 关闭车牌选择弹窗只收起候选，保留待确认状态和重新选择入口。新查询返回多条候选时要再次弹出。

## 派工号排序 — 2026-11-06

- 派工号有不同前缀、前导零和不同位数。各列表先按末尾连续数字比较，数字相同时再比较完整派工号；升降序均把空号放在最后。
- 工单 SQL 与内存排序需遵循同一规则。派工任务先筛选再排序分页，完工核对先排序再按工单分组分页；历史用料仍先取同名配件最近一次登记的型号，再对展示结果排序。

- 完工核对的日期快捷筛选可以跨月。页面提示统一使用“所选时间范围”。

## 移动端详情滚动

- 抽屉打开时只给文档设置 overflow 可能导致背景跳到顶部。按打开前的滚动位置固定背景，在详情加载期间也启用；嵌套详情全部关闭后再恢复列表位置。
- 工作台委托单详情是带缩放动画的 Modal。手机点开后立即上滑，动画中的正文可能接不到第一下手势；移动端取消详情缩放动画，并与背景滚动锁一起验证。

- 生产回拉按差异工作表的本单派工号去重，保留 B 前缀；旧单明细和最近旧派工号只作对照。A67666 两库车牌 U/V 不同，不按派工号强行回拉。编码在钉钉同步载荷里出现不等于由钉钉创建，清理字典须另核创建来源及业务引用。

## 历史维修项目阻塞检验提交

- 完工写回按项目 ID 合并历史轮次和当前轮次。报错项目可能只在历史轮次，当前检验弹窗显示的负责人不能用来补历史项目。排查时先区分历史项目缺负责人和已有关联人员但润丰编码或姓名缺失，这三种情况共用同一条错误提示。

- 原轮次外包、后续内部检验时，以历史轮次的 executionMode 识别外包。按本轮已完工项目生成 write-round 快照；先过滤外包行再走整单替换仍会删除润丰手工记录。内外单通过专用映射追踪本轮明细，仅凭名称、序号或跨轮复用的项目 ID 不能确定归属。部署前应用润丰映射表脚本，并停止旧版写回进程。

- Playwright 控制台日志会随页面轮询持续增长。已跟踪的日志需从 Git 索引移除，之后由 .gitignore 排除。

- 混合轮次写回复查：上线与回滚均需隔离旧 worker 和 write-round 任务。验收应覆盖旧内部任务延迟到外包后执行、同轮回审从已通过改待定、跨多轮后新增外单；首次检验和相同事件的重复投递不能覆盖这些路径。

- 修复后回滚服务应保留 PostgreSQL 队列迁移。回审待定只撤下已映射的本轮明细，润丰服务账号因此还需对 h5_repair_round_items 有 DELETE 权限。已建映射表可继续使用。晚建外单的回执包含外单表头标识，历史检验按项目最终状态补齐。

- 回审退回也可能撤销一次已写入的通过结果。撤下项目时用明细主键区分“已被人工删除”和“仍存在但已移单或计价”。补外单要考虑后来确认的人工处理，否则可能从较早的成功快照恢复已撤销的项目。

## 车牌容量与润丰拉取 — 2026-11-09

- 润丰 qxwxb.ch、qxclxxb.ch 容量为 10 字节。用户允许说明文字，只要求容量校验；字母数字及空格按 1 字节，常见汉字按 2 字节。前后端共用 vehiclePlateValidation，并在新建同步事件前再次校验旧草稿。
- 修正 processing 队列的载荷不会改变消费者已领取的旧快照。须等领取超时后的重新领取，不能把仍显示拉取中直接当成修正失败。L176867 修正后下一轮已成功生成 A67843。

## 润丰其他输入容量 — 2026-11-09

- 生产字段核对：cxb.mc 为 varchar(50)，qc 为 varchar(100)，新增车型同时写两列，应按 50 字节验收。已有车型按编码加空格加名称写入 qxwxb.cx/qxclxxb.cx，合计容量 100 字节，不能把新建简称限制套到已有车型名称。
- khxxb.mc 150、qxwxb/qxclxxb.lxdh 50、联系人 100、里程 20、服务顾问 20，均为字节容量。qxwxmxb.hh 为 200 字节，wxr 为 100 字节。前后端共用 legacyInputValidation，新建入队与联系人电话更正均校验；正常长度的说明文字可用。
- 故障描述和车辆地址的消费端实际落库列尚未确认，不能仅凭文档中的“备注/地址”擅自套字段长度。本次未给这两项增设推测限制。

## 部署检查的测试依赖遗漏 — 2026-11-09

- workOrderDomain.ts 新增共享模块 import 后，authSessionFollowupReview、authenticatedRole、orderFollowupReview 三组 VM 测试必须补齐显式依赖映射，映射到实际模块。否则生产部署 npm run check 会报 Unexpected import，定向业务测试通过也无法覆盖。
- 修正后完整 npm run check 通过：1024 项，994 通过、30 跳过、0 失败，类型检查和生产构建通过。本次仅修改测试依赖映射，无新增生产运行开销。

## 润丰拉取队列防阻塞 — 2026-11-09

- 新迁移 202611090001_legacy_sync_retry_fairness 保留消费端函数签名，新增 auto_attempt_count 与累计 attempt_count 分离。优先首次领取，失败或10分钟未回执后第一次后延后5分钟，本轮第2次失败后暂停，failed 的 available_at=infinity。
- 管理员核对润丰是否已建单并修正数据后，可用现有 retry_legacy_sync_event 恢复 failed；保留事件标识、载荷、版本、累计次数。本次无新增页面重试入口，同名消费者晚 ACK 的旧协议限制仍在。
- 升级时未成功事件按现有次数初始化，pending/failed 中已尝试至少2次的暂停，processing 等完成或超时。可领取部分索引配合首次领取排序，超时回收每批最多100条，避免无限重试占用轮询机会与长批次锁。
- 在本机临时隔离库执行全部迁移并验证7项集成检查通过，完整 npm run check 994通过/30跳过/0失败，生产构建通过。尚未应用生产迁移。
- 用户最终确认上限为2次：首次失败/超时后等5分钟，第二次失败/超时暂停。7项隔离集成测试通过。临时库清理在 pool.end() 后使用普通 DROP DATABASE，避免 WITH(FORCE) 抢先终止正在关闭的连接引发异步测试错误。

## 稳定性与性能三批优化 — 2026-11-09

- 用户明确要求暂避用车相关文件：另一聊天正在实现出车免审批和还车审核。本轮用车照片解码/压缩前移暂缓，未覆盖那组改动；并行工作区的用车迁移与界面不属于本轮优化成果。
- 第一批：个人返工统一到 `isReworkTask(task, ownerId)`，按本人未完工项目的退回证据和轮次判定；外包完工不能凭 finishAt 计为已检验。HTTP 增加取消、20/60/120 秒截止时间和不同错误类型，截止时间覆盖响应体读取。超时不附加伪业务状态、不自动重放；已有请求编号的业务保留原编号和内容。没有幂等协议的旧接口不能仅凭“网络超时”直接重复提交，应先核对记录。应用与懒加载功能区增加显式恢复边界，不自动刷新编辑页。
- 第二批：快捷派工/项目详情使用 detail 模式，不拉隐藏列表、负荷汇总或个人计数。列表合并定时、焦点和手动刷新，取消过期读取，移动端保留已加载分页。只有提交后的刷新强制废弃旧请求；把所有刷新都传 `true` 会破坏合并。数据库只下推公共候选条件，不提前 LIMIT，保留 counts=true、负荷例外、人员 null/空数组区别。项目保存批量 UPSERT，鉴权会话与当前用户合并查询；钉钉 token 合并并发，免登请求 10 秒超时，岗位仍实时校验。
- 归档 `view=summary` 使用独立类型、显式 SQL 字段，不查询签字 token 或 hydrate 历史子表；编辑、签字、打印先取完整详情。新增 1000 条审计记录后摘要响应字节不变。保存成功立即保留返回工单，防止随后刷新失败导致下一次重新创建。
- 第三批：归档桌面表格及交互模块、供应商报告按需加载；页面按当前导航启用请求。缩略图临近视区才请求，预览组最多三个完整图片源，关闭/删除/身份变化释放，仍用 data URL 兼容钉钉原生图片动作。连接等待 5 秒、交互事务锁等待 3 秒和 SQL 15 秒；润丰 worker 豁免交互超时，回滚失败保留原始异常。新增模板化请求耗时和每分钟关键队列/连接池指标；停止领取先于排空，应用/PM2 宽限 60/70 秒。
- `npm run check` 包含包体预算；最终普通检查 1037 项：1006 通过、31 环境依赖跳过、0 失败，类型检查及生产构建通过。独立 `check:release` 必须显式指定专用本地 RELEASE_TEST_ADMIN_URL；28 组 PostgreSQL 套件共 196 项全部通过、零跳过。测试使用临时 PostgreSQL 17 容器，不读取生产连接或发送真实通知。
- 构建 gzip（字节，含静态依赖）：工作台含移动归档 520762 → 412337；签字 218711 → 222367；供应商 380080 → 282020。分别通过 450000 / 225273 / 391483 预算。字体、照片、API 与后续交互不计入此估算，技师入口另报 526440 字节，不能将此报告当线上网络实测。
- 1千/1万/5万单分别执行 13 个角色/查询对照，包含仓库申请标识，有序结果和计数一致；相同有序结果经相同分页函数得到相同页面。交替配对测量中，5万单个人筛选 P50 918→384 ms、P95 968→426 ms；无筛选 P50 943→937 ms、P95 964→966 ms。候选行 47369→4543，结果字节一致。测试进程 RSS 约 352 MB，包含夹具和比较快照，不能代表生产 RSS。
- 请求计时开销专项（1万单）P50 基本持平；无筛选 P95 163→217 ms、个人筛选 41→42 ms。样本波动明显，**监测总开销 ≤3% 尚未验收通过**；后台队列扫描亦需目标部署环境持续测量，不能据 P50 宣称达标。
- Chrome 定向检查已覆盖 360/390 px 和桌面、长文字换行与卡片间距、摘要到详情、快捷派工无隐藏请求、动态模块下载失败后点击恢复。截图在 `output/playwright/optimization/`。不要同时构建和跑静态产物 UI：Vite 清空 dist 会让正在下载的旧哈希模块失败。旧完整 DISPATCH_UI_TEST 曾停在“清空 VIN 后打开缺失行驶证弹窗”的历史步骤，不计为全流程通过；本轮定向开关为 DISPATCH_OPTIMIZATION_UI_TEST。
- 数据库套件揭露旧测试仍假设润丰失败后立即重领：当前规则第一次租约超时转 pending 并延迟 5 分钟；retry_legacy_sync_event 仅接受 failed，pending 测试须推进 available_at。权限测试的“无关技师”不得与顾问同名，否则会命中历史姓名归属。
- 真实钉钉拍照、长按图片、弱网恢复，以及真实 OSS 故障/SQL Server 写回/PM2 停机仍需设备和目标环境验收；慢 OSS 持锁及失败孤立对象未纳入本轮改造。未推送、未部署、未应用生产迁移。

## 本地监测与剩余验收复查 — 2026-11-09

- 原 12 个样本的 P95 等于最大值，不能据 163→217 ms 的单一极值认定监测成本。扩大到 120 对样本、10 对预热并取消逐请求强制 GC：无筛选 P95 144.84→143.86 ms，个人筛选 36.47→37.15 ms（+1.85%）。前台本地样本通过 3% 目标；直接包装成本 P95 0.198/0.067 ms。
- 四个关键队列各 5 万条 pending，实际 worker SQL 一轮扫描 P95 49.38 ms（20 个样本）。约占 60 秒周期的 0.082% 墙钟时间，不能冒充 CPU 使用率或与前台开销相加。生产总预算仍须目标负载观测；数据见 output/optimization-local-acceptance.json。
- 数据库故障测试新增真正耗尽连接池等待 5 秒，以及 pg_sleep(20) 被 15 秒 statement_timeout 取消，再验证连接可复用；28 组发布套件 196 项通过、零跳过。钉钉 mock fetch 真正等待 10 秒后取消，两名调用者共享一次请求、无重放。监测查询失败可在下一轮恢复，日志只输出错误码。
- 将停机排空提取为 drainServer，共用生产调用与测试。验证所有 stop 先于排空，HTTP 与 worker 都结束后才关连接池。真实本地 HTTP 慢响应完整返回，随后相同端口重启成功。隔离 PM2_HOME 的真实 PM2 发布切换及不健康启动回滚测试通过；未接触正在运行的应用。
- 完整旧 UI 脚本须等待 VIN 失焦查询稳定后点击备案；车辆身份 key 变化会重建对应表单。状态 tab 的可访问名称包含数量，须按名称前缀匹配；已完成列表超过一页，不能假设指定工单始终在第一页，先搜索定位后验证状态。
- 最终完整 Chrome 流程 47 项通过（约 89 秒），此前行驶证步骤未通过的记录已关闭；含桌面与移动派工、接单、维修、检验、返工、行驶证历史及项目编辑。最终 npm run check：1042 项，1010 通过、32 环境依赖跳过、0 失败；类型检查、构建与预算检查通过。新增真实 HTTP 测试通过 DEPLOYMENT_PM2_TEST=true 显式启用，已独立运行通过。
- 临时 PostgreSQL 容器已停止并自动移除；隔离 PM2 测试自行清理其 PM2_HOME。保持用车相关文件暂避要求，未推送、未部署。真实钉钉、真实 OSS/SQL Server 与生产整体监测成本仍不能用这些本地通过项代替。

## 钉钉角色与人员查询减量 — 2026-11-09

- 用户授权合并重复请求、按需加载，并明确恢复车辆申请文件的可修改范围；继续要求提交时实时权限校验、先不部署。本轮未覆盖另一聊天已有的用车流程改动。用车名单读取本身不调用钉钉角色接口，其通知岗位校验继续实时执行。
- 截图 11 月 5 日的六项接口合计 7020 次，其中 role/list 2757、role/simplelist 2795，合计 5552（约 79.1%）；11 月 8 日为 1579/2517（约 62.7%）。这些是所示日期和接口的调用数，不能当作全部月用量，也不能断言全部计入付费额度。
- 派工选人名单仅在打开详情、重新打开或手动刷新时请求；列表及详情的 30 秒定时/焦点刷新不再取名单。负荷汇总仍按原频率刷新，但依赖仅保留其使用的日期范围，状态、搜索、排序不再触发无关汇总。打开详情需等名单请求结束后初始化编辑器，防止默认选人读取空数组；慢响应在关闭/切换后不得恢复旧名单。
- 浏览器按用户合并在途名单请求，服务端 `readDispatchPeople` 按店合并在途只读请求，供名单、维修工汇总及负荷图使用。成功/失败立即移除，不保留完成结果、不增加 TTL 缓存。提交、预派工及待定项目操作仍直接使用 `dispatchPeople(actor, client)`，不得改接只读合并入口；已验证旧 GET 未完成时，独立提交检查仍能观察岗位撤销。
- 检验/派工通知保留各自的实时角色同步，再读取本店人员；去掉与收件人资格无关的第二次维修工岗位查询。`canInspect` 的同店、启用、参与人和禁止自检判定不变。钉钉角色目录出现重复 ID 时只读取一次该角色成员；分页完整性与失败拒绝继续生效。
- 新增前后端请求回归：在途合并、不同用户/店隔离、成功/失败后重查、提交不复用旧 GET、列表零名单请求、无关筛选不重复汇总、详情焦点刷新不取名单、关闭后忽略迟到响应及失败重试。Ant Design 两字按钮的可访问名称可能含空格，UI 测试用 `/^重\s*试$/`；最初精确“重试”匹配失败已修正并重跑通过。
- 最终 `npm run check`：1050 项，1018 通过、32 环境依赖跳过、0 失败；类型检查、生产构建、包体预算通过。隔离 PostgreSQL 发布检查 28 组/196 项通过、零跳过。完整派工/维修/检验 UI 子测试通过；修正定位后的 Chrome 定向及派工集成 47 项全部通过，覆盖 360/390/1440 px、长错误换行、面板内边距、显式重试及焦点事件请求数。截图在 `output/playwright/optimization/`。
- 本轮工作台 gzip 412421 字节（上轮 412337，增加 84），签字 222366、供应商 282021，均在预算内。请求次数测试不等于线上付费额度降幅；未调用真实钉钉、未推送、未部署。测试容器 `codex-repair-roles-test` 使用独立本地端口 55439，现已停止并自动删除。

## 查询优化发布前复审 — 2026-11-09

- 用户随后明确授权复查无阻塞问题后部署。发现并修正两个恢复边界：浏览器名单合并键加入当前登录 token，避免同账号重新登录复用旧会话在途请求；控制器 effect 清理同时清除对应在途映射，避免 StrictMode 的重复挂载等待已被 generation 废弃的请求。新增同账号换会话及 effect 重放测试通过。token 只用于内存键，不写日志或持久化。
- 提交/预派工/待定处理仍直接调用事务内 `dispatchPeople`，GET 合并入口未进入写路径；每次 HTTP 认证继续读取当前会话及员工状态。通知收件人的岗位实时同步、同店、停用和禁止自检判定未弱化。未发现本次改动引入的权限绕过；不将其表述为对整个系统的无漏洞保证。
- 当前生产 `xinyu_new` 的 xinyu-h5 版本为 `2026-11-09T10-24-33-531Z-0b0e93e7`，777 个已核对源码文件与 Git HEAD 一致。独立候选 `/private/tmp/repair-reviewed-release-20261109` 包含本聊天优化，排除另一聊天的出车免审批/还车审核、工作台入口关联变化及迁移 `202611090002`；主工作区那组改动完整保留。混合文件 `shared/types.ts`、WorkbenchPage 仅在候选中剔除用车部分。`operationsFollowupReview.test.mjs` 也属于用车流程测试，必须配套保留线上版本，不能只按文件名 vehicleTrip 排除。
- 实际候选 `npm run check`：1018 通过、32 环境依赖跳过；28 组隔离 PostgreSQL 发布检查 196 通过、零跳过；完整及定向 Chrome 48 通过、零跳过。工作台 gzip 412389 字节，低于 450000 预算。无新增迁移、无真实钉钉测试调用。
- 发布包 `/tmp/repair-reviewed-20261109.tgz` SHA-256：`4d7d497b34e3b3013d905a461fe5dd824229bd9e4f434ca9931e0590cf5f3757`；文件摘要及范围记录在 `output/role-query-release-manifest.json`。服务器临时目录 `C:\temp\codex-role-review-20261109-2226`；发布前核对包摘要及旧版本标识，调用既有独立版本部署脚本，服务器再执行 npm run check，准备期间旧版运行，失败可回退。上线结果须另行补记。

## 查询优化上线核验 — 2026-11-09 22:43（北京时间）

- 已部署至 `xinyu_new` 的 `xinyu-h5`，当前版本 `2026-11-09T14-28-02-820Z-51eaa1b3`，前端版本 `70ad27d2-89bb-4118-b7b6-f076b8845ea3`。服务器 npm ci 约245秒、全量测试约234秒；测试、类型、构建、包体预算、PostgreSQL迁移核对及润丰连接检查通过。迁移全部 already applied，没有引入另一聊天的车辆迁移。
- 公开入口健康200，版本响应头正确；未登录 `/api/dispatch/people` 为401；新前端入口脚本和上一版哈希脚本均200。797个复制的源文件摘要全部匹配；打包的通用 `ecosystem.config.cjs` 本来不由准备脚本复制，应核验生成的 `ecosystem.release.config.cjs`，其 releaseId 和70000ms终止宽限正确。根dist指向当前版本，上一版 `2026-11-09T10-24-33-531Z-0b0e93e7` 保留可回退，PM2配置已再次保存。
- 内层日志明确 `Deployment succeeded` 且旧版本清理完成，保留了无法识别的 `config-backups` 目录；本次外层嵌套PowerShell/SSH仍返回1。不要仅凭外层返回值反复重启健康服务，应先核对内层结果。已独立完成全部上线核验并以0退出，详情在服务器临时目录 `verified.json` 及本地 `output/role-query-release-manifest.json`。以后优先沿用部署文档的 cmd 合并原生命令输出流程，避免嵌套PowerShell警告处理导致结果歧义。
- 上线后观察到5次每分钟运行指标采样，新增错误日志0字节、进程重启0次、CPU瞬时0.4%、RSS约73.3MiB；启动前RSS约85.1MiB。少量健康探测预热后中位数约7.79→9.00ms，时间与负载不同，不能用于宣称业务性能或线上总监测开销达标；本地既有监测开销验收与包体预算仍是本轮性能依据。
- 未推送Git，主工作区另一聊天的车辆改动完整保留且未发布。本轮隔离数据库容器已停止删除。原发布包与文件清单保留以便审计；真实钉钉设备行为及实际月额度降幅仍需使用后观察。

## OpenAPI 第二轮减量（本地完成，未部署）— 2026-11-09

- 临期提醒原来每个候选工单都执行 `dispatchPeople`，包括钉钉维修工角色读取。现在同一事务批次内每店实时读取一次，仅复用于该批最多100张候选单；事务完成/回滚即丢弃，下一轮重新查询。业务窗口、轮次、提醒去重、跳过已提交人员以及发送前任务/人员校验保持不变。100张同店单的专项夹具验证名单读取100→1；两店100单为2次。空批、无有效窗口不取名单，撤权后的下一批不复用旧结果。
- 新增 `server/integrations/dingtalk/pendingRead.mjs`，仅供通知收件人发现显式启用。按 fetch 实现、access token、接口和请求体合并重叠的角色目录页、成员页和员工详情读取；完成或失败即删除，没有TTL结果缓存、额外定时器或新数据库结构。凭据仅作内存隔离键，不记录日志。经理岗位解析复用统一分页实现，检验、调度、经理岗位仍分别执行本店/在职/角色筛选与原有数据库更新。
- `listDingTalkRoleMembers`、`getDingTalkUserProfile` 默认 `coalesce=false`；免登员工详情及提交时的维修工校验继续独立发请求，不能把通知优化选项设为全局默认。已测试通知旧读取未完成时提交仍可看到撤权，不同凭据/员工/传输不串用，归一化的员工对象互不共享可变数组，失败和异常JSON后可重新查询。
- 两页角色目录、管理员与顾问岗位重叠的专项夹具：OpenAPI 7→4次，结果一致；同店并发经理收件人发现也验证目录/成员只各调用一次。这是特定重叠场景的请求数，不是月付费额度降幅；非重叠任务仍逐次读取。通知发送及结果确认接口没有改动，不引入自动重发。
- 完整 `npm run check`：1060项，1028通过、32环境依赖跳过、0失败；类型检查、构建、包体预算通过。独立PostgreSQL发布检查28组、196项通过、零跳过，含临期提醒并发与窗口去重。新增专项9项通过。此次只有服务端和测试改动，无新UI，未重复浏览器验收；未调用真实钉钉、未部署、未推送。线上仍是上一轮 `51eaa1b3`。临时容器 `codex-openapi-round2-test` 验收后清理。

## OpenAPI 第三轮：失效检验通知提前判断（本地完成，未部署）— 2026-11-09

- 检验通知原先先同步钉钉名单，再判定任务是否已完工、被领取或被新通知替代；即使已无须通知，仍消耗角色/人员接口，且通讯录故障会阻止旧任务清理。现将原有门店读取替换为任务、最新检验事件及租约快照，无效快照不调用远程名单。事务中仍按父工单→通知租约顺序锁定并再次检查，只有最新有效任务才产生通知；普通编辑事件不会错误替代检验通知。
- 快照只是减量提示，不能作为最终授权：任务可能在快照后解除领取而恢复有效。此时先结束短事务，在锁外实时查名单，再重新进入事务核对；不得因为第一遍跳过同步而退回本地名单。已覆盖同步期间被领取、租约被抢占、门店变化、名单为空/异常/失败；错误只按当前租约更新重试状态，禁止越权入队。提交时岗位校验与发送前收件人复核不变，没有TTL缓存或消息自动重发改动。
- 新增15项专项测试全部通过：已完成/已领取/外包/需人工核对/无待检项目/新事件替代的任务，远程名单同步均为0次。正常有效任务同步1次、事务1次，单收件人夹具的数据库语句仍为10次；快照增加事件和租约元数据读取成本，并非所有SQL工作量完全不变。真实PostgreSQL验证旧任务跳过同步，当前任务仍查询；名单不可用也能清理已领取通知。上述为受控调用计数，不能推算线上月额度降幅。
- 最终 `npm run check`：1075项，1043通过、32环境依赖跳过、0失败；类型检查、生产构建及包体预算通过。独立PostgreSQL发布检查28组、197项通过、零跳过；另行派工集成47项通过。日志位于 `/tmp/repair-openapi-round3-check.log`、`/tmp/repair-openapi-round3-release.log` 和 `/tmp/repair-openapi-round3-dispatch.log`。无UI改动、无新增迁移、无真实钉钉调用；第二、三轮均未部署或推送，线上版本仍为 `51eaa1b3`。验收后清理专用容器 `codex-openapi-round3-test`。

## OpenAPI 第二、三轮发布复审 — 2026-11-09

- 用户明确授权复审通过后部署。逐项复核通知在途合并、临期提醒批次复用、失效检验任务快照；提交与免登不参与通知合并，凭据/传输/接口/请求体隔离，完成及失败即移除。收件人仍检查同店、启用、岗位和维修参与情况；队列仍核对当前租约、最新检验事件及最终任务状态，发送结果不确定时不自动重发。
- 复审补上员工详情的既有失败边界：HTTP 200 但响应损坏、缺少成功码/员工对象或返回其他 userid 时，原实现可能归一化为空员工资料。现在明确失败，不进入人员更新；并发等待者一起失败且后续可以重新请求。新增专项覆盖损坏JSON、缺失字段、错误身份和清理后重试；未增加远程调用、定时器或缓存。
- 发布候选 `/private/tmp/repair-openapi23-release-20261109` 以已部署首轮的798文件清单为基础，仅覆盖第二、三轮及复审修正的14个文件，合计802文件。生产797个复制的源码摘要与该基线完全相符；通用生态配置由发布脚本生成后单独验证。其他聊天的车辆流程、迁移202611090002及前端变动均未带入。
- 候选 `npm run check`：1043通过、32环境依赖跳过、0失败，类型/构建/包体通过；28组隔离PostgreSQL发布套件197通过、零跳过。无UI源码改动。性能夹具5000任务、5万事件、每单30项目、20预热+200对交替读取：旧门店读取P95 0.490ms、新快照含映射P95 0.808ms，绝对增加0.318ms；正常任务SQL往返不增加，失效任务远程名单读取为0。该微基准不代表线上请求总体P95或月付费下降比例。
- 制品 `/tmp/repair-openapi23-20261109.tgz` SHA-256 `bce693277854d8b60f7dbf7474ef4378d43e2bdd3af491673746642400ede16c`；清单 `output/openapi23-release-manifest.json`。服务器专用目录 `C:\temp\codex-openapi23-20261109`，以既有独立版本部署脚本执行，制品校验及当前版本保护通过才启动；采用文档中的cmd合并子进程输出，避免嵌套PowerShell警告误报失败。上线结果另记。

## OpenAPI 第二、三轮上线核验 — 2026-11-09 23:36（北京时间）

- 已部署至 `xinyu_new`，当前版本 `2026-11-09T15-24-08-819Z-f29c6191`，前端版本 `1a0b52a8-1687-4a40-9138-e44cdea32813`。服务器依赖安装、全量检查、类型、构建、包体、迁移核对和润丰连接检查均成功；无新迁移。部署最终返回0，旧版清理完成，无法识别的config-backups按既有规则保留。未推送Git。
- 独立验证801个已复制源码摘要全部匹配；生成运行配置的版本及70秒终止宽限正确，静态根目录指向新版，公开健康接口200且版本头正确，匿名人员接口401，新前端入口及上一版入口资源均200，PM2保存配置一致。上一版本 `2026-11-09T14-28-02-820Z-51eaa1b3` 留作回退；其他聊天的车辆改动完整保留在主工作区，未发布。
- 上线125秒时重启0、从部署前基线起新增错误日志0字节、CPU瞬时0.4%、RSS约72.1MiB（部署前约73.3MiB），最新连接池4连接全部空闲、等待0。健康探测20次预热后样本的P50约7.59→7.75ms、P95约11.66→11.73ms，样本小且负载不同，不作为业务总体P95或监测总开销达标证明。快照读取专项成本与调用次数验证见上述复审记录；月调用额度仍须实际使用后观察。
- 生产核验结果已写入 `output/openapi23-release-manifest.json`；本地验收日志为 `/tmp/repair-openapi23-candidate-check.log` 和 `/tmp/repair-openapi23-candidate-release.log`。临时隔离数据库容器 `codex-openapi23-review-test` 已停止删除；制品和专用服务器目录保留用于审计。

## 后续OpenAPI减量候选（只读排查，尚未实施）— 2026-11-09

- `useDispatchController.refresh` 对列表中的inspectionLead仍每30秒请求summaries，服务端technicianSummaries调用readDispatchPeople，可能触发钉钉维修工岗位查询；负荷看板自身expanded状态未反馈控制器。后续可按可见消费者启用，但必须保留高级筛选、已选人员标题、派工弹窗中的当前负荷等依赖，不能只判断图表是否展开。折叠栏现有人员数量也须明确处理，不能把未加载显示为0人。
- selectedId变化仍统一触发refreshPeople；纯查看工单或照片未必需要完整选人名单。可在实际选人流程启动时加载，但要覆盖派工/改派、指定检验员、项目负责人、配件领料人等消费者，并保持加载完成后初始化表单和迟到响应隔离。
- 已部署版本的用车通知resolveTripRecipients仍先syncManagerRoster，再由queueTripRecipients锁内检查tripNotificationCurrent。可参考检验通知提前快照判断，最终保留租约和状态复核；信息类历史通知不能一概按当前业务状态取消。主工作区车辆流程与线上不同，后续实施须明确基线。
- 此次只排查并记录，没有修改或发布业务代码。未给上述候选编造额外月额度降幅；需要区分面板展示、提交、通知发现等来源的聚合计数才能定量评估。

## 车牌候选选择时VIN冲突提示缺失 — 2026-11-10

- 用户报告鲁BFP121在带空格/不带空格候选中选不中，并提供手机录屏。只读核查润丰：带空格档案无VIN，无空格档案有17位VIN；录屏填入的VIN第11位为T，无空格档案为Y，其余位置一致。后端按既有规则返回conflict及明确原因，前端却因plateChoices分支跳过普通Alert，造成“点击无反应”的体验。不能把这两条原文档案直接去重，也不能为选中成功而绕过VIN校验或自动改写用户VIN；须由用户按行驶证/车架实物核对哪方准确。
- VehicleIdentityRecognition在候选弹窗内显示非初始选择提示的冲突原因，关闭弹窗后仍显示并保留重新选择入口；初始选择不重复标题。未修改后端选择规则、润丰数据、权限或接口调用数量。
- 新增对应空格档案无VIN/无空格档案有VIN的回归，验证错误VIN拒绝、正确或空VIN能选中原文；组件回归覆盖弹窗内及关闭后的提示和原文回传。35项定向测试通过。Codex内置浏览器360/390px模拟数据验证显示冲突、关闭后保留提示、更正VIN后成功回填，换行/面板内边距/按钮间距正常；Chrome连接不可用，未宣称真实钉钉设备修复验收。临时回归页面和5178测试服务已清理。
- 当前工作区存在另一聊天并行车辆流程改动，本次仅修改车牌提示组件、对应测试及本交接记录，不覆盖其他文件。修复尚未部署，完整检查结果另记。
- 完整 `npm run check` 通过：1079项中1047通过、32环境依赖跳过、0失败，类型检查、生产构建及包体预算通过；日志 `/tmp/repair-plate-choice-check.log`。本次没有数据库或权限实现变更，未额外执行隔离数据库发布套件，未推送或部署。


## 无维修照片审批（本地实现，未部署）— 2026-11-10

- 用户反馈部队/军工现场可能上交手机或封闭镜头，要求在维修照片区域申请免照片审批。用户明确审批人为本店管理员或服务顾问，禁止自批。新增申请、通过、驳回三个派工动作，原因必填（最多1000字）；使用现有 actions 接口、父工单锁、当前员工/岗位校验、版本冲突与 requestId 幂等机制。前端复用共享提交恢复逻辑，响应丢失时保留原请求内容和编号。
- 当前审批写入既有 dispatch_tasks.data，每位申请人仅保留当前申请；完整原因、申请/审批人、时间、决定记录于 dispatch_events，历史维修快照继续保留。不新增数据库表或改变 SQL schema，因此无需新迁移。审批仅替代进度/完工维修照片要求，签字、铭牌、配件、项目开工、独立检验及外包规则没有放宽。
- 审批范围按工单、门店、申请人、维修轮次、派工批次、执行方式、本人项目ID/名称/归属核对。提交时用实际提交人及修改后的项目再次检查，不能借用同事审批，也不能审批后追加项目顺便免照片。改派/项目变更保存时移除旧申请，恢复原值不会复活；回审清除原审批；检验退回仅移除涉及人员的审批，甲返工不撤销乙的有效审批。润丰刷新原维修数据时同时清除审批，避免项目改回旧值后复活。申请人撤权/停用不能获批，管理员或顾问仍可驳回其旧申请以清理待办。
- 照片区展示申请入口和结果，服务顾问/管理员可在派工台“无照片待审批”筛选中查看待处理单并通过/驳回；数量在完整候选集上计算，包含所有分页，排除本人的待审批申请。没有新增钉钉消息、定时器、名单轮询或额外后台 OpenAPI 读取；提交仍沿用原有实时岗位检查。审批动作只保存任务元数据及审计，不重写 repair_items。正常完工仍只执行既有一条照片查询，无新增数据库读取。
- 完整 npm run check：1092项，1058通过、34环境依赖跳过、0失败；类型、生产构建、包体预算通过。29组隔离PostgreSQL发布检查：205项通过、零跳过。工作台静态gzip估算412437字节，签字222359、供应商282014，预算通过；这些不是线上延迟测量。日志位于 /tmp/repair-photo-waiver-check.log、/tmp/repair-photo-waiver-release.log。
- 全量发布检查暴露两处此前隐藏的旧夹具问题：operationsFollowupReview 仍传 licensePhotos，现有服务已改为 departurePhotos；technicianCompletedProjects 临时 work_orders 表缺少实际查询所需 created_at 列。只对齐这两个测试夹具，未修改用车业务或统计实现。新增审批测试覆盖自批、跨店、撤权、并发决定、重复请求、无照片提交、单人/多人/外包归属、项目修改回滚和本人返工失效。
- 浏览器截图不能仅依赖 Playwright 的 visible 判定：Ant Design 入场动画起始时元素已存在但 opacity=0，直接截图甚至 animations=disabled 仍可能截到不可见帧。此轮改为等待弹窗 opacity=1 且实际宽度恢复后截图，未为测试假象修改产品层级。隔离库中铭牌附件是仅用于校验的占位记录，图片加载失败背景不代表生产图片回归；本轮不访问真实钉钉/OSS。
- 另一聊天的部署锁脚本、部署文档及交接改动均保留，未推送、未部署。

- 最终 Chrome 实际HTTP/隔离数据库验收：派工集成48项通过、零跳过，新增完整链路在360/390/1440px分别验证申请、长原因换行、驳回后重申、通过后零维修照片提交，以及确认完工时更改项目会禁用提交、恢复原项目后恢复可提交。截图 output/playwright/photo-waiver/，日志 /tmp/repair-photo-waiver-ui.log；尚未进行真实钉钉设备/现场网络验收。专项领域测试9项通过。验收专用容器 codex-photo-waiver-test 完成后清理。

## 无照片审批界面反馈 — 2026-11-10

- 完工确认弹窗的直接子级 Alert 增加上下16px间距、12px/16px内边距和长文字换行；派工台“无照片待审批”移到“未派工”后，检验视图保留在“全部未完成”后。
- 工作台待审批合并出车和无照片申请，按申请条数计数并排除本人，管理员/顾问均可看到照片审批分类；顾问不因此获得用车审批入口。点击分类复用 openTodo 进入对应筛选并保留返回工作台。复用 counts=true 的既有任务读取返回 photoApprovalCount，无新增轮询、数据库读取或OpenAPI调用。
- npm run check 通过：1058通过、34环境依赖跳过，类型、构建、包体预算通过。另增工作台汇总/顾问权限/未知数量与跳转测试，与照片审批领域共12项通过。内置浏览器实测工作台显示出车1+无照片0，跳转无照片筛选成功，标签顺序及窄屏布局正确；原维修弹窗标签已关闭，本次未在该原标签再次截图验证提示框。未部署。

## 无照片审批多人维修与返工复审 — 2026-11-10

- 复查发现审批定位风险：原审批ID直接使用客户端requestId，而派工事件幂等键包含actor_id，允许不同员工使用同一请求编号。审批按ID查找时可能选中另一员工的申请。现以工单ID、申请人ID、requestId生成确定性SHA-256编号；发现重复审批ID时拒绝决定，防止错误定位。同步调整申请事件快照查找方式，保留完整审计。未改变接口路径、权限或请求重试语义，无数据库结构变更。
- 新增真实领域动作回归：两人同号申请分别审批；项目从甲改派给丙再改回甲，旧审批不复活且乙审批保留；整单回审后分别重申；回审追加项目仅撤销接收人的审批。新增隔离PostgreSQL回归覆盖同号申请的保存/审计/独立提交，以及回审完成、新维修轮次清除审批、历史轮次保留审批记录。结合原有回归确认部分检验退回仅失效对应人员、提交时修改项目不能扩大豁免、自批/跨店/撤权/并发/幂等均有服务端约束。
- 跨轮次测试最初触发现有润丰员工绑定校验；补齐隔离测试员工编码、姓名、部门和绑定时间后通过，未绕开业务校验。员工编码字段最多5字符，夹具须使用合法短编码，不能直接复用较长的测试用户ID。
- npm run check：1098项，1064通过、34环境依赖跳过、0失败，类型检查、构建和包体预算通过。修正测试夹具后29组PostgreSQL发布检查207项全通过、零跳过；审批/工作台专项15项通过。日志 /tmp/photo-review-check.log、/tmp/photo-review-release.log、/tmp/photo-review-unit.log。工作台gzip估算412560字节；本次编号修复仅申请时做一次内存哈希，不新增SQL、OpenAPI或轮询，未做生产延迟实测。
- 本轮没有UI变更，沿用前轮浏览器验收；真实钉钉设备和现场网络仍未验收。未推送、未部署，保留另一聊天部署锁相关改动。

## 报价模版识别评估 — 2026-11-10

- 用户提供 Downloads/报价模版.xls，文件头确认是旧版 OLE/BIFF XLS，不能直接当 XLSX 读取。本次未提供记录表图片，无法验证识别准确率或字段映射。
- bundled Python 无 xlrd、项目 Node 无 xlsx；临时安装 xlrd 被网络 DNS 限制阻断。uv 默认缓存不在可写范围，临时安装需显式使用 /tmp 缓存。未修改原模板，尚未读出单元格。

## 报价模版字段核验 — 2026-11-10

- Desktop/报价模版.xlsx 已确认为有效 OOXML，读取 Sheet1 成功；此前 Downloads 同名文件只是旧 OLE 格式。只读评估未修改用户文件。
- 模版已有样例值：B5 车型、F5 车牌，C8:C10 维修项目，C14:C16 配件、D14:D16 数量，G21 日期；没有单位列。照片材料有四行，模版仅三行，批量导出需动态扩行并调整合计和打印布局。
- 模版车牌 HR20124 与照片先前暂读 HR2024 有差异，不能把模板样例当作照片识别真值；样例价格、内部编号和单位名称不得不经确认沿用。照片气门嘴第四行在样例模版中缺失，导出必须检测漏行。

## 八张 HEIC 批量样本 — 2026-11-10

- IMG_5018–5025 已通过获批的 macOS qlmanage -t -s 2000 转为 /tmp/quote-batch-preview 下 PNG，并逐张目视检查。此前 sips 生成无有效像素 JPEG，不能据此判定源 HEIC 损坏；Quick Look 需沙箱外运行。
- 八张版式一致，材料行数依次 8、6、6、5、6、9、3、1。5022 的三滤单位/数量留空，不可自动填1；油量备注中备用升数不可重复加到数量；维修区有赠送与救援等额外文字。相同车号不同日期不是重复照片。此次仅样本评估，未运行独立OCR脚本或生成报价单。

## 八份报价单生成 — 2026-11-10

- 用户要求直接生成、疑问/缺失标黄、内部编号5300递增。已输出 outputs/quote-batch-5300-5307 下8份XLSX及ZIP，按IMG_5018–5025对应5300–5307。保留工时/配件分区，增加单位和规格备注，动态明细；价格空白，金额公式仅输入齐全时显示。未猜填5022三滤缺失数量。
- 手写车号全部标黄待核；客户单位沿模板标黄确认。复核说明直接放在每份表底部，未另外生成清单。来源照片边注金额未转录为正式价格。此为目视转录的批次成果，不是已完成自动OCR程序。
- artifact-tool 日期Date对象在此环境写成字符串；改Excel数字日期并使用yyyy-mm-dd后渲染正确。自定义带中文前缀日期渲染为序号，应避免。全部8份已渲染检查，无公式错误；导出后用OOXML仅设置打印范围及A4适配，避免原模板打印范围截断扩行内容。未在Excel/WPS实际打印验收。


## 服务顾问工单全览详情权限修复 — 2026-11-10

- 根因：全览列表按本店展示所有工单，按需详情却复用仅管理员/本人经办可访问的写权限检查，打开其他顾问工单返回403。新增独立 assertWorkOrderReadAccess，仅详情读取允许同店顾问；原 assertWorkOrderAccess 及上传、修改、删除、签字、流程操作等调用保持原约束。仓库派工读取回退保留，详情继续移除非本人的签字会话令牌。不得直接扩大公共写权限函数来修复列表/详情不一致。
- 新增领域与隔离PostgreSQL回归，实际从全览summary读取到详情，验证同店顾问可读、本人令牌保留/他人令牌移除、非本人写入拒绝、跨店与无关角色拒绝、缺失工单404。专项16项全通过；npm run check共1111项，1076通过、35环境依赖跳过、0失败，类型、构建、包体预算通过。新增数据库测试已在专项带环境运行，零跳过。日志 /tmp/advisor-detail-tests.log、/tmp/advisor-detail-check.log。
- 无UI布局变更，未进行真实钉钉设备验收；无额外SQL/OpenAPI调用。保留其他聊天的采购文档及包依赖改动。未推送、未部署。

- 追加复查：核对全览详情实际还会请求overview，补测该后续请求成功且不返回签字令牌；附加附件预览可读、他人附件修改不可用、跨店拒绝回归。独立数据库测试通过，权限/签字/PDF既有边界28项通过。未扩大原生PDF导出既有权限，全览详情本身不显示该操作。
- 完整发布检查首次有一项既有派工返工写回次数断言失败（A67808 mixed inspection，预期4次实际3次；父测试一并计失败，总208项206通过2失败）。同一套件独立复跑47项全通过，随后整套30组PostgreSQL复跑208项全通过、零跳过。首次波动原因尚未确认，不得把复跑通过写成已经修复该波动；本次未修改返工写回业务或降低断言。日志 /tmp/advisor-detail-release.log、/tmp/advisor-dispatch-repeat.log、/tmp/advisor-detail-release-repeat.log、/tmp/advisor-detail-followup.log、/tmp/advisor-detail-boundaries.log。未部署，未做真实钉钉设备验证。

## 钉钉批量进货单（本地实现，未部署）— 2026-11-10

- 用户确认数据入口为上传 Excel/ZIP。新增独立“进货单生成”导航及 `/api/purchase-documents/{config,preview,generate}`，仅已启用且有门店的服务顾问/管理员（含多岗位）可用；复用现有鉴权，每次请求检查权限。文件只在请求及独立 worker 内存中处理，不落业务库、不改变采购/工单数据，无新增迁移。配置当前仅对本次页面会话生效，未实现门店持久化默认配置或在线模板上传编辑。
- 支持 XLS/XLSX/ZIP，价格原价/统一比例/区间浮动，指定同名配件固定单价或比例，整数/两位小数；默认原价。浮动由门店、去空格配件名、范围确定，同范围跨批次不变，不使用每次重新随机。金额用十进制整数分数运算做四舍五入，避免10.075等二进制误差。原价模式逐行核对原金额，差一分钱也阻止生成，不因其他配件有覆盖规则而跳过核验。
- 默认排除电瓶/机油/轮胎/原价<10/服务项，相关配件不按关键词误删；支持补充完整名称排除。可编辑车型映射、恒裕原组交替分海鑫源、漆料分单、日期沿用/留空/指定。先分车型再拆漆料，拆完普通单数量不再次均分。缺编码、无表头、异常数值、未知车型阻止生成；疑似重复保留并提示。仅支持已知配件表头结构，未引入大模型自动解释任意版式。
- 服务运行依赖为官方SheetJS 0.20.3（npm同名包仍旧）及ExcelJS 4.4.0；ExcelJS的uuid override到11.1.1，修复新增依赖的审计告警，未批量升级项目其他依赖。模板位于server/assets/purchase-documents，随既有server目录打包，Windows路径使用fileURLToPath。前端按需加载，不打包Excel解析库。
- ZIP旧中文文件名需GBK解码；包内进货单/漆料模板明确跳过并记录。限制总上传8MiB、20个上传文件、100个Excel、500张单、20000行；解压元数据限制64MiB/8000成员。每用户一个处理、每进程最多两个worker，90秒终止，worker V8老生代上限384MiB（不是进程RSS硬上限）。无轮询、OpenAPI调用或新增DB读取。
- 导出包括按源文件分组的Excel、漆料Excel及核对清单ZIP；样例明细和金额清空，保留供应商固定文字、内部编号文本、字体、边框及打印标题/区域，动态扩行。页脚原有溢出文字启用换行前必须合并其完整显示宽度，否则地址/条款会挤在A列。整数数字格式用0而非0.########，避免渲染尾随小数点。ExcelJS跨工作簿测试样本复制model后须显式恢复merges，否则预览夹具失去合并，并非原导出损坏。
- 原始明细ZIP完整回归：278张明细、809保留行、127排除行、315张输出（含57张漆料）、总金额350578。独立读回全部导出单，行数、公式缓存金额和总额一致；8种模板渲染检查，修复光启等页脚拥挤。本机一次完整worker导出约1.70秒，进程采样RSS峰值约296MiB、主线程事件循环延迟最大12.35ms；是本机该批次测量，不代表生产并发性能。
- 全量npm run check通过（1109项，1075通过、34环境依赖跳过，类型/构建/包体预算通过），其后仅补强源金额一致性和文本长度/审计配置边界；最新专项12项通过。日志/tmp/purchase-documents-final-check.log、/tmp/purchase-documents-unit.log、/tmp/purchase-documents-regression.log。Codex内置浏览器使用本机测试身份和真实处理接口验收上传→浮动/清洗剂90%→逐项核对→生成→下载，360/390/1440px检查换行和间距，修改规则立即使旧结果失效。截图output/playwright/purchase-documents/；临时预览页及服务已清理。未验证真实手机钉钉文件选择/下载，未推送、未部署。
- 其他聊天的报价输出、工单详情权限修复与交接记录保持不动。


## OpenAPI月额度计量口径纠正与后续候选 — 2026-11-11

- 用户确认新截图为11月10日维修应用单日：getuserinfo252、role/simplelist677、role/list636、user/get658、asyncsend_v2 510、getsendresult510；六项合计3243。另一截图为组织8001/10000（月额度剩1999），不能把单应用总调用与组织付费累计混算。
- 通过Codex浏览器实际读取钉钉官方《不纳入每月调用量限制的接口清单》（页面更新2025-09-01）：免登、用户详情、角色列表、角色成员都在免计量清单。此前角色/人员在途合并确实降负载，但不得据此声称等比例节省月付费额度。官方地址 https://open.dingtalk.com/document/orgapp/basic-interfaces-such-as-log-off-and-address-book 。web抽取只有标题，curl只有页面壳；浏览器渲染后可读正文，不得把空抽取误认为清单缺失。
- 真正省额优先核对工作通知510发送+510结果查询。现按收件人逐条发送；可先从现有队列统计同事件同正文同链接的多人组，设计共享批次/task_id发送与逐人结果归档，保留权限复核、部分失败、响应丢失不重发及重启恢复。3人组6次→2次仅是示例，不是全应用预计降幅。不能直接删除结果查询，也不能用截图计数相等证明每条都只查一次。
- 另有免计量调用性能空间：派工台每30秒旧summaries在无可见消费者时仍读名单；展开图表后updatedAt驱动另一workload顺序查名单，单纯在途合并不能解决；详情打开即取全选人名单；车辆通知先读管理员名单再检查任务是否失效。以上可按需优化，但应明确不等于缓解付费额度。
- 剩1999次按月底约20天需约100次/日；若工作通知两项仍约1020次计量/日，条件估算仅约2天，实际以后台增量及组织其他应用用量为准。不承诺完全保持通知时效/次数还能靠优化撑到月底。仅代码与官方资料只读核查，未修改业务、未部署；HTML说明 outputs/openapi-quota-analysis-20261111.html。

## 工作通知批量改造方案复核 — 2026-11-11

- 用户询问具体改法，本轮仅形成方案，未实现业务或部署。方案 outputs/openapi-notification-plan-20261111.html：先统计可合并比例，再以派工通知为首批，保存持久化批次与逐人记录；其他四类通知随后接入。没有可靠事件标识的旧记录保持单发，已受理/未知任务不能重新打包。
- 配件发送前校验会按个人重新生成有效正文，应在校验后按最终消息分组，不能只比较原始payload或工单号。不为凑批额外等待，也不混合不同返工轮次、签字批次或业务事件。
- 当前queryWorkNotification一次读取整个task_id结果但只返回一人状态；批量必须同时改为按批次查询，不能只拼userid。当前已读或未读均为sent，原实现没有为了追踪已读而持续查询，不得声称通过停止已读轮询节省现有调用。
- 批次设计需保存实际发送时的钉钉userid，避免换绑后拿新账号解释旧任务；部分失败、人工重试与旧租约回写必须按成员隔离。发送已被接受但task_id响应或落库丢失仍属未知，不承诺消除该窗口或自动重发。须采用小批次并保证校验/发送时间处于有效租约内，远程请求不持有数据库行锁。

- 结果查询必要性补充：当前后台确有自动查询与状态落库，DispatchTaskDetail 的“通知记录”显示平台受理/发送成功/失败/未知，并对明确失败提供人工重试；查询结果不作为接单、维修、完工的业务放行条件。此前“不能取消结果查询”表述过强：如果用户接受不自动发现异步发送失败，可设计默认不自动查询、仅排查时手动查询；界面必须保留“平台已受理（未核实发送结果）”语义，不伪装成发送成功，不因未知状态重发。此项目前仅讨论，尚未实施，不能声称完全保留原通知可观测能力。

## 通知按需查询及提检仅通知检验员（本地完成，未部署）— 2026-11-11

- 用户明确接受关闭自动结果查询，并要求维修工提检仅通知拥有检验员角色的人员。本轮实施这两项，未实施此前讨论的多人批量发送。五类投递队列（派工、竞价、出车、行驶证、保险）仅领取pending；accepted/unknown不自动查询、不自动重发，旧记录即使next_attempt_at到期也不会被自动领取。成功受理保持accepted，不伪造sent。明确的可重试发送错误沿用原有有界退避。
- 新增迁移202611110001，为五表保存实际发送钉钉账号、发送时间和最后手动查询时间，并增加pending专用索引。实际账号来自发送时的人员对象，旧记录不按当前账号猜测回填。缺任务编号/发送快照或超过24小时的记录只提示后台核对。迁移仅在隔离测试库验证，尚未应用实际开发库或生产库。
- 新增GET /api/notifications按业务资源读取轻量记录、POST /api/notifications/:source/:id/query单次查询。source与表名固定白名单；重新读取当前员工和资源归属，保留同店、岗位、出车本人及派工/备案的润丰员工绑定限制。一次手动操作最多一次远程查询；数据库租约和30秒间隔防并发重复付费，网络期间不持有行锁，结果未知不启动轮询或重发。慢请求返回时再次检查权限，旧租约不可覆盖新状态，清理失败不掩盖原异常。平台forbidden_list和矛盾结果也明确处理。
- 五类界面采用按需展开的通知记录；未展开不请求，刷新只读本地库，查询按钮才访问钉钉。身份/资源切换清空并忽略迟到响应，查询成功后刷新失败分别显示且保留结果。派工明确失败仍可人工重试。竞价原有收件人同步job必须与逐人投递一起显示，否则名单同步失败会被误报为空列表；job:前缀记录不可查询。行驶证聚合增加accepted，避免关闭轮询后一直显示已入队。
- 新提检/个人完工/回审提交不再生成调度通知；检验通知只同步检验员角色。兼任检验员的管理员/顾问符合本店独立检验规则仍可收件；仅管理员角色保留原有实际检验权限但不接收提检通知。旧调度提检job转入检验链路，不复活已有ready/obsolete任务；旧逐人消息发送前同样校验检验员角色。发送前同一次SQL增加源事件、维修轮次及最新提检/指定检验事件检查，防止返工/改派后旧提醒重新生效；没有增加SQL往返或OpenAPI读取。
- 最终npm run check：1134项，1097通过、37环境依赖跳过、0失败；类型、构建与包体预算通过。32组隔离PostgreSQL发布检查221项全通过、零跳过。日志/tmp/notification-manual-check-final.log、/tmp/notification-manual-release-final.log。工作台gzip估算417209字节，签字222873、供应商282497，均在预算内；非线上延迟实测。不增加后台定时器或扫描频率，正常受理后自动getsendresult为0；人工查询测试并发点击仅1次，首屏通知记录请求为0。
- 发布检查首次失败来自两类夹具：operationsFollowupReview未给新建车辆填保险，触发现有出车保险校验；vehicleTrips模拟发送账号为空，无法保存实际收件快照。补齐夹具保险及测试钉钉账号，未放宽业务。车辆专项7项与完整发布复跑通过。
- Chrome独立组件夹具在360/390/1440px验证长名字/错误换行、内边距、无横向溢出、双击防重、成功后刷新失败、身份变化及点击刷新恢复。截图与acceptance.json在output/playwright/notification-manual/。Ant Design disabled切换有颜色过渡，等待DOM可用还可能截到灰色过渡帧；已增加busy=false断言、实际点击恢复并等视觉稳定重拍。前端8项行为测试通过。临时页面已清理，原5173服务保持原状；未验证真实钉钉设备或实际发送，不推送、不部署。

## 工作通知完整清单（先列清单，未精简）— 2026-11-11

- 用户先提出减少低优先级推送，随后明确要求“先列出目前所有通知”。已暂停并精确撤回本轮车辆停推片段，保留上一轮所有本地改动；本轮没有停用任何通知、没有部署。用于准备回归的隔离容器 codex-notification-trim-test 已停止清理，未连接生产库或发送真实通知。
- 清单 outputs/notification-inventory-20261111.html 按当前本地代码逐个检查所有发送及入队入口：47个当前流程通知名称，另5个历史兼容名称；并非调用量统计。上一轮提检仅检验员和关闭自动结果查询仍未部署，不能把本地策略当作线上已生效。HTML可搜索/筛选，Chrome验证360/390/1440px无横向溢出，52/47/5条分类及搜索通过，截图 output/playwright/notification-inventory/。
- 现行还车直接完成，不需要收车审核，“车辆已归还”为状态广播。旧“车辆已出车”仍可由历史待出车记录触发；旧收车审核通过/退回虽已禁止新操作，但既有pending队列在状态/轮次匹配时仍可能发送，不能只看UI入口就称完全停发。待审批消息仍有“查看行驶证”旧文案，实际新申请为公里数照片，本轮仅记录未修改。
- 无照片审批申请/通过/驳回、开工、恢复、普通项目完成、检验通过、维修全部完成并无独立钉钉推送，不能与页面待办统计混算。保险30/7/1/0/-1阶段去重，过期并非每天发送；工单48/24/1小时窗口去重，错过窗口不补发。
- 后续候选：已归还、已取消、配件已出库、询价已发布、邀请链接重发、报告发布；采购逐家报价与最后收齐可重叠，采购广播可能通知操作者本人。纸质委托书是跨店广播且涉及现有只读授权；任何精简须同时审查旧pending队列、重试入口和访问规则，不改写已受理/未知/成功记录。本轮只提供清单，等待用户选定范围。

## 停用纸质创建、行驶证缺失备案、维修暂停推送（本地完成，未部署）— 2026-11-11

- 用户选定仅这三类停止发送，本轮没有停用车辆归还、配件出库或采购等其他候选。纸质创建改为recordPaperRecipients，沿用原所有门店有效管理员/顾问名单保存suppressed记录，不安排投递；这些记录仍承担跨店列表/附件只读授权，不能直接删除或停止生成。原详情接口、修改、派工、签字令牌隔离均未放宽。
- 行驶证新备案直接suppressed并保存完整理由、车牌/VIN、操作人和审计；不创建收件人、不读钉钉管理员名单。后台启动/解析/投递及仓库领取/分发入口均停止执行，没有该类定时轮询。备案有效性、幂等及签字规则保留。新备案UI只显示事实，有历史实际投递时按需保留历史通知查询；混合suppressed和accepted/sent时按实际投递条数聚合，不能退回“待处理”。
- 暂停维修不再产生调度通知job，暂停状态、原因、备注、操作历史和审计照常保留。旧暂停job在读取名单前终结为suppressed；纸质/暂停旧逐人待发消息在读取人员/发送前同样停用。两类人工重试SQL按kind拒绝恢复，查询响应canRetry禁止旧failed停用消息显示重试；调度错误列表排除停用种类，避免旧错误提示让人反复点重试。无法接单、提检及其他通知保持原规则。
- 新增迁移202611110002_suppressed_notification_kinds.sql，扩展dispatch_notifications、dispatch_scheduler_notifications、vehicle_license_exceptions、vehicle_license_exception_notifications的suppressed状态；清理所选类别pending，以及未解析的暂停/行驶证pending/failed任务。逐人accepted/unknown/sent/failed历史不改写、不删除；未知结果不当作未发送重新投递。迁移只在隔离测试库应用，实际开发/生产尚未执行，发布须先应用新增迁移。
- 独立复审未发现阻断问题。npm run check：1139项，1101通过、38环境依赖跳过、0失败，类型/构建/包体检查通过；完整33组隔离PostgreSQL发布检查226项全通过、零跳过。暂停业务及重试专项47项通过；迁移前后状态矩阵5项、纸质14项、行驶证/投递策略2项均通过。日志/tmp/notification-suppression-check.log、/tmp/notification-suppression-release.log、/tmp/notification-suppression-dispatch-pg.log、/tmp/notification-suppression-migration-review.log、/tmp/paper-notification-suppression-pg.log、/tmp/license-suppression-integration.log。
- 停用逐人消息测试人员读取/发送均为0，旧暂停解析仅领取及终结两次SQL，无名单同步；没有新增后台定时器或查询，纸质授权保存SQL次数保持原样。工作台静态gzip417246字节（前轮417209），签字222888、供应商282519，均在预算内；未测线上实际调用减量或延迟，不作比例承诺。
- Chrome独立夹具360/390/1440px验证长理由/姓名/VIN换行、内边距、弹窗和无横向溢出；新备案初始通知GET0，展开历史仅本地GET1、POST0；suppressed显示“不推送”，旧停用failed没有重试，普通失败仍有重试。截图与acceptance在output/playwright/license-suppression/。夹具初次漏导入真实styles.css导致默认body8px边距假溢出，补实际样式后重验通过；“无法提供”需click打开备案，不能用check要求未完成备案即切换单选。这两项为测试夹具问题，不是产品修复。
- 通知HTML清单已标注三类本地已停用，相关业务及测试说明已同步。临时浏览器夹具与隔离Docker容器已清理，原5173服务保持运行。未向真实钉钉发送、未验证真实手机、未推送、未部署。
