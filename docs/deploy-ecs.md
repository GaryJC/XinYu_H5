# ECS 部署步骤

## 目标架构

测试版可以先跑在一台 ECS 上：

```text
Nginx 443 HTTPS
  -> Node 服务 localhost:8787
      -> dist 前端静态文件
      -> /api 后端接口
      -> PostgreSQL/RDS
      -> 阿里云 OCR
      -> OSS 图片存储
```

代码结构：

```text
repair-h5-dingtalk/
├── client/   # React H5 前端
├── server/   # Node API、OCR、钉钉、数据库、文件存储
├── shared/   # 前后端共享 TypeScript 类型
├── supabase/ # PostgreSQL 迁移
└── scripts/  # 构建/迁移/开发脚本
```

正式生产建议数据库使用阿里云 RDS PostgreSQL，图片使用 OSS。

## 1. ECS 准备

ECS 安全组放行：

- `22`：SSH
- `80`：HTTP，申请证书/跳转 HTTPS
- `443`：HTTPS，钉钉 H5 必须使用 HTTPS

服务器安装 Node.js 22 LTS、Git、Nginx。Ubuntu 示例：

```bash
sudo apt update
sudo apt install -y git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 2. 上传代码

任选一种：

```bash
git clone <你的仓库地址> /opt/repair-h5-dingtalk
cd /opt/repair-h5-dingtalk
```

或从本机打包上传到 `/opt/repair-h5-dingtalk`。

## 3. 配置环境变量

在服务器创建 `.env.production`，不要提交到 Git：

```bash
cd /opt/repair-h5-dingtalk
sudo nano .env.production
```

模板：

```bash
DATABASE_URL=postgresql://用户名:密码@RDS地址:5432/数据库名
API_PORT=8787
APP_ENV=production
ENABLE_DEV_AUTH=false

SQLSERVER_HOST=
SQLSERVER_PORT=1433
SQLSERVER_DATABASE=kxqpjxc2
SQLSERVER_USER=
SQLSERVER_PASSWORD=
SQLSERVER_ENCRYPT=false
SQLSERVER_TDS_VERSION=7_1

OCR_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_OCR_ENDPOINT=ocr-api.cn-hangzhou.aliyuncs.com

JWT_SECRET=改成一串强随机值
DINGTALK_CORP_ID=
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
VITE_DINGTALK_CORP_ID=和DINGTALK_CORP_ID一致

# 不使用 OSS 时明确选择本地存储；该目录需要持久化并定期备份
FILE_STORAGE_PROVIDER=local
LOCAL_UPLOAD_ROOT=/opt/repair-h5-dingtalk/server/data/uploads
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=
```

如果还没有 RDS，测试阶段可以临时在 ECS 上安装 PostgreSQL，但正式环境建议尽快换 RDS。

## 4. 安装依赖、构建、迁移数据库

```bash
cd /opt/repair-h5-dingtalk
npm ci
npm run check
npm run migrate
npm run sqlserver:check
```

## 5. 用 PM2 启动 Node 服务

```bash
sudo npm install -g pm2
cd /opt/repair-h5-dingtalk
pm2 start npm --name xinyu-h5 --cwd /opt/repair-h5-dingtalk -- start
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的 sudo 命令，使服务随 ECS 启动。

Windows Server 部署到 `C:\apps\XinYu_H5` 时，在 PowerShell 中使用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\apps\XinYu_H5\scripts\deploy-windows.ps1
```

同一台 Windows ECS 上的独立测试实例可使用不同目录、进程名和端口：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\apps\Xinyu_H5_test\scripts\deploy-windows.ps1 `
  -AppPath C:\apps\Xinyu_H5_test `
  -ProcessName xinyu-h5-test `
  -Port 8788 `
  -SkipSqlServerCheck
```

`-SkipSqlServerCheck` 仅用于未配置润丰 SQL Server 的隔离测试环境；正式环境不应使用该开关。

`ecosystem.config.cjs` 会以项目目录为工作目录，并让 Node 每次启动时读取 `.env.production`。
云效的 Windows PowerShell 部署步骤使用下面的完整命令。必须重新构建包含
`SourcePath` 支持的制品。内层源码包仅解压到本次部署的临时目录，禁止覆盖生产根目录：

```powershell
$ErrorActionPreference = "Stop"
$A = "C:\apps\XinYu_H5"
$P = "C:\temp\XinYu_H5-package.tgz"
$RunId = [guid]::NewGuid().ToString("N")
$S = "C:\temp\xinyu-artifact-$RunId"
$L = "C:\temp\xinyu-deploy-$RunId.log"
try {
    if (!(Test-Path -LiteralPath $P)) { throw "Artifact missing" }
    $Outer = Join-Path $S "outer"
    $Source = Join-Path $S "source"
    New-Item $Outer, $Source -ItemType Directory -Force | Out-Null
    tar.exe -xzf $P -C $Outer
    if ($LASTEXITCODE -ne 0) { throw "Outer extract failed" }
    $Packages = @(Get-ChildItem $Outer -Filter package.tgz -Recurse -File)
    if ($Packages.Count -ne 1) { throw "Expected exactly one inner package.tgz" }
    tar.exe -xzf $Packages[0].FullName -C $Source
    if ($LASTEXITCODE -ne 0) { throw "Inner extract failed" }
    $Deploy = Join-Path $Source "scripts\deploy-windows.ps1"
    if (!(Test-Path -LiteralPath $Deploy)) { throw "Deployment script missing" }
    # Merge child output via cmd to retain native error text in the pipeline log.
    $Command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -AppPath "{1}" -SourcePath "{2}" > "{3}" 2>&1' -f $Deploy, $A, $Source, $L
    cmd.exe /d /c $Command
    $Code = $LASTEXITCODE
    Get-Content -LiteralPath $L
    if ($Code -ne 0) { throw "Deploy failed: $Code" }
} finally {
    Remove-Item -LiteralPath $S -Recurse -Force -ErrorAction SilentlyContinue
}
```

临时目录和日志使用每次运行的唯一编号，避免相互清理；日志保留用于排障。
流水线仍应禁止并发部署同一环境（包括覆盖同一路径的下载制品）。
部署脚本的 `-SourcePath` 指向制品源码，`-AppPath` 指向生产配置及数据目录；
省略 `-SourcePath` 时默认使用脚本所在源码目录。准备和激活脚本均从新制品读取，
不会误用生产根目录遗留的旧脚本。

`START_LOCAL_API` 仅供 `npm run dev` 使用，生产环境不需要设置。
Windows 部署脚本在 `<AppPath>/.releases/<版本>` 独立目录安装依赖、运行检查和迁移，
准备期间旧服务继续运行。准备成功后才停止旧进程，在原端口启动新版本；健康检查必须同时
匹配新版本标识，失败时尝试恢复上一版 PM2 启动配置。固定端口切换仍有短暂中断，
不属于双实例零停机发布。数据库迁移在旧服务运行时执行，必须向后兼容；回退应用不会撤销迁移。

PM2 工具位于 `<AppPath>/.deploy-tools`，进程空间固定在 `<AppPath>/.pm2`。
后续发版继续调用部署脚本，不要手动用根目录 `ecosystem.config.cjs` 覆盖版本目录的启动配置；
日常重启可在同一 `PM2_HOME` 下使用 `pm2 restart <进程名>`。
`.env.production` 从根目录复制到版本目录；不复制 `.env.local`。
上传目录保持指向根目录原有位置，版本内 `server/data` 为指向共享数据的目录联接，
默认或相对 `LOCAL_UPLOAD_ROOT` 转为根目录下的绝对路径。前端使用新版本构建的 `dist`；
根目录 `dist` 在健康检查成功后改为指向新版本的目录联接，兼容固定 Nginx/IIS 静态目录，
并保留上一版本的哈希静态资源供已打开页面加载。`STATIC_DIR` 在版本运行配置中固定为该版本的 `dist`。

云效不得向生产根目录解压或清理文件；`.releases`、`.deploy-tools`、`.pm2`、`.npm-cache`、`.env.production` 和 `server/data` 均保留。
部署成功、健康检查及 PM2 保存均完成后，自动清理 `.releases` 中同一应用的更早版本，
保留本次当前版本及切换前实际运行的上一版本（按 PM2 记录确定，不按目录时间猜测）。
之前准备完整但未成功发布的版本，也在下一次成功发布后清理。
清理会保护所有 PM2 进程使用的路径、静态服务当前目标及共享上传目录；目录联接只移除联接本身。
缺少有效 `release.json` 或属于其他应用的目录会保留并提示，便于人工核对。
当前版只继承上一版自身构建的哈希资源，避免兼容资源跨版本无限累积；跨越两代以上的旧页面可能需要刷新。
首次从根目录旧部署迁移时，保留原根目录及其静态备份用于上一版回退；后续发布会移除不再需要的静态备份。
根目录遗留源码及依赖、PM2 日志和 npm 缓存不在版本清理范围内。
清理失败只打印警告，不回退已健康上线的版本；应检查警告，解除文件锁后于下次成功发布重试。
发布失败及回退过程中不执行清理。
部署锁阻止同一目录内两个部署脚本并发切换，但不保护云效外层的并发解压；流水线应禁止并发部署同一环境。
使用上述临时目录流程首次从根目录旧部署过渡时，也不会覆盖旧源码和依赖。
此前覆盖部署已改写的文件无法通过此流程自动恢复；需另行使用已知正常版本恢复。

### 云效构建制品

构建步骤使用项目自带的白名单打包脚本：

```bash
npm run package:deploy
```

把生成的 `package.tgz` 配置为部署制品。该制品只包含客户端、服务端、迁移、
测试和构建配置，不包含 `node_modules`、`.git`、`dist`、本地缓存或任何
`.env` 文件，也不会打包 `server/data` 中的运行时上传数据。Windows 部署
阶段会通过 `npm ci` 安装与锁文件一致的依赖，并通过 `npm run check` 重新
生成 `dist`。

本机检查：

```bash
curl http://127.0.0.1:8787/api/health
```

## 6. 配置 Nginx 反代

示例域名：`repair.example.com`

```bash
sudo nano /etc/nginx/sites-available/repair-h5
```

内容：

```nginx
server {
    listen 80;
    server_name repair.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name repair.example.com;

    ssl_certificate /etc/nginx/certs/repair.example.com.pem;
    ssl_certificate_key /etc/nginx/certs/repair.example.com.key;

    client_max_body_size 20m;

    root /opt/repair-h5-dingtalk/dist;
    index index.html;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用：

```bash
sudo ln -s /etc/nginx/sites-available/repair-h5 /etc/nginx/sites-enabled/repair-h5
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 钉钉网页应用填写

移动端首页地址：

```text
https://repair.example.com/
```

PC 端首页地址：

```text
https://repair.example.com/
```

管理后台地址：当前没有单独后台，可以先留空；如果必填，先填同一个：

```text
https://repair.example.com/
```

## 8. 上线后必须做的绑定

钉钉免登只会返回钉钉 `userid`。本系统必须预先在数据库里绑定：

```sql
update users
set dingtalk_user_id = '钉钉userid'
where name = '员工姓名';
```

后续应做一个管理员页面维护员工和钉钉 userid。

### 历史覆盖部署的兼容清理

Windows 部署在安装依赖前运行 `scripts/clean-obsolete-deployment-files.mjs`，只移除已在提交 d3728bf 删除的 `DingTalkRoleMappings.tsx` 与 `MappingEditor.tsx`。旧部署直接解压覆盖时，这两个文件可能残留并触发类型检查错误。清理不会扫描或删除环境配置、上传照片、PM2 状态和其他源文件。长期应使用独立版本目录部署，避免覆盖解压留下历史源码。


### Windows 部署慢或覆盖部署检查失败

`deploy-windows.ps1` 会打印每个步骤的开始时间和耗时。依赖安装使用固定的 `<AppPath>\.npm-cache` 缓存并优先复用缓存，仍按锁文件执行 `npm ci`；首次填充缓存仍需下载。可用 `-NpmCachePath` 指定已有缓存目录。日常部署保留该缓存以减少下载；磁盘不足时可清理缓存，下次安装会重新下载。安装只输出警告和错误，npm 调试日志最多保留 5 份，位于缓存目录的 `_logs` 下。检查命令合并 stdout/stderr，避免云效漏掉测试或构建错误。

部署包采用覆盖解压时，Git 已删除的文件可能残留。脚本会清理明确列出的旧文件，包括已退役的 `test/legacyWorkOrderRepository.test.mjs`；它引用已移除的 `ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY`，残留时会导致检查失败。该清理不触碰配置、上传文件、PM2 数据或当前测试。

如果旧版本已因这一残留文件部署失败，可以在服务器应用目录执行新版清理脚本后重跑部署。不要通过跳过 `npm run check` 绕过失败。

### Windows Sharp DLL 被占用导致安装失败

`npm ci` 删除 `@img` 下的 `libvips*.dll`（例如 `libvips-42.dll`）时返回 EPERM，
常见原因是旧服务仍加载该 DLL。新版部署在全新版本目录安装依赖，不再删除旧服务使用的依赖，
因此无需在安装、构建期间停服。安装、检查、连接检查失败时旧服务不停止；
只有准备完成后的端口切换需要短暂停服。若新版本健康检查失败，会尝试恢复旧版并报告部署失败；
回退也失败时会明确报告两次错误。

发布时必须重新构建部署包，包含 `scripts/deploy-windows.ps1`、
`scripts/prepare-deployment-release.mjs` 和 `scripts/activate-deployment-release.mjs`。
不要重用旧制品，不要使用 `taskkill /IM node.exe /F` 清理整台服务器的 Node 进程。
本机隔离 PM2 切换及回退验证：
`DEPLOYMENT_PM2_TEST=true node --test test/deploymentRelease.integration.test.mjs`。


### Windows 部署提示“磁盘空间不足”

若 `npm ci` 期间出现 `out-lineoutput ... IOException`，错误内容为“磁盘空间不足”，
需要检查应用目录、npm 缓存及临时目录所在磁盘；这不是编译错误。
新脚本在准备版本前检查这三个位置，默认各需至少 4 GiB 可用空间，
不足则提前停止并显示路径和剩余空间。可通过 `-MinimumFreeSpaceGB` 调整预留量；
4 GiB 是预检下限，实际需求取决于依赖大小、日志和同时进行的其他任务。
成功后才会清理旧版本，因此发布期间仍需要容纳当前版、上一版及待发布版；已满的磁盘须先人工释放空间。

在服务器 PowerShell 中检查：

```powershell
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free
```

优先扩容或清理确认不再需要的部署下载包、历史日志、失败版本中的 `node_modules`。
清理版本前，在相同 `PM2_HOME` 下用 PM2 核对当前运行目录，并保留需要回退的版本。
版本内 `server/data` 是共享上传目录联接，**不要递归清理整个版本目录或该联接**。
`.env.production`、`server/data`、`.pm2` 和当前运行版本需要保留。
不要用 `pm2 flush` 清日志而不留排障记录，也不要把 npm 缓存清理视作日常部署步骤。

磁盘紧张时，可在没有部署正在安装依赖的情况下清理可重建的 npm 下载缓存：

```powershell
npm.cmd cache clean --force --cache "C:\apps\XinYu_H5\.npm-cache"
```

释放空间后，重新构建包含新预检脚本的 `package.tgz`，上传制品并重新运行流水线。
新版本准备成功并通过健康检查后，才会切换应用。
