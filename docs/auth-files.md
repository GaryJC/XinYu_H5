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
