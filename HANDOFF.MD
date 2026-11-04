# Engineering Handoff

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
