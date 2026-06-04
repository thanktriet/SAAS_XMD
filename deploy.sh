#!/bin/bash
# ============================================================
# XMD_SAAS - Deploy Script
# Chạy trên VPS Linux (Ubuntu 22.04/24.04)
# Usage: chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -e

# ─── Config ───────────────────────────────────────────────────────────────────
APP_DIR="/var/www/xmd-saas"
DOMAIN="${DOMAIN:-erp.yourdomain.vn}"
DB_NAME="erp_xe_may_dien"
DB_USER="xmd_user"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
NODE_VERSION="20"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ─── 1. System packages ──────────────────────────────────────────────────────
log "Cài đặt system packages..."
sudo apt update -qq
sudo apt install -y -qq curl git nginx certbot python3-certbot-nginx ufw > /dev/null

# ─── 2. Node.js ──────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt $NODE_VERSION ]]; then
  log "Cài Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash - > /dev/null 2>&1
  sudo apt install -y -qq nodejs > /dev/null
fi
log "Node.js $(node -v)"

# PM2
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2 > /dev/null 2>&1
fi
log "PM2 $(pm2 -v)"

# ─── 3. PostgreSQL ───────────────────────────────────────────────────────────
if ! command -v psql &> /dev/null; then
  log "Cài PostgreSQL..."
  sudo apt install -y -qq postgresql postgresql-contrib > /dev/null
fi

# Tạo user + database
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
log "PostgreSQL: database ${DB_NAME} ready"

# ─── 4. App directory ────────────────────────────────────────────────────────
sudo mkdir -p ${APP_DIR}
sudo chown -R $USER:$USER ${APP_DIR}

# Copy code nếu chưa có
if [ ! -f "${APP_DIR}/backend-production/server.js" ]; then
  warn "Copy code vào ${APP_DIR}/ trước khi chạy script này"
  warn "Ví dụ: rsync -avz --exclude node_modules ./ ${APP_DIR}/"
  err "Không tìm thấy source code tại ${APP_DIR}/backend-production/server.js"
fi

# ─── 5. Database migration ───────────────────────────────────────────────────
log "Chạy database migration..."
cd ${APP_DIR}/backend-production

if [ -f "000_full_schema.sql" ]; then
  PGPASSWORD=${DB_PASS} psql -U ${DB_USER} -d ${DB_NAME} -h localhost -f 000_full_schema.sql 2>/dev/null || true
fi

if [ -f "migrations/001_license_system.sql" ]; then
  PGPASSWORD=${DB_PASS} psql -U ${DB_USER} -d ${DB_NAME} -h localhost -f migrations/001_license_system.sql 2>/dev/null || true
fi
log "Migration done"

# ─── 6. Backend setup ────────────────────────────────────────────────────────
log "Setup backend..."
cd ${APP_DIR}/backend-production
npm install --production --silent

mkdir -p uploads

# Tạo .env production
cat > .env << EOF
NODE_ENV=production
PORT=5000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_DAYS=7

MAX_LOGIN_ATTEMPTS=5
LOCKOUT_MINUTES=15

FRONTEND_URL=https://${DOMAIN}
UPLOAD_DIR=./uploads
EOF

log "Backend .env created"

# ─── 7. Frontend build ───────────────────────────────────────────────────────
log "Build frontend..."
cd ${APP_DIR}/frontend
npm install --silent
VITE_API_BASE_URL=https://${DOMAIN}/api npm run build > /dev/null 2>&1
log "Frontend built → dist/"

# ─── 8. PM2 ──────────────────────────────────────────────────────────────────
log "Starting backend with PM2..."
cd ${APP_DIR}/backend-production
pm2 delete xmd-api 2>/dev/null || true
pm2 start server.js --name xmd-api --env production
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER > /dev/null 2>&1 || true
log "PM2: xmd-api running"

# ─── 9. Nginx ────────────────────────────────────────────────────────────────
log "Configuring Nginx..."
sudo tee /etc/nginx/sites-available/xmd-saas > /dev/null << EOF
server {
    listen 80;
    server_name ${DOMAIN};

    # Frontend SPA
    root ${APP_DIR}/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
        client_max_body_size 5M;
    }

    # Static uploads
    location /uploads/ {
        alias ${APP_DIR}/backend-production/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
EOF

sudo ln -sf /etc/nginx/sites-available/xmd-saas /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
log "Nginx configured for ${DOMAIN}"

# ─── 10. Firewall ────────────────────────────────────────────────────────────
log "Configuring firewall..."
sudo ufw allow 22/tcp > /dev/null 2>&1
sudo ufw allow 80/tcp > /dev/null 2>&1
sudo ufw allow 443/tcp > /dev/null 2>&1
sudo ufw deny 5000/tcp > /dev/null 2>&1
echo "y" | sudo ufw enable > /dev/null 2>&1
log "Firewall: 22, 80, 443 open. 5000 blocked."

# ─── 11. SSL ─────────────────────────────────────────────────────────────────
warn "Để cài SSL, chạy:"
echo "  sudo certbot --nginx -d ${DOMAIN}"
echo ""

# ─── 12. Cron jobs ───────────────────────────────────────────────────────────
log "Setting up cron jobs..."
(crontab -l 2>/dev/null | grep -v "xmd-saas"; cat << EOF
# xmd-saas: Auto-expire branches (2AM daily)
0 2 * * * PGPASSWORD=${DB_PASS} psql -U ${DB_USER} -d ${DB_NAME} -h localhost -c "SELECT fn_expire_branches();" > /dev/null 2>&1
# xmd-saas: Cleanup old tokens (3AM Sunday)
0 3 * * 0 PGPASSWORD=${DB_PASS} psql -U ${DB_USER} -d ${DB_NAME} -h localhost -c "DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days';" > /dev/null 2>&1
# xmd-saas: Cleanup old login attempts (3AM Sunday)
5 3 * * 0 PGPASSWORD=${DB_PASS} psql -U ${DB_USER} -d ${DB_NAME} -h localhost -c "DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '30 days';" > /dev/null 2>&1
EOF
) | crontab -
log "Cron jobs configured"

# ─── 13. Backup script ───────────────────────────────────────────────────────
sudo mkdir -p /var/backups/xmd-saas
sudo tee /etc/cron.daily/xmd-backup > /dev/null << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/xmd-saas"
TIMESTAMP=$(date +%Y%m%d_%H%M)
# Database
PGPASSWORD=${DB_PASS} pg_dump -U ${DB_USER} -h localhost ${DB_NAME} | gzip > ${BACKUP_DIR}/db_${TIMESTAMP}.sql.gz
# Uploads
tar czf ${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz -C /var/www/xmd-saas/backend-production uploads/
# Keep 30 days
find ${BACKUP_DIR} -mtime +30 -delete
EOF
sudo chmod +x /etc/cron.daily/xmd-backup
log "Daily backup configured → /var/backups/xmd-saas/"

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  ✅ DEPLOY HOÀN TẤT${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Domain:     http://${DOMAIN}"
echo "  API:        http://${DOMAIN}/api/health"
echo "  DB User:    ${DB_USER}"
echo "  DB Pass:    ${DB_PASS}"
echo "  JWT Secret: ${JWT_SECRET}"
echo ""
echo "  Bước tiếp theo:"
echo "  1. Trỏ DNS ${DOMAIN} → IP VPS"
echo "  2. sudo certbot --nginx -d ${DOMAIN}"
echo "  3. Tạo admin account đầu tiên"
echo ""
echo -e "  ${YELLOW}⚠️  LƯU LẠI DB_PASS VÀ JWT_SECRET Ở TRÊN!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
