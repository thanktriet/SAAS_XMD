# Backend ERP Xe Máy Điện - Hướng dẫn deploy production

## Yêu cầu môi trường
- Node.js >= 18 LTS
- Tài khoản Supabase đã chạy đủ migrations trong `migrations/`

## Các bước deploy

### 1. Giải nén & cài dependencies
```bash
unzip backend-production.zip -d /opt/erp-backend
cd /opt/erp-backend
npm ci --omit=dev
```

### 2. Cấu hình môi trường
```bash
cp .env.production.example .env
nano .env
```
Điền các biến:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `FRONTEND_URL`
- `PORT` (mặc định 5000)

### 3. Chạy migrations (nếu DB chưa có)
Mở Supabase SQL Editor, chạy theo thứ tự:
1. `migrations/schema.sql`
2. `migrations/seed_vehicle_models.sql`

### 4. Tạo admin đầu tiên
```bash
node scripts/create-admin.js
```

### 5. Khởi động
```bash
npm start
```

## Chạy nền với PM2 (khuyến nghị)
```bash
npm install -g pm2
pm2 start src/server.js --name erp-backend
pm2 save
pm2 startup
```

## Reverse proxy mẫu (Nginx)
```nginx
location /api/ {
  proxy_pass http://127.0.0.1:5000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```
