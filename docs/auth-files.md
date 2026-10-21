# 登录鉴权与文件存储

## 环境变量

后端必填：

```bash
JWT_SECRET=
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_CORP_ID=
FILE_STORAGE_PROVIDER=local
LOCAL_UPLOAD_ROOT=/opt/repair-h5-dingtalk/server/data/uploads
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=
```

前端只允许暴露 corpId：

```bash
VITE_DINGTALK_CORP_ID=
VITE_DINGTALK_CLIENT_ID=
```

网页应用首页建议配置为 `https://你的域名/?corpid=$CORPID$`。前端优先读取钉钉工作台注入的 `corpid` 查询参数；`VITE_DINGTALK_CORP_ID` 作为固定企业的备用值。`VITE_DINGTALK_CLIENT_ID` 填应用 Client ID（原 AppKey），它不是 Client Secret。

`VITE_*` 是前端编译期变量。生产部署必须在执行 `npm run build` 前提供
`.env.production`；修改这些值后需要重新构建和部署，仅重启 PM2 不会更新前端。

`DINGTALK_APP_SECRET`、`ALIYUN_ACCESS_KEY_SECRET`、`JWT_SECRET` 只能放后端运行环境。

## 登录流程

1. 钉钉 H5 调 JSAPI 获取 `authCode`。
2. 前端调用 `POST /api/auth/dingtalk-login`。
3. 后端用 `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` 获取钉钉 access token。
4. 后端用 `authCode` 换钉钉 `userid`。
5. 后端按 `users.dingtalk_user_id` 查本地员工。
6. 查到且账号启用后签发本系统 token。
7. 前端后续请求使用 `Authorization: Bearer <token>`。

## 文件存储流程

1. 前端拍照或选择图片。
2. 前端调用 `POST /api/files` 上传图片。
3. `FILE_STORAGE_PROVIDER=local` 时写入 `LOCAL_UPLOAD_ROOT`；配置为 `oss` 时上传 OSS。为兼容旧配置，未指定存储方式但存在 `OSS_BUCKET` 时仍使用 OSS。
4. 数据库 `files` 表只保存文件元数据，不保存图片二进制。
5. 行驶证 OCR 会把 OCR 记录关联到上传后的 `fileId`。

## 正式上线要求

- `users.dingtalk_user_id` 必须由管理员预先绑定，不能靠姓名自动匹配。
- 生产环境必须配置强随机 `JWT_SECRET`。
- 使用本地存储时，`LOCAL_UPLOAD_ROOT` 必须指向 ECS 的持久化目录并纳入磁盘备份；多台 ECS 不能共享本地文件。
- 钉钉应用首页必须是 HTTPS 公网地址，不能是 localhost。


## 客户签字、远程链接与人工确认

开单页和归档补签均通过 `POST /api/work-orders/:id/signature-token` 获取可用会话。有效会话直接复用；未签字的“待客户签字”工单缺少会话或会话过期时，自动重新签发无时间限制的会话并使旧会话失效，记录操作人及时间。已确认签字或纸质委托单不允许重新签发；待确认的签字可以因不合格要求重签。创建会话与提交签名均先锁定父工单，再处理令牌，防止并发重复签发或重复提交。

服务顾问／管理员登录后，在签字弹窗复制客户签字链接，通过微信或短信手动转发。客户在 `/customer-signature#令牌` 打开手机页面，无需登录或加入钉钉企业。令牌使用 32 字节安全随机数；放在 URL fragment，客户接口通过 POST 请求体接收令牌，避免进入地址查询参数和访问路径日志。页面仅展示签字所需的委托信息，不开放员工工单或文件接口。

“重新发送链接”调用原签发接口并传入 `renew: true`，立即使旧会话失效，生成不设时间限制的新链接；新链接仍需员工手动复制发送。待确认签字可通过“签名不合格，重新发送链接”撤回并重签；旧签名文件保留，新签名须重新审核。提交签字后链接不可再次提交。旧版本的短随机会话在发起签字时自动替换，不允许用于免登录接口。

免登录接口：`POST /api/public/customer-signature/session` 查询状态；`POST /api/public/customer-signature/sign` 接收令牌、PNG 签名和 `confirmed: true`。签名限制为 2 MB、400 万像素以内，经解码和重新编码后保存；服务端从会话确定工单与客户，不接受客户指定文件或工单。令牌校验、文件元数据、签名、通知入队在同一工单锁事务中提交。

现场和远程签字均先标记 `customerSignatureReview.state=pending`，界面显示“需确认用户签字”，底层状态保持“待客户签字”以阻止同步和派工。使用现有钉钉工作通知队列，通知本店负责顾问及本店管理员。推送沿用 `DISPATCH_NOTIFICATION_MODE=dingtalk`、`DINGTALK_AGENT_ID`、`DISPATCH_APP_URL` 和钉钉凭据配置；关闭通知时保留队列记录。通知直达 `?workOrder=单号`；每次提交签字单独入队，发送前重新检查收件人权限、待确认状态及签字批次，过时通知不再发送。

仅负责该单的服务顾问或本店管理员可以通过 `POST /api/work-orders/:id/confirm-customer-signature` 确认。确认事务记录操作人与时间，将状态改为“已委托”，激活预设派工并写入润丰初次同步队列；并发或重复确认不会重复入队。旧版本已签字工单不补加确认关卡。部署前依次执行新迁移 `202610210001_customer_signature_review.sql` 和 `202610210002_signature_resubmission.sql`。

独立临时 PostgreSQL 回归：显式设置本机 `WORKFLOW_TEST_ADMIN_URL` 后运行 `node --test test/workflowRecovery.integration.test.mjs`。测试创建并删除自己的数据库，覆盖过期／缺失会话、并发签发与签署、旧会话拒绝、改派责任留痕和检验写回快照，不读取应用 `.env`。
