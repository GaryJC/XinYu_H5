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

OCR_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_OCR_ENDPOINT=ocr-api.cn-hangzhou.aliyuncs.com

JWT_SECRET=改成一串强随机值
DINGTALK_CORP_ID=
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
VITE_DINGTALK_CORP_ID=和DINGTALK_CORP_ID一致

OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=
```

如果还没有 RDS，测试阶段可以临时在 ECS 上安装 PostgreSQL，但正式环境建议尽快换 RDS。

## 4. 安装依赖、构建、迁移数据库

```bash
cd /opt/repair-h5-dingtalk
npm ci
npm run build
npm run migrate
```

## 5. 用 PM2 启动 Node 服务

```bash
sudo npm install -g pm2
cd /opt/repair-h5-dingtalk
pm2 start npm --name xinyu-h5 -- start
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的 sudo 命令，使服务随 ECS 启动。

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
