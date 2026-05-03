# AI学委作业提交与管理系统

AI学委是一套面向课程作业收集、提交管理和在线审阅的轻量系统。它可以部署在 Linux 服务器上，也可以部署到 Cloudflare Pages，适合班级、课程小组、实验课、社团或个人教学场景使用。

## 主要特性

- 学生端登录、首次改密、作业提交、提交历史、在线预览和撤回。
- 管理端科目/作业管理、学生库、班级筛选、提交统计、截止时间、作业要求、后缀限制、命名模板、免交名单。
- 管理端文件预览、下载、删除、评分评语、查重和审计日志。
- 全局公告和顶部弹幕公告展示。
- 学生端 AI 助手与后台 AI 助手。
- 后台模型配置中心，支持 OpenAI 兼容接口，例如 OpenAI、OpenRouter 等。
- 管理员账号体系，`admin` 主账号可新增普通管理员并重置普通管理员密码。
- 支持 Linux 私有化部署和 Cloudflare Pages + R2 + D1 部署。
- 内置 OpenClaw skill，可让 OpenClaw 通过后台 API 查询和操作系统功能。

默认管理员账号：

```text
账号：admin
密码：123456
```

首次部署后请立即进入后台修改密码。

## 在线入口

部署完成后常用入口如下：

```text
/login    登录页
/         学生端
/admin    管理端
```

## 一键 Linux 安装

在 Ubuntu/Debian 服务器上可直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/FelixGoh06/ai-xuewei/main/scripts/install-remote.sh | bash -s -- --repo https://github.com/FelixGoh06/ai-xuewei.git
```

自定义端口和初始管理员密码：

```bash
curl -fsSL https://raw.githubusercontent.com/FelixGoh06/ai-xuewei/main/scripts/install-remote.sh | bash -s -- \
  --repo https://github.com/FelixGoh06/ai-xuewei.git \
  --port 8080 \
  --admin-password 'MyStrongPassword123'
```

安装脚本会自动完成：

- 检查并安装 Node.js 20。
- 拉取本仓库源码。
- 生成 `.env` 配置。
- 安装 npm 依赖。
- 创建本地数据目录 `linux-data/`。
- 安装并使用 PM2 启动服务。

安装完成后访问：

```text
http://服务器IP:3000/login
http://服务器IP:3000/admin
```

如果指定了 `--port 8080`，端口改为 `8080`。

## Linux 手动部署

### 1. 安装 Node.js

需要 Node.js 20 或更高版本：

```bash
node -v
```

Ubuntu/Debian 可使用：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. 克隆项目

```bash
cd /opt
git clone https://github.com/FelixGoh06/ai-xuewei.git
cd ai-xuewei
```

### 3. 安装依赖

```bash
npm install --omit=dev
```

### 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

至少需要配置：

```text
PORT=3000
LINUX_DATA_DIR=./linux-data
LINUX_R2_DIR=./linux-data/r2
LINUX_DB_PATH=./linux-data/app.db

ADMIN_SESSION_SECRET=replace-with-a-long-random-secret
DELETE_TOKEN_SECRET=replace-with-a-long-random-secret
STUDENT_SESSION_SECRET=replace-with-a-long-random-secret

ADMIN_USERS={"admin":"123456"}
ALLOWED_EXTENSIONS=.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip
```

建议使用随机密钥：

```bash
openssl rand -hex 32
```

### 5. 启动

```bash
npm start
```

使用 PM2 后台运行：

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

## Nginx 反向代理

示例配置：

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

启用 HTTPS 可使用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Linux 数据与备份

Linux 版本默认将数据写入：

```text
linux-data/
  app.db
  r2/
```

备份时至少保留：

```text
.env
linux-data/
```

升级前建议执行：

```bash
pm2 stop ai-xuewei
cp -a linux-data linux-data.backup.$(date +%Y%m%d-%H%M%S)
cp .env .env.backup.$(date +%Y%m%d-%H%M%S)
git pull
npm install --omit=dev
pm2 restart ai-xuewei
```

## Linux 卸载

保留数据，仅移除 PM2 服务：

```bash
bash uninstall.sh
```

同时删除 `.env` 和 `linux-data/`：

```bash
bash uninstall.sh --remove-data
```

如需删除项目目录：

```bash
cd /opt
rm -rf ai-xuewei
```

如果配置了 Nginx，删除对应站点配置后重载：

```bash
sudo rm -f /etc/nginx/sites-enabled/ai-xuewei
sudo rm -f /etc/nginx/sites-available/ai-xuewei
sudo nginx -t
sudo systemctl reload nginx
```

## 忘记管理员密码

Linux 部署可在服务器项目目录执行：

```bash
npm run admin:reset -- admin 新密码
pm2 restart ai-xuewei
```

普通管理员也可以用同一脚本重置：

```bash
npm run admin:reset -- teacher01 临时密码
pm2 restart ai-xuewei
```

## Cloudflare Pages 部署

Cloudflare 版本使用：

- Pages：托管前端和 Functions。
- R2：保存提交文件和系统 JSON。
- D1：保存学生库、学生密码、命名规则等结构化数据。

### 1. 创建资源

在 Cloudflare Dashboard 创建：

- 一个 Pages 项目。
- 一个 R2 Bucket。
- 一个 D1 Database。

### 2. 准备 wrangler 配置

```bash
cp wrangler.toml.example wrangler.toml
```

编辑：

```toml
name = "ai-xuewei"
pages_build_output_dir = "./public"
compatibility_date = "2026-04-23"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-r2-bucket"

[[d1_databases]]
binding = "DB"
database_name = "your-d1-name"
database_id = "your-d1-id"
```

绑定名必须保持：

```text
R2_BUCKET
DB
```

### 3. 配置环境变量

Cloudflare Pages 环境变量至少需要：

```text
ADMIN_SESSION_SECRET=replace-with-a-long-random-secret
DELETE_TOKEN_SECRET=replace-with-a-long-random-secret
STUDENT_SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_USERS={"admin":"123456"}
ALLOWED_EXTENSIONS=.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip
```

可选 AI 配置：

```text
OPENAI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_LIGHT_MODEL=
AI_HEAVY_MODEL=
AI_TIMEOUT_MS=20000
```

也可以上线后在后台“模型配置中心”维护模型配置。只有 `admin` 主账号可以配置模型。

### 4. 本地预览

```bash
npx wrangler pages dev public
```

### 5. 部署

```bash
npx wrangler pages deploy public --project-name ai-xuewei
```

也可以在 Cloudflare Pages Dashboard 连接 GitHub 仓库：

- Build command 留空。
- Build output directory 填 `public`。
- Functions directory 使用默认 `functions`。
- 绑定 R2：`R2_BUCKET`。
- 绑定 D1：`DB`。
- 配置环境变量。

## OpenClaw Skill

仓库内置：

```text
openclaw-homework-skill/
```

这个 skill 可通过后台 API 操作 AI学委，包括：

- 查询全部或单个作业提交情况。
- 查询学生库和班级名单。
- 新增、删除学生，删除整班学生。
- 给学生作业评分。
- 创建或删除作业。
- 设置截止时间、命名模板、作业要求、允许后缀、适用班级。
- 修改公告、AI 规则、模型配置。
- 查询审计日志。

### 安装依赖

```bash
cd openclaw-homework-skill
pip install -r requirements.txt
```

### 配置连接信息

Linux 本机部署：

```bash
export AI_XUEWEI_BASE_URL=http://127.0.0.1:3000
export AI_XUEWEI_ADMIN_USER=admin
export AI_XUEWEI_ADMIN_PASSWORD=123456
```

Cloudflare 部署：

```bash
export AI_XUEWEI_BASE_URL=https://your-domain.com
export AI_XUEWEI_ADMIN_USER=admin
export AI_XUEWEI_ADMIN_PASSWORD=your-password
```

也可以使用后台 token：

```bash
export AI_XUEWEI_ADMIN_TOKEN=your-token
```

### 测试

```bash
python tools/check_homework.py submissions --all
python tools/check_homework.py students list
python tools/check_homework.py ask --message "查询所有作业提交情况"
```

### 安装到 OpenClaw

将 `openclaw-homework-skill` 整个目录复制到 OpenClaw 的 skills 目录，例如：

```bash
mkdir -p ~/.openclaw/skills
cp -a openclaw-homework-skill ~/.openclaw/skills/
```

然后重启 OpenClaw 或刷新 skill 列表。

## 目录结构

```text
public/                         前端页面和静态资源
functions/api/                  Cloudflare Pages Functions 业务接口
linux-adapter/                  Linux 本地 R2/D1 适配层
scripts/                        远程安装和维护脚本
openclaw-homework-skill/        OpenClaw 后台操作 skill
server.js                       Linux Node.js 服务入口
install.sh                      Linux 本地安装脚本
uninstall.sh                    Linux 卸载脚本
```

## 安全建议

- 上线后立即修改 `admin` 密码。
- 不要提交 `.env`、`.dev.vars`、API Key、真实 token 或运行数据。
- Linux 部署请定期备份 `linux-data/`。
- Cloudflare 部署请定期备份重要 R2 文件和 D1 数据。
- 普通管理员默认不能查看模型配置和管理员账号管理。
- 涉及删除、重置密码、模型 API Key 的操作应由可信管理员执行。

## 常见问题

### 模型配置测试失败怎么办？

检查 Base URL、模型名、API Key、模型额度和 Provider 状态。OpenRouter 常用 Base URL：

```text
https://openrouter.ai/api/v1
```

### 学生库班级筛选无效怎么办？

学生库字段建议使用：

```text
classname,name,id
```

班级值建议使用：

```text
01
02
03
```

### Linux 上文件上传失败怎么办？

检查 Nginx 的上传限制：

```nginx
client_max_body_size 100m;
```

同时确认项目目录和 `linux-data/` 对运行用户可写。

## License

本项目尚未指定开源许可证。公开使用或二次分发前，请根据实际需求补充 LICENSE。
