# Engineering Handoff

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
