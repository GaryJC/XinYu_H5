# 本地测试身份

运行 `npm run dev` 时，开发脚本会自动设置：

```text
APP_ENV=development
ENABLE_DEV_AUTH=true
```

如果 `.env.local` 没有 `JWT_SECRET`，开发脚本会使用一个仅限本机测试的固定密钥；生产环境仍必须配置独立的高强度 `JWT_SECRET`。

普通浏览器的页面右上角会出现“选择测试身份”：

- 张三｜服务顾问：生成真实的本地 `advisor` 会话并进入委托开单。
- Gary｜门店管理员：生成真实的本地 `manager` 会话并进入工作台。
- 未分配角色员工：后端返回 403，不生成 Token。
- 已停用员工：后端返回 403，不生成 Token。

切换身份前会清理浏览器中原有的本地 Token。模拟成功后，后续 API 使用与钉钉免登相同的签名 Token 和数据库会话。

生产启动命令 `npm start` 不经过开发脚本。只要 `.env.production` 不同时满足 `APP_ENV=development` 和 `ENABLE_DEV_AUTH=true`，`POST /api/auth/dev-login` 就返回 404。生产环境必须保持：

```text
APP_ENV=production
ENABLE_DEV_AUTH=false
```
