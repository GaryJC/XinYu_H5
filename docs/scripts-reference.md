# 项目脚本使用手册

本文档汇总 `package.json` 中的全部 npm 命令，以及 `scripts/` 目录下的直接执行脚本。

## 运行前说明

- Node.js 版本：`>=20.20 <23`。
- 本地命令通常读取 `.env.local`，生产命令通常读取 `.env.production`。
- `.env.local` 和 `.env.production` 不进入 Git，也不会打进部署包。
- Windows ECS 请在项目目录 `C:\apps\XinYu_H5` 中使用 PowerShell 或 CMD 执行命令。
- 标记为“危险”的命令会修改或删除数据库数据，必须先确认当前环境变量连接的是哪套数据库。
- `npm run dev` 的前端支持热更新，但 Node API 不会自动重载；修改 `server/` 或服务端路由后必须停止并重新运行 `npm run dev`。

## npm 命令总览

| 命令 | 用途 | 主要环境 | 数据影响 |
| --- | --- | --- | --- |
| `npm run dev` | 同时启动本地 API 和 Vite 前端 | `.env.local` | 正常业务读写 |
| `npm run api` | 只启动本地 API | `.env.local` | 正常业务读写 |
| `npm start` | 启动生产 API | `.env.production` | 正常业务读写 |
| `npm run migrate` | 执行尚未应用的 PostgreSQL migration | 生产优先，本地回退 | 修改数据库结构或迁移数据 |
| `npm run mock:runfeng` | 创建润丰旧轮询联调 mock 数据 | 生产优先，本地回退 | 新增 PostgreSQL 测试数据 |
| `npm run mock:runfeng:refresh` | 删除当前 mock 批次后重新创建 | 生产优先，本地回退 | 删除并重建 PostgreSQL 测试数据 |
| `npm run db:clear-work-orders` | 预览 PostgreSQL 全部委托单数量 | 生产优先，本地回退 | 默认不删除；带确认参数后极危险 |
| `npm run db:delete-test-orders` | 按 H5 委托单号清理生产测试单 | 生产优先，本地回退 | 可删除 PostgreSQL 和润丰测试单 |
| `npm run sqlserver:check` | 检查润丰 SQL Server 连接和表清单 | 生产优先，本地回退 | 只读 |
| `npm run db:start` | 启动本地 Supabase | Supabase CLI | 启动本地服务 |
| `npm run db:reset` | 重建本地 Supabase 并重新执行 migration/seed | Supabase CLI | 危险：清空本地数据库 |
| `npm run db:stop` | 停止本地 Supabase | Supabase CLI | 停止本地服务 |
| `npm run typecheck` | TypeScript 类型检查 | 无数据库要求 | 无 |
| `npm test` | 运行 Node 自动化测试 | 测试环境 | 无生产数据写入 |
| `npm run build` | 类型检查并构建生产前端 | 生产优先，本地回退 | 生成 `dist/` |
| `npm run check` | 依次运行测试和生产构建 | 同上 | 无生产数据写入 |
| `npm run package:deploy` | 生成云效部署包 | 本地构建机 | 生成/覆盖 `package.tgz` |
| `npm run preview` | 本地预览已构建的 Vite 前端 | 本地 | 无 |

## 开发与运行

### `npm run dev`

同时启动：

- API：`http://localhost:8787`
- Vite：`http://localhost:5173`
- Vite 的 `/api` 请求代理到本地 8787 API。
- 自动开启本地开发登录能力。

```powershell
npm run dev
```

可用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_PORT` | `8787` | 本地 API 端口 |
| `VITE_PORT` | `5173` | Vite 端口 |
| `VITE_HOST` | `0.0.0.0` | Vite 监听地址 |
| `START_LOCAL_API` | `true` | 设为 `false` 时不启动本地 API |
| `API_PROXY_TARGET` | `http://localhost:<API_PORT>` | Vite API 代理目标 |

注意：前端代码会热更新，但 `server/server.mjs` 是普通 Node 子进程。修改服务端代码后必须重启整条命令，否则可能出现新前端请求新接口、旧 API 返回 `Not found` 的情况。

### `npm run api`

仅使用 `.env.local` 启动 Node API，不启动前端：

```powershell
npm run api
```

### `npm start`

使用 `.env.production` 启动生产 API：

```powershell
npm start
```

生产环境通常由项目内 PM2 执行此命令，不建议在已有 PM2 进程运行时再手动启动第二份 API。

### `npm run preview`

预览已经生成的 `dist/`：

```powershell
npm run build
npm run preview
```

## 数据库脚本

### `npm run migrate`

按文件名顺序执行 `supabase/migrations/*.sql`。脚本会创建并读取 `schema_migrations`，已经成功应用的 migration 不会重复执行。每个新 migration 都在独立事务中执行，失败会回滚并返回非零退出码。

```powershell
npm run migrate
```

Windows 自动部署脚本已经执行该命令；云效部署成功后不需要再次手动运行。

### `npm run sqlserver:check`

验证 SQL Server 配置、连接和数据库信息，默认还会列出用户表：

```powershell
npm run sqlserver:check
```

部署健康检查只检查连接、不列全表：

```powershell
$env:SQLSERVER_CHECK_LIST_TABLES="false"
npm run sqlserver:check
Remove-Item Env:SQLSERVER_CHECK_LIST_TABLES
```

### `npm run db:start`

```powershell
npm run db:start
```

启动 Supabase CLI 管理的本地 PostgreSQL 等服务。

### `npm run db:stop`

```powershell
npm run db:stop
```

停止本地 Supabase。

### `npm run db:reset`

```powershell
npm run db:reset
```

危险：重建并清空本地 Supabase 数据库，然后重新应用 migration 和 seed。不要将 Supabase CLI 配置指向生产数据库后执行。

## 测试数据脚本

### `npm run mock:runfeng`

创建固定批次的润丰旧轮询联调数据。默认批次标识为 `RUNFENG-MOCK-20260731-V1`，保存在 `work_orders.fee_note`。

```powershell
npm run mock:runfeng
```

如果批次已经存在，脚本不会重复创建。该脚本服务于历史 `legacy_sync_outbox` 轮询联调，不代表当前“客户签字后直接写入润丰”的正式流程。

自定义批次：

```powershell
$env:RUNFENG_MOCK_BATCH="RUNFENG-MOCK-20260817-V1"
npm run mock:runfeng
Remove-Item Env:RUNFENG_MOCK_BATCH
```

批次名必须以 `RUNFENG-MOCK-` 开头。

### `npm run mock:runfeng:refresh`

先删除同一批次的 PostgreSQL mock 委托单，再重新创建：

```powershell
npm run mock:runfeng:refresh
```

它不会清理当前直接写入润丰 SQL Server 的维修单。

### 清理 mock 批次

`seed-runfeng-mock.mjs` 还支持 `--cleanup`，但没有单独的 npm 别名：

```powershell
node --env-file-if-exists=.env.production --env-file-if-exists=.env.local scripts/seed-runfeng-mock.mjs --cleanup
```

仅删除 `fee_note` 等于当前 `RUNFENG_MOCK_BATCH` 的 PostgreSQL 委托单。

## 删除数据脚本

### `npm run db:delete-test-orders`

用于生产环境按明确 H5 委托单号删除测试数据。必须先预览：

```powershell
npm run db:delete-test-orders -- --order-id WT-20260817-ABC123DEF456
```

预览会同时核对 PostgreSQL 与润丰中的：

- H5 委托单号和 `qxwxb.bzxx = H5:<委托单号>` 来源标记；
- `reid`、内部单号、派工号和车牌；
- 是否已经产生派工明细、出库、竣工、退回、收款或历史归档。

确认无误后，复制输出中的 `confirmationCommand` 执行正式删除。示例：

```powershell
npm run db:delete-test-orders -- --order-id WT-20260817-ABC123DEF456 --confirm=WT-20260817-ABC123DEF456
```

正式执行会删除：

- PostgreSQL `work_orders` 及其外键级联业务数据；
- 润丰 `qxwxmxb` 测试维修项目；
- 润丰 `qxwxb` 测试维修单。

不会删除 `qxclxxb` 车辆档案，避免误删已有车辆主数据。如果检测到下游业务记录，脚本会拒绝自动删除。

多个委托单可以重复传入 `--order-id`，但生产环境建议逐单预览、逐单删除。

### `npm run db:clear-work-orders`

极危险：用于清空 PostgreSQL 中的全部委托单。第一次运行只输出数量，不删除：

```powershell
npm run db:clear-work-orders
```

确认后才可执行：

```powershell
npm run db:clear-work-orders -- --confirm-delete-all-work-orders
```

会级联删除同步事件、维修项目、签字、OCR、文件元数据等，但：

- 不删除用户与权限配置；
- 不删除磁盘或 OSS 中的实际图片对象；
- 不删除润丰 SQL Server 数据。

生产环境优先使用 `db:delete-test-orders` 精确删除测试单，不要使用全量清空命令。

### H5 中删除草稿

草稿删除是应用功能，不需要运行命令：进入“归档查询”打开本人草稿，点击“删除草稿”并二次确认。服务顾问只能删除本人草稿，管理员可以删除全部草稿，非草稿状态后端会拒绝删除。

## 检查与构建

### `npm run typecheck`

```powershell
npm run typecheck
```

执行 TypeScript project references 检查，不生成生产包。

### `npm test`

```powershell
npm test
```

使用 Node test runner 执行 `test/*.test.mjs`。

只运行名称匹配的测试：

```powershell
npm test -- --test-name-pattern="draft"
```

### `npm run build`

```powershell
npm run build
```

先执行类型检查，再使用 Vite 构建到 `dist/`。

### `npm run check`

```powershell
npm run check
```

依次执行：

1. `npm test`
2. `npm run build`

这是部署前必须通过的检查，也是 Windows 自动部署脚本的一部分。

## 打包与部署

### `npm run package:deploy`

```powershell
npm run package:deploy
```

默认在项目根目录生成或覆盖 `package.tgz`，包含：

- `client/`
- `server/`
- `shared/`
- `scripts/`
- `supabase/`
- `test/`
- PM2、npm、TypeScript 和 Vite 配置文件

不包含 `server/data`、`.env.production` 或 `.env.local`。

指定输出路径：

```powershell
node scripts/create-deployment-package.mjs C:\temp\xinyu-package.tgz
```

也可以通过 `DEPLOY_PACKAGE_PATH` 指定。

### `scripts/deploy-windows.ps1`

Windows ECS 内层部署脚本。正常由云效解包后调用，也可以在 ECS 项目目录手动执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\apps\XinYu_H5\scripts\deploy-windows.ps1
```

默认参数：

| 参数 | 默认值 |
| --- | --- |
| `AppPath` | `C:\apps\XinYu_H5` |
| `ProcessName` | `xinyu-h5` |
| `Port` | `8787` |

执行顺序：

1. `npm.cmd ci --include=dev`
2. `npm.cmd run check`
3. `npm.cmd run migrate`
4. SQL Server 连接检查
5. 使用项目本地 `node_modules\.bin\pm2.cmd` 执行 `startOrReload`
6. 最多等待 30 秒检查 `/api/health`
7. `pm2 save`

任何一步失败都会让部署返回非零退出码。

## 未暴露为 npm 命令的脚本

| 文件 | 用途 | 建议 |
| --- | --- | --- |
| `scripts/verify-legacy-sync-batch.mjs` | 在 PostgreSQL 事务中验证旧轮询批量 ACK/失败逻辑 | 仅开发或专项数据库验证 |
| `scripts/deploy-windows.ps1` | Windows ECS 自动部署 | 由云效调用 |

### `verify-legacy-sync-batch.mjs`

运行方式：

```powershell
node --env-file-if-exists=.env.production --env-file-if-exists=.env.local scripts/verify-legacy-sync-batch.mjs
```

要求数据库至少已有 4 张委托单。脚本会在事务内临时写入 4 条验证事件，检查两条成功和两条失败结果，最后始终回滚。虽然正常情况下不会保留数据，仍不建议在业务高峰期对生产库运行。

## `scripts/` 文件与 npm 命令对应关系

| 文件 | 对应命令 |
| --- | --- |
| `scripts/dev.mjs` | `npm run dev` |
| `scripts/migrate.mjs` | `npm run migrate` |
| `scripts/check-sqlserver.mjs` | `npm run sqlserver:check` |
| `scripts/seed-runfeng-mock.mjs` | `npm run mock:runfeng`、`npm run mock:runfeng:refresh` |
| `scripts/clear-work-orders.mjs` | `npm run db:clear-work-orders` |
| `scripts/delete-production-test-orders.mjs` | `npm run db:delete-test-orders` |
| `scripts/create-deployment-package.mjs` | `npm run package:deploy` |
| `scripts/deploy-windows.ps1` | 云效部署内层脚本 |
| `scripts/verify-legacy-sync-batch.mjs` | 无 npm 别名，专项验证时直接执行 |
