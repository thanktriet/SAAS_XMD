#!/bin/bash
# ============================================================
# XMD_SAAS - Docker Deploy Script
# Dùng khi VPS đã có project khác chạy sẵn
# Usage: chmod +x deploy-docker.sh && ./deploy-docker.sh
# ============================================================

set -e

DOMAIN="${DOMAIN:-erp.ten-mien.vn}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

# ─── 1. Kiểm tra Docker ──────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  log "Cài Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  warn "Docker đã cài. Log out rồi log in lại, sau đó chạy lại script."
  exit 0
fi

if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
  log "Cài Docker Compose plugin..."
  sudo apt install -y docker-compose-plugin
fi

log "Docker $(docker --version | cut -d' ' -f3)"

# ─── 2. Tạo .env nếu chưa có ────────────────────────────────────────────────
if [ ! -f .env ]; then
  log "Tạo .env với secrets ngẫu nhiên..."
  cat > .env << EOF
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
FRONTEND_URL=http://${DOMAIN}:8080
EOF
  log ".env created — LƯU LẠI THÔNG TIN NÀY!"
  cat .env
  echo ""
fi

# ─── 3. Build frontend ───────────────────────────────────────────────────────
log "Build frontend..."
cd frontend
npm install --silent 2>/dev/null || true

# Đọc FRONTEND_URL từ .env
source ../.env
VITE_API_BASE_URL=http://${DOMAIN}:8080/api npm run build > /dev/null 2>&1
cd ..
log "Frontend built → frontend/dist/"

# ─── 4. Docker compose up ────────────────────────────────────────────────────
log "Starting Docker containers..."
docker compose down 2>/dev/null || true
docker compose up -d --build

# ─── 5. Đợi services healthy ─────────────────────────────────────────────────
log "Waiting for services..."
sleep 5

# Check API health
if curl -sf http://127.0.0.1:8080/api/health > /dev/null 2>&1; then
  log "API healthy ✓"
else
  warn "API chưa sẵn sàng, đợi thêm 10s..."
  sleep 10
  curl -sf http://127.0.0.1:8080/api/health && log "API healthy ✓" || warn "Kiểm tra logs: docker compose logs api"
fi

# ─── 6. Tạo admin account ────────────────────────────────────────────────────
log "Tạo admin account (nếu chưa có)..."
docker compose exec -T api node create-admin-local.js 2>/dev/null || true

# ─── 7. Hướng dẫn Nginx host ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ DOCKER DEPLOY HOÀN TẤT${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Containers:"
echo "    xmd-db   → PostgreSQL (127.0.0.1:5433)"
echo "    xmd-api  → Backend    (127.0.0.1:5050)"
echo "    xmd-web  → Frontend   (port 8080)"
echo ""
echo "  ─── TRUY CẬP ───"
echo ""
echo "  URL: http://${DOMAIN}:8080"
echo ""
echo "  Nếu không truy cập được, mở port 8080 trên firewall:"
echo "    sudo ufw allow 8080/tcp"
echo "    # Hoặc trên aaPanel: Security → Firewall → Add Rule → 8080"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
