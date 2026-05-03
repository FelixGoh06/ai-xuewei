---
name: ai-xuewei-admin-operator
description: 操作 AI学委/GYFileHub 后端管理功能，包括查询作业提交、维护学生库、评分、作业设置、公告、AI 规则、模型配置、管理员账号和审计日志。适配 Cloudflare Pages 与 Linux 部署。
---

# AI学委 后端操作技能

当用户要求查询或操作 AI学委/GYFileHub 后台时使用本技能。不要再使用旧的固定名单逻辑；必须通过后台 API 读取真实数据。

## 连接方式

本技能通过 `tools/check_homework.py` 调用后台接口。Cloudflare 和 Linux 版本使用同一套 API，只需要改 Base URL：

- Cloudflare：`https://你的域名`
- Linux 本机：`http://127.0.0.1:3000`
- Linux 服务器：`http://服务器IP:端口` 或反代后的域名

优先从环境变量读取：

```bash
AI_XUEWEI_BASE_URL=http://127.0.0.1:3000
AI_XUEWEI_ADMIN_USER=admin
AI_XUEWEI_ADMIN_PASSWORD=123456
```

也可以使用已有 token：

```bash
AI_XUEWEI_ADMIN_TOKEN=...
```

## 常用命令

查询所有作业提交情况：

```bash
python tools/check_homework.py submissions --all
```

查询某个作业提交情况：

```bash
python tools/check_homework.py submissions --subject "作业名"
```

旧版兼容：

```bash
python tools/check_homework.py --all
python tools/check_homework.py --subject "作业名"
```

查询学生库或班级名单：

```bash
python tools/check_homework.py students list
python tools/check_homework.py students list --class-name "01"
```

新增、删除学生：

```bash
python tools/check_homework.py students add --name "张三" --id "001" --class-name "01"
python tools/check_homework.py students delete --name "张三"
python tools/check_homework.py students delete-class --class-name "03"
```

给学生评分：

```bash
python tools/check_homework.py grade save --subject "作业名" --name "张三" --score "95" --comment "完成较好"
```

作业设置：

```bash
python tools/check_homework.py subject create --subject "离散数学"
python tools/check_homework.py subject delete --subject "离散数学"
python tools/check_homework.py deadline set --subject "离散数学" --deadline "2026-05-02T23:59"
python tools/check_homework.py naming set --subject "离散数学" --template "{classname}-{name}-{id}"
python tools/check_homework.py requirement set --subject "离散数学" --content "提交 PDF 或 DOCX"
python tools/check_homework.py settings set --subject "离散数学" --extensions "pdf,docx" --classes "01,02"
```

公告、AI 规则、模型、管理员：

```bash
python tools/check_homework.py notice set --title "通知" --content "明天截止"
python tools/check_homework.py ai-rules set --subject "离散数学" --requirements "按步骤检查推导"
python tools/check_homework.py model test
python tools/check_homework.py admin list
```

## 自然语言后端操作

如果用户表达的操作没有对应的专用命令，使用后台 AI 助手入口：

```bash
python tools/check_homework.py ask --message "把 01 班张三加入离散数学免交名单"
```

后台 AI 已内置后端能力清单，会执行可支持的增删改查。涉及删除、改密码、模型配置、管理员账号等高风险操作时，必须让用户明确对象和动作，不要凭空补参数。

## 能力范围

本技能应覆盖后台能做的主要操作：

- 总览：列出科目/作业、查看总体提交率。
- 提交：查询单个或全部作业提交情况，列提交文件。
- 科目/作业：新增、删除、设置截止时间、命名模板、作业要求、允许后缀、查重模式、适用班级、免交学生。
- 学生库：查询班级名单、新增/删除学生、删除整班学生、修改字段、重置学生密码。
- 文件：列文件、删除提交文件、下载/预览链接由后台提供。
- 评分：保存某个学生某个作业的分数和评语。
- 公告：修改标题、内容、发布时间、过期时间。
- AI：修改全局或单科 AI 规则，测试/维护模型配置。
- 管理员：admin 主账号可新增管理员、重置管理员密码；普通管理员只能改自己的密码。
- 审计：查看最近操作日志。

## 输出要求

工具输出 JSON。回答用户时要把 JSON 里的关键结果转成人能读懂的中文，不要直接甩大段原始 JSON，除非用户要求。
