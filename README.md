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
