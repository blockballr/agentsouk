#!/usr/bin/env bash
# Deploy Agent Souk to an Oracle VPS (Ubuntu arm64).
# Usage: ./deploy.sh user@VPS-IP
# Prereq: edit deploy/.env first (copy from .env.example).
set -euo pipefail

REMOTE="${1:?Usage: ./deploy.sh user@VPS-IP}"
APP_DIR="/opt/agent-souk"
LOCAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Syncing repo to $REMOTE:$APP_DIR =="
ssh "$REMOTE" "sudo mkdir -p $APP_DIR && sudo chown \$(whoami) $APP_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude dist \
  --exclude .git --exclude .vercel --exclude deploy/.env \
  "$LOCAL_REPO/" "$REMOTE:$APP_DIR/"

echo "==> Installing Docker + compose plugin if missing =="
ssh "$REMOTE" bash -s <<'EOF'
  if ! command -v docker >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose-plugin
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$(whoami)"
  fi
EOF

echo "==> Copying deploy/.env =="
scp deploy/.env "$REMOTE:$APP_DIR/deploy/.env"

echo "==> Building and starting the stack =="
ssh "$REMOTE" "cd $APP_DIR/deploy && docker compose build && docker compose up -d"

echo "==> Done. Marketplace at http://<VPS-IP>/  (api proxied at /api)"
