#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ai-xuewei"
REMOVE_DATA="0"

usage() {
  cat <<'EOF'
AI学委 Linux uninstaller

Usage:
  bash uninstall.sh [options]

Options:
  --name <name>     PM2 app name, default: ai-xuewei
  --remove-data     Also remove .env and linux-data/
  -h, --help        Show help

Examples:
  bash uninstall.sh
  bash uninstall.sh --remove-data
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      APP_NAME="${2:-}"
      shift 2
      ;;
    --remove-data)
      REMOVE_DATA="1"
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

if command -v pm2 >/dev/null 2>&1 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 stop "$APP_NAME" || true
  pm2 delete "$APP_NAME" || true
  pm2 save || true
  echo "PM2 service removed: $APP_NAME"
else
  echo "No PM2 service named $APP_NAME found."
fi

if [[ "$REMOVE_DATA" == "1" ]]; then
  rm -rf linux-data .env
  echo "Removed linux-data/ and .env."
else
  echo "Kept linux-data/ and .env. Use --remove-data to delete them."
fi

echo "Uninstall step completed. Remove this project directory manually if no longer needed."
