# Linux 管理员密码重置

Linux 版本的管理员账号保存在：

```text
linux-data/r2/_system/admin-users.json
```

如果 `admin` 或其他管理员忘记密码，SSH 到服务器并进入项目目录：

```bash
npm run admin:reset -- admin 新密码
```

也可以直接调用脚本：

```bash
node scripts/reset-admin-password.js admin 新密码
```

重置普通管理员：

```bash
npm run admin:reset -- teacher01 临时密码
```

脚本会读取 `.env` 中的：

```text
LINUX_DATA_DIR
LINUX_R2_DIR
```

未配置时默认修改：

```text
linux-data/r2/_system/admin-users.json
```

如果服务由 PM2 托管，重置后建议重启：

```bash
pm2 restart ai-xuewei
```

注意：`admin` 主账号无法在后台被其他管理员重置，必须通过这个服务器脚本或直接修改部署数据来恢复。
