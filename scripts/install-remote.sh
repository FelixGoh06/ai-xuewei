#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${AI_XUEWEI_REPO_URL:-}"
BRANCH="${AI_XUEWEI_BRANCH:-main}"
INSTALL_DIR="${AI_XUEWEI_INSTALL_DIR:-/opt/ai-xuewei}"
APP_NAME="${AI_XUEWEI_APP_NAME:-ai-xuewei}"
PORT="${AI_XUEWEI_PORT:-3000}"
ADMIN_PASSWORD="${AI_XUEWEI_ADMIN_PASSWORD:-123456}"

usage() {
  cat <<'EOF'
AI学委 remote one-line installer

Usage:
  curl -fsSL <raw-install-remote-url> | bash -s -- --repo <git-url> [options]

Options:
  --repo <git-url>          Git repository URL, required unless AI_XUEWEI_REPO_URL is set.
  --branch <branch>         Git branch, default: main
  --dir <path>              Install directory, default: /opt/ai-xuewei
  --name <name>             PM2 app name, default: ai-xuewei
  --port <port>             Listen port, default: 3000
  --admin-password <pwd>    Initial admin password, default: 123456
  -h, --help                Show help

Example:
  curl -fsSL https://raw.githubusercontent.com/<user>/ai-xuewei/main/scripts/install-remote.sh | bash -s -- --repo https://github.com/<user>/ai-xuewei.git
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
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

if [[ -z "$REPO_URL" ]]; then
  echo "Missing --repo <git-url>." >&2
  usage
  exit 1
fi

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

install_git_if_needed() {
  if need_cmd git; then
    return
  fi
  if need_cmd apt-get; then
    sudo_cmd apt-get update
    sudo_cmd apt-get install -y git
  else
    echo "git is required. Please install git manually." >&2
    exit 1
  fi
}

install_git_if_needed

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Existing repository found: $INSTALL_DIR"
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  sudo_cmd mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -e "$INSTALL_DIR" ]]; then
    echo "$INSTALL_DIR already exists but is not a git repository." >&2
    exit 1
  fi
  sudo_cmd git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  sudo_cmd chown -R "$(id -u):$(id -g)" "$INSTALL_DIR" 2>/dev/null || true
  cd "$INSTALL_DIR"
fi

bash install.sh --name "$APP_NAME" --port "$PORT" --admin-password "$ADMIN_PASSWORD"
