#!/bin/bash
# ============================================================
# XMD_SAAS - Git-based Deploy (chạy trên VPS)
# Usage: ./deploy-git.sh
# Tự động pull code mới, build, restart services
# ============================================================

set -e

APP_DIR="/var/www/xmd-saas"
DOMAIN="${DOMAIN:-erp.ten-mien.vn}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

cd ${APP_DIR}

# ─── 1. Pull code mới ────────────────────────────────────────────────────────
log "Pulling latest code..."
git pull origin main

# ─── 2. Backend ──────────────────────────────────────────────────────────────
log "Installing backend dependencies..."
cd ${APP_DIR}/backend-production
npm install --production --silent

# ─── 3. Run new migrations (nếu có) ─────────────────────────────────────────
log "Running migrations..."
for f in migrations/*.sql; do
  if [ -f "$f" ]; then
    source ${APP_DIR}/backend-production/.env
    PGPASSWORD=${DB_PASSWORD} psql -U ${DB_USER} -d ${DB_NAME} -h ${DB_HOST} -f "$f" 2>/dev/null || true
  fi
done

# ─── 4. Frontend build ───────────────────────────────────────────────────────
log "Building frontend..."
cd ${APP_DIR}/frontend
npm install --silent
VITE_API_BASE_URL=https://${DOMAIN}/api npm run build > /dev/null 2>&1

# ─── 5. Restart services ─────────────────────────────────────────────────────
log "Restarting backend..."
pm2 restart xmd-api

log "Reloading Nginx..."
sudo nginx -t && sudo systemctl reload nginx

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Deploy thành công!${NC}"
echo "   Version: $(git log --oneline -1)"
echo "   Time:    $(date '+%Y-%m-%d %H:%M:%S')"
