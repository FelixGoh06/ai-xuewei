#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ai-xuewei"
PORT="3000"
ADMIN_PASSWORD="123456"
USE_PM2="1"
FORCE_ENV="0"

usage() {
  cat <<'EOF'
AI学委 Linux one-click installer

Usage:
  bash install.sh [options]

Options:
  --name <name>             PM2 app name, default: ai-xuewei
  --port <port>             Listen port, default: 3000
  --admin-password <pwd>    Initial admin password, default: 123456
  --no-pm2                  Start with npm only, do not install/use PM2
  --force-env               Overwrite existing .env
  -h, --help                Show help

Examples:
  bash install.sh
  bash install.sh --port 8080 --admin-password 'MyStrongPassword123'
  bash install.sh --no-pm2
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      APP_NAME="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --admin-password)
      ADMIN_PASSWORD="${2:-}"
      shift 2
      ;;
    --no-pm2)
      USE_PM2="0"
      shift
      ;;
    --force-env)
      FORCE_ENV="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

sudo_cmd() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    echo "This step needs root permission, but sudo is not available." >&2
    exit 1
  fi
}

node_major() {
  if ! need_cmd node; then
    echo 0
    return
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

install_node_if_needed() {
  local major
  major="$(node_major)"
  if [[ "$major" -ge 20 ]]; then
    echo "Node.js $(node -v) detected."
    return
  fi

  echo "Node.js 20+ is required. Installing Node.js 20..."
  if need_cmd apt-get; then
    sudo_cmd apt-get update
    sudo_cmd apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo_cmd bash -
    sudo_cmd apt-get install -y nodejs
  else
    echo "Unsupported package manager. Please install Node.js 20+ manually, then run this script again." >&2
    exit 1
  fi
}

random_secret() {
  if need_cmd openssl; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

json_escape() {
  node -e "process.stdout.write(JSON.stringify(process.argv[1]).slice(1,-1))" "$1"
}

write_env() {
  if [[ -f ".env" && "$FORCE_ENV" != "1" ]]; then
    echo ".env already exists, keeping it. Use --force-env to regenerate."
    return
  fi

  local escaped_password
  escaped_password="$(json_escape "$ADMIN_PASSWORD")"
  cat > .env <<EOF
PORT=$PORT
LINUX_DATA_DIR=./linux-data
LINUX_R2_DIR=./linux-data/r2
LINUX_DB_PATH=./linux-data/app.db

ADMIN_SESSION_SECRET=$(random_secret)
DELETE_TOKEN_SECRET=$(random_secret)
STUDENT_SESSION_SECRET=$(random_secret)

ADMIN_USERS={"admin":"$escaped_password"}

COMPLEX_SUBJECTS=
ALLOWED_NAMES=
ALLOWED_EXTENSIONS=.pdf,.doc,.docx,.jpg,.jpeg,.png,.zip

OPENAI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_LIGHT_MODEL=
AI_HEAVY_MODEL=
AI_TIMEOUT_MS=20000
EOF
  chmod 600 .env || true
  echo ".env generated."
}

install_dependencies() {
  echo "Installing npm dependencies..."
  npm install --omit=dev
}

start_service() {
  mkdir -p linux-data/r2
  if [[ "$USE_PM2" == "1" ]]; then
    if ! need_cmd pm2; then
      echo "Installing PM2..."
      sudo_cmd npm install -g pm2
    fi
    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
      pm2 restart "$APP_NAME" --update-env
    else
      pm2 start server.js --name "$APP_NAME" --update-env
    fi
    pm2 save || true
    echo "PM2 service started: $APP_NAME"
  else
    echo "PM2 disabled. Starting foreground server with npm start."
    echo "Press Ctrl+C to stop."
    npm start
  fi
}

install_node_if_needed
write_env
install_dependencies
start_service

cat <<EOF

AI学委 installation completed.

Local URLs:
  http://127.0.0.1:$PORT/login
  http://127.0.0.1:$PORT/
  http://127.0.0.1:$PORT/admin

Initial admin:
  username: admin
  password: $ADMIN_PASSWORD

Please log in and change the admin password immediately.
EOF
