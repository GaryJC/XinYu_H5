# 登录鉴权与文件存储

## 环境变量

后端必填：

```bash
JWT_SECRET=
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_CORP_ID=
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
3. 后端配置了 `OSS_BUCKET` 时上传 OSS；未配置时写入 `server/data/uploads` 作为本地开发模式。
4. 数据库 `files` 表只保存文件元数据，不保存图片二进制。
5. 行驶证 OCR 会把 OCR 记录关联到上传后的 `fileId`。

## 正式上线要求

- `users.dingtalk_user_id` 必须由管理员预先绑定，不能靠姓名自动匹配。
- 生产环境必须配置强随机 `JWT_SECRET`。
- 生产环境应配置 OSS，不使用本地文件目录。
- 钉钉应用首页必须是 HTTPS 公网地址，不能是 localhost。
