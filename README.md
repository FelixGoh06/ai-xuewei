# AI学委 作业提交与管理系统

AI学委是一个面向课程作业收集、审阅和后台管理的轻量系统。项目同时支持两种部署方式：

- Linux 私有化部署：使用 Node.js + 本地 SQLite + 本地文件存储。
- Cloudflare Pages 部署：使用 Pages Functions + R2 + D1。

默认管理员账号为 `admin`，默认密码为 `123456`。首次上线后请立刻进入后台修改密码。

## 功能介绍

### 学生端

- 统一登录：学生可使用学号、姓名或用户名登录。
- 首次改密：默认密码登录后可强制修改密码。
- 作业列表：按当前学生所属班级展示适用作业。
- 作业提交：支持拖拽上传、文件大小限制、后缀预检和提交进度提示。
- 提交历史：查看个人提交记录，支持按科目和日期筛选。
- 在线预览：历史记录可预览图片、PDF、文本等文件，支持缩放、拖动和下载。
- 撤回提交：在允许范围内撤回误传文件。
- 公告弹幕：顶部展示公告，点击可查看完整公告。
- 学生 AI 助手：帮助理解作业要求、梳理思路和检查结构。

### 管理端

- 总览仪表盘：查看科目数量、学生库人数和所有作业总提交率。
- 作业/科目管理：新增、删除科目，查看每个作业提交进度。
- 适用班级：每个作业可指定一个或多个班级，提交率只统计对应班级学生。
- 截止时间：为每个作业设置或清除截止时间。
- 作业要求：为每个作业维护学生端展示的要求说明。
- 文件管理：查看、预览、下载、删除学生提交文件。
- 查重：对指定文件执行查重，并保存结果。
- 命名模板：按 `{classname}`、`{name}`、`{id}`、`{subject}`、`{originalBase}` 等占位符设置提交命名规则。
- 后缀限制：按作业设置允许上传的文件后缀。
- 免交名单：为指定学生设置某个作业免交。
- 学生库：维护字段、班级、姓名、学号；支持批量新增、文本导入、删除、重置学生密码。
- 评分评语：为某个学生的某个作业保存分数和评语。
- 公告管理：维护全局公告标题、内容、发布时间和过期时间。
- 全局/单科 AI 规则：配置 AI 助手的回答规则、FAQ 和示例。
- 模型配置中心：由 `admin` 主账号配置 Base URL、API Key、轻量模型、重模型、Embedding 模型和超时。
- 后台 AI 助手：可查询提交情况、跳转入口、操作学生库、设置作业规则、评分、公告等后台能力。
- 管理员账号：`admin` 主账号可新增普通管理员、重置普通管理员密码；普通管理员只能修改自己的密码。
- 审计日志：记录后台关键操作，便于追踪变更。

### OpenClaw Skill

项目内置 `openclaw-homework-skill/`。这个 skill 不是只查作业提交，而是可通过后台 API 操作 AI学委的主要后台能力，包括查提交、学生库增删改查、评分、作业设置、公告、模型配置、管理员和审计日志。Cloudflare 与 Linux 部署共用同一套 API，只需要配置不同的 Base URL。

## 目录结构

```text
public/                         前端页面和静态资源
  index.html                    学生端主页
  login.html                    登录页
  admin.html                    管理后台
  assets/                       拆分后的 CSS 和 JS

functions/api/                  Cloudflare Pages Functions 业务接口
  admin/                        管理端登录、鉴权、核心后台接口
  student/                      学生登录、鉴权、改密、资料接口
  upload.js                     作业上传接口
  history.js                    学生提交历史
  submitted.js                  提交统计
  *-store.js                    R2/D1 数据读写模块

linux-adapter/                  Linux 本地 R2/D1 适配层
server.js                       Linux Node.js 服务入口
scripts/reset-admin-password.js Linux 管理员密码重置脚本
openclaw-homework-skill/        OpenClaw 后台操作 skill
```

## 运行要求

- Node.js 20 或更高版本。
- Linux 部署需要可写目录保存数据。
- Cloudflare 部署需要 Cloudflare Pages、R2 Bucket、D1 Database。
- OpenClaw skill 需要 Python 3 和 `requests`。

## 一、Linux 部署教程

以下命令以 Ubuntu/Debian 为例，其他 Linux 发行版命令类似。

### GitHub 一行命令安装

如果你把项目托管到 GitHub，可以使用远程安装脚本实现一行安装。把下面命令中的 `<user>` 改成你的 GitHub 用户名或组织名：

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/ai-xuewei/main/scripts/install-remote.sh | bash -s -- --repo https://github.com/<user>/ai-xuewei.git
```

常用参数：

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/ai-xuewei/main/scripts/install-remote.sh | bash -s -- \
  --repo https://github.com/<user>/ai-xuewei.git \
  --port 8080 \
  --admin-password 'MyStrongPassword123'
```

这个远程脚本会自动拉取 GitHub 源码，然后调用项目内的 `install.sh` 完成本地安装。

### 0. 一键安装

解压发布包后进入目录：

```bash
cd /opt/ai-xuewei
bash install.sh
```

这个脚本会自动完成：

- 检查 Node.js 版本，Ubuntu/Debian 下会自动安装 Node.js 20。
- 生成 `.env`，默认管理员为 `admin / 123456`。
- 安装 npm 依赖。
- 创建 `linux-data/` 数据目录。
- 安装并使用 PM2 启动服务。

常用参数：

```bash
bash install.sh --port 8080
bash install.sh --admin-password 'MyStrongPassword123'
bash install.sh --name ai-xuewei
bash install.sh --no-pm2
bash install.sh --force-env
```

安装完成后访问：

```text
http://服务器IP:端口/login
http://服务器IP:端口/admin
```

如果你使用一键安装，后面的“安装依赖、配置环境变量、启动服务”可以跳过；需要自定义部署时再按手动步骤执行。

### 1. 手动安装 Node.js 20

```bash
node -v
```

如果版本低于 20，可使用 NodeSource：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. 上传项目

把发布包上传到服务器，例如：

```bash
scp ai-xuewei-deploy-*.zip root@你的服务器IP:/opt/
```

在服务器解压：

```bash
cd /opt
unzip ai-xuewei-deploy-*.zip
cd ai-xuewei
```

如果你是直接用源码目录，也进入项目根目录即可。

### 3. 安装依赖

```bash
npm install --omit=dev
```

### 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

至少修改这些项：

```text
PORT=3000
LINUX_DATA_DIR=./linux-data
LINUX_R2_DIR=./linux-data/r2
LINUX_DB_PATH=./linux-data/app.db

ADMIN_SESSION_SECRET=请改成一段足够长的随机字符串
DELETE_TOKEN_SECRET=请改成一段足够长的随机字符串
STUDENT_SESSION_SECRET=请改成一段足够长的随机字符串

ADMIN_USERS={"admin":"123456"}
ALLOWED_EXTENSIONS=.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip
```

说明：

- 首次部署可保留 `ADMIN_USERS={"admin":"123456"}`，进入后台后再改密码。
- 密钥建议使用随机字符串，例如 `openssl rand -hex 32`。
- 真实 `.env` 不要提交到公开仓库。

### 5. 启动服务

```bash
npm start
```

默认访问地址：

```text
http://服务器IP:3000/login
http://服务器IP:3000/
http://服务器IP:3000/admin
```

### 6. 使用 PM2 后台运行

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

### 7. Nginx 反向代理

安装 Nginx：

```bash
sudo apt install -y nginx
```

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

启用并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如需 HTTPS，可使用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 8. Linux 数据位置

默认数据保存在：

```text
linux-data/
  app.db                         学生库、学生密码等 SQLite 数据
  r2/                            本地文件对象存储
    _system/admin-users.json     管理员账号数据
```

备份时至少备份整个 `linux-data/` 和 `.env`。

### 9. Linux 管理员密码忘记怎么办

SSH 登录服务器，进入项目目录：

```bash
node scripts/reset-admin-password.js admin 新密码
```

或：

```bash
npm run admin:reset -- admin 新密码
```

如果使用 PM2，执行后重启：

```bash
pm2 restart ai-xuewei
```

### 10. Linux 升级

建议流程：

```bash
pm2 stop ai-xuewei
cp -a linux-data linux-data.backup.$(date +%Y%m%d-%H%M%S)
cp .env .env.backup.$(date +%Y%m%d-%H%M%S)
```

替换新版本代码后：

```bash
npm install --omit=dev
pm2 restart ai-xuewei
```

不要覆盖旧服务器上的 `.env` 和 `linux-data/`。

### 11. Linux 卸载

一键卸载 PM2 服务：

```bash
bash uninstall.sh
```

连同 `.env` 和 `linux-data/` 一起删除：

```bash
bash uninstall.sh --remove-data
```

如果你是手动部署，也可以按下面步骤卸载。

如果使用 PM2：

```bash
pm2 stop ai-xuewei
pm2 delete ai-xuewei
pm2 save
```

删除项目文件：

```bash
cd /opt
rm -rf ai-xuewei
```

如果配置了 Nginx，删除对应站点配置并重载：

```bash
sudo rm -f /etc/nginx/sites-enabled/ai-xuewei
sudo rm -f /etc/nginx/sites-available/ai-xuewei
sudo nginx -t
sudo systemctl reload nginx
```

如果你希望保留数据，请在删除项目前先备份：

```bash
cp -a /opt/ai-xuewei/linux-data /opt/ai-xuewei-linux-data-backup
cp /opt/ai-xuewei/.env /opt/ai-xuewei-env-backup
```

## 二、Cloudflare Pages 部署教程

### 1. 准备 Cloudflare 资源

需要创建：

- Cloudflare Pages 项目。
- 一个 R2 Bucket，用于保存作业文件和系统 JSON。
- 一个 D1 Database，用于保存学生库、学生密码、命名规则等。

### 2. 创建 R2 Bucket

在 Cloudflare Dashboard：

```text
R2 Object Storage -> Create bucket
```

记录 bucket 名称。

### 3. 创建 D1 Database

在 Cloudflare Dashboard：

```text
D1 SQL Database -> Create database
```

记录 database name 和 database id。

### 4. 准备 wrangler 配置

本地复制示例：

```bash
cp wrangler.toml.example wrangler.toml
```

修改：

```toml
name = "ai-xuewei"
pages_build_output_dir = "./public"
compatibility_date = "2026-04-23"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "你的-r2-bucket"

[[d1_databases]]
binding = "DB"
database_name = "你的-d1-name"
database_id = "你的-d1-id"
```

绑定名必须是：

- R2：`R2_BUCKET`
- D1：`DB`

### 5. 配置环境变量

Cloudflare Pages 的环境变量可在 Dashboard 里配置，也可本地用 `.dev.vars` 开发。

本地开发示例：

```bash
cp .dev.vars.example .dev.vars
```

需要配置：

```text
ADMIN_SESSION_SECRET=请改成随机字符串
DELETE_TOKEN_SECRET=请改成随机字符串
STUDENT_SESSION_SECRET=请改成随机字符串
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

也可以上线后由后台 `模型配置中心` 配置模型。只有 `admin` 主账号能看到和修改模型配置。

### 6. 本地预览 Cloudflare 版本

```bash
npx wrangler pages dev public
```

常用入口：

```text
http://localhost:8788/login
http://localhost:8788/
http://localhost:8788/admin
```

### 7. 部署到 Cloudflare Pages

命令行部署：

```bash
npx wrangler pages deploy public --project-name ai-xuewei
```

也可以在 Cloudflare Pages Dashboard 连接 Git 仓库：

- Build command 留空。
- Build output directory 填 `public`。
- Functions directory 使用默认 `functions`。
- 配置 R2/D1 bindings 和环境变量。

### 8. Cloudflare 上线后检查

访问：

```text
https://你的域名/login
https://你的域名/admin
```

然后检查：

- `admin / 123456` 是否能登录。
- 后台是否能新增科目。
- 学生库是否能保存。
- 上传文件是否进入 R2。
- 提交率是否按学生库和适用班级统计。
- 模型配置测试是否成功。

### 9. Cloudflare 卸载

如果不再使用：

1. 在 Cloudflare Pages 删除项目。
2. 删除对应 R2 Bucket。
3. 删除对应 D1 Database。
4. 删除本地 `wrangler.toml`、`.dev.vars` 中的真实配置。

删除 R2 和 D1 前请确认是否需要导出数据或备份文件。

## OpenClaw Skill 打包与安装

发布包内包含：

```text
openclaw-homework-skill/
  SKILL.md
  requirements.txt
  tools/check_homework.py
```

### 1. 安装 Python 依赖

进入 skill 目录：

```bash
cd openclaw-homework-skill
pip install -r requirements.txt
```

### 2. 配置连接信息

Linux 本机部署：

```bash
export AI_XUEWEI_BASE_URL=http://127.0.0.1:3000
export AI_XUEWEI_ADMIN_USER=admin
export AI_XUEWEI_ADMIN_PASSWORD=123456
```

Cloudflare 部署：

```bash
export AI_XUEWEI_BASE_URL=https://你的域名
export AI_XUEWEI_ADMIN_USER=admin
export AI_XUEWEI_ADMIN_PASSWORD=你的密码
```

也可以使用后台 token：

```bash
export AI_XUEWEI_ADMIN_TOKEN=你的token
```

### 3. 测试 skill 工具

```bash
python tools/check_homework.py submissions --all
python tools/check_homework.py students list
python tools/check_homework.py ask --message "查询所有作业提交情况"
```

### 4. 安装到 OpenClaw

把整个 `openclaw-homework-skill` 文件夹复制到 OpenClaw 的 skills 目录。常见形式如下，具体路径以你的 OpenClaw 配置为准：

```bash
mkdir -p ~/.openclaw/skills
cp -a openclaw-homework-skill ~/.openclaw/skills/
```

如果 OpenClaw 使用项目级 skills 目录，也可以复制到项目配置要求的位置，例如：

```bash
cp -a openclaw-homework-skill /path/to/openclaw/skills/
```

安装后重启 OpenClaw 或刷新 skill 列表。

### 5. OpenClaw 中的使用方式

可以让 OpenClaw 调用 skill 完成：

- `查询 test 作业提交情况`
- `查询 01 班有哪些学生`
- `给张三的离散数学作业打 95 分，评语是完成较好`
- `删除 03 班所有学生`
- `把 test 作业允许后缀设置为 pdf,docx,jpg`
- `把公告改成明天截止`

skill 会通过后台 API 执行，结果以 JSON 返回，OpenClaw 应把关键结果转成中文说明。

## 发布包内容

建议发布包保留：

```text
public/
functions/
linux-adapter/
scripts/
openclaw-homework-skill/
server.js
package.json
package-lock.json
.env.example
.dev.vars.example
wrangler.toml.example
README.md
LINUX_ADMIN_RESET.md
LINUX_DEPLOY.md
```

发布包不应包含：

```text
node_modules/
linux-data/
.env
.dev.vars
.wrangler/
.vscode/
backup-*/
__pycache__/
*.pyc
```

## 安全建议

- 上线后立即修改 `admin` 密码。
- 不要把 `.env`、`.dev.vars`、API Key、真实 token 打包或提交。
- Linux 部署定期备份 `linux-data/`。
- Cloudflare 部署定期备份重要 R2 文件和 D1 数据。
- 普通管理员默认不能查看模型配置和管理员账号管理。
- 涉及删除、重置密码、模型 API Key 的操作应由可信管理员执行。

## 常见问题

### 页面刷新后回到总览怎么办？

当前后台会尽量记住所在板块。如果仍回到总览，检查浏览器 localStorage 是否被清理。

### 模型配置测试失败怎么办？

检查：

- Base URL 是否正确，例如 OpenRouter 常用 `https://openrouter.ai/api/v1`。
- 模型名是否存在并可用。
- API Key 是否有效。
- 免费模型是否达到限额或被 Provider 拒绝。

### Linux admin 忘记密码怎么办？

使用：

```bash
npm run admin:reset -- admin 新密码
pm2 restart ai-xuewei
```

### 学生库班级筛选无效怎么办？

学生库字段建议使用默认字段：

```text
classname,name,id
```

班级值建议保持 `01`、`02`、`03` 这种格式。
