AI学委/OpenClaw 后端操作 Skill

配置环境变量：
AI_XUEWEI_BASE_URL=http://127.0.0.1:3000
AI_XUEWEI_ADMIN_USER=admin
AI_XUEWEI_ADMIN_PASSWORD=123456

或使用：
AI_XUEWEI_ADMIN_TOKEN=...

示例：
python tools/check_homework.py submissions --all
python tools/check_homework.py students list --class-name 01
python tools/check_homework.py ask --message "查询 test 作业提交情况"
