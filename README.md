# H5 DingTalk

维修委托书 H5 程序，用于服务顾问开单、行驶证 OCR、钉钉登录绑定、工单流转和后端数据落库。

## 目录结构

```text
repair-h5-dingtalk/
├── client/src/app/          # React 应用入口
├── client/src/features/     # 按业务功能组织的页面、组件、hooks、API
├── client/src/integrations/ # 钉钉浏览器集成
├── client/src/shared/       # 通用 UI 与 HTTP 基础设施
├── server/config/           # 服务端环境配置
├── server/database/         # PostgreSQL 连接与事务
├── server/repositories/     # 数据访问
├── server/routes/           # HTTP API 路由
├── shared/                  # 前后端共享 TypeScript 类型
├── supabase/                # PostgreSQL 数据库迁移
└── docs/                    # 架构与部署说明
```

## 本地开发

```bash
npm install
npm run dev
```

默认端口：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8787`

如需指定端口：

```bash
API_PORT=8790 VITE_PORT=5174 npm run dev
```

## 环境变量

复制 `.env.example` 到 `.env.local`，再填入实际配置：

```bash
cp .env.example .env.local
```

关键配置：

- `DATABASE_URL`：PostgreSQL 连接串
- `OCR_PROVIDER=aliyun`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_OCR_ENDPOINT=ocr-api.cn-hangzhou.aliyuncs.com`
- `JWT_SECRET`
- `DINGTALK_CORP_ID`
- `DINGTALK_APP_KEY`
- `DINGTALK_APP_SECRET`
- `OSS_REGION`
- `OSS_BUCKET`

## 常用命令

```bash
npm run build     # 构建前端
npm run migrate   # 执行数据库迁移
npm start         # 启动生产服务
npm run check     # 测试、类型检查和生产构建
```

架构说明见 `docs/architecture.md`，ECS 部署说明见 `docs/deploy-ecs.md`。

### 配件竞价与供应商报告

- 「配件竞价」仅本门店 `manager`（门店管理员）与 `warehouse`（仓管）可用，两者具备相同管理权限，与配件申请流程独立。
- 每次发布一种配件，邀请多家供应商。内部每5秒刷新最新报价；外部供应商仅可访问自己的报价，结束前可修改或放弃，保留全部版本。
- 设置截止时间后到点停止收集；有无截止时间均可由管理员或仓管提前结束。报价冻结后确认最低有效价中标；并列最低价必须指定供应商及原因。没有有效报价则流标，需求撤销计取消。
- 供应商档案登记手机号、联系人和名称。专属链接通过 URL fragment 携带凭证，首次打开后从地址栏移除；供应商填写预留手机号和姓名或供应商名称，无密码、无短信费用。此方式属于信息核对，不能证明本人身份。
- 对外入口为 `/supplier`，生产环境必须使用 HTTPS（供应商会话使用 Secure、HttpOnly、SameSite Cookie），并确保反向代理将 `/supplier` 转到 SPA、`/api/supplier-portal/*` 转到 Node 服务且保留原始 Host。邀请链接默认90天有效；结标时现有邀请最多再保留30天，重发后旧链接和会话失效。
- 金额按整数分传输，比较人民币含税含运费总价。分析按收集结束时间归属期间；未中标、未报价、主动放弃、无效报价、整场流标分别统计。
- 分析报告先生成不可变快照、内部预览，再发布30天有效的独立链接。对外价格比较排除自己：每场至少3家其他有效报价，每分组至少5场且涉及5家不同同行才展示5个百分点区间；不提供竞争者身份或单场基准价。报告支持反馈及内部访问记录。
- 邀请链接生成/重发、供应商提交/修改/放弃报价、询价修改及报告发布后，将内部管理链接通知本店管理员及仓管。复用 `DISPATCH_NOTIFICATION_MODE`、`DINGTALK_AGENT_ID`、`DISPATCH_APP_URL` 及钉钉应用凭据；`dingtalk` 模式同步两类角色名单。`disabled` 模式保留通知队列，详情可见状态；模拟发送仅限开发/测试。
- 部署前执行 `npm run check`；部署时先按现有流程应用新迁移 `202610200001_procurement_bidding.sql`，再启动新版本服务。迁移不涉及旧配件申请或外部采购系统。
- 完整数据库验证可显式设置本地 `PROCUREMENT_TEST_ADMIN_URL` 后运行 `node --test test/procurement.integration.test.mjs`。测试创建独立数据库并在结束后删除，不读取应用环境文件或修改业务数据。

- 询价发布后可编辑采购信息及截止时间，不再采集交货地点。仅调整截止时间保留报价资格；采购要求改变后保留历史报价，须由供应商按新版本重新确认，旧版本不参与最低价评选。已停止但未结标的询价，修改时须确认重新开放；已结标/取消的询价不能修改。邀请名单保持固定，修改前后内容记录于审计。
- 新增迁移 `202610200002_procurement_amendments.sql` 支持采购要求版本和并发编辑校验；更新服务前须先应用迁移。
