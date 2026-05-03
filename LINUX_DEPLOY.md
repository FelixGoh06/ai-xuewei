# Linux 部署教程

本项目的 Linux 版本复用 `functions/api/` 中的业务接口，通过 `server.js` 把 Node HTTP 请求转换成 Web `Request`，再调用原 Pages Functions 逻辑。

## 数据映射

```text
Cloudflare R2_BUCKET -> linux-data/r2/
Cloudflare DB        -> linux-data/app.db
```

## 一键安装

解压发布包后进入目录：

```bash
cd /opt/ai-xuewei
bash install.sh
```

常用参数：

```bash
bash install.sh --port 8080
bash install.sh --admin-password 'MyStrongPassword123'
bash install.sh --no-pm2
```

脚本会自动检查 Node.js 20、生成 `.env`、安装依赖、创建 `linux-data/`，并使用 PM2 启动服务。

## 手动安装

服务器需要 Node.js 20 或更高版本。

```bash
npm install --omit=dev
```

## 配置

```bash
cp .env.example .env
nano .env
```

至少配置：

```text
PORT=3000
LINUX_DATA_DIR=./linux-data
LINUX_R2_DIR=./linux-data/r2
LINUX_DB_PATH=./linux-data/app.db
ADMIN_SESSION_SECRET=replace-with-a-long-random-secret
DELETE_TOKEN_SECRET=replace-with-a-long-random-secret
STUDENT_SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_USERS={"admin":"123456"}
```

上线后请立刻登录后台修改 `admin` 密码。

## 启动

```bash
npm start
```

默认访问：

```text
http://服务器IP:3000/login
http://服务器IP:3000/
http://服务器IP:3000/admin
```

## PM2 守护

```bash
sudo npm install -g pm2
pm2 start server.js --name ai-xuewei
pm2 save
pm2 startup
```

常用命令：

```bash
pm2 logs ai-xuewei
pm2 restart ai-xuewei
pm2 stop ai-xuewei
```

## Nginx 反代

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 备份

至少备份：

```text
.env
linux-data/
```

## 卸载

一键卸载：

```bash
bash uninstall.sh
```

删除服务并移除 `.env`、`linux-data/`：

```bash
bash uninstall.sh --remove-data
```

手动卸载步骤如下。

如果使用 PM2：

```bash
pm2 stop ai-xuewei
pm2 delete ai-xuewei
pm2 save
```

删除项目目录：

```bash
rm -rf /opt/ai-xuewei
```

如果配置了 Nginx，删除站点配置并重载：

```bash
sudo rm -f /etc/nginx/sites-enabled/ai-xuewei
sudo rm -f /etc/nginx/sites-available/ai-xuewei
sudo nginx -t
sudo systemctl reload nginx
```

删除前如需保留数据，请先备份 `.env` 和 `linux-data/`。
