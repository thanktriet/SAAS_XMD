# Mobile PWA Sales Shell — Design Spec

**Date:** 2026-06-07
**Scope:** Tách riêng mobile shell (`/m/`) cho flow bán hàng, PWA installable, push notification, offline mode.

---

## 1. Tổng quan

Tạo một mobile shell riêng biệt tại route `/m/` với bộ component UI riêng, tối ưu cho nhân viên bán hàng sử dụng trên điện thoại. Chia sẻ API layer và business logic với desktop nhưng UI hoàn toàn độc lập.

### Mục tiêu

- Trải nghiệm mobile native-like (bottom nav, swipe, touch-friendly)
- Installable PWA (Add to Home Screen)
- Push notification cho events bán hàng quan trọng
- Offline mode: đọc dữ liệu khi mất mạng, queue ghi khi online lại
- Không ảnh hưởng giao diện desktop hiện tại

### Không bao gồm

- Các trang admin (Users, Settings, License, Branches)
- Module kế toán (Accounting)
- Module kho chi tiết (chỉ hiển thị tồn kho khi tạo đơn)

---

## 2. Cấu trúc thư mục

```
frontend/src/
├── mobile/
│   ├── App.tsx                  # Mobile router, layout wrapper
│   ├── main.tsx                 # Entry point cho mobile shell
│   ├── components/
│   │   ├── layout/
│   │   │   ├── MobileLayout.tsx    # Shell: header + content + bottom nav
│   │   │   ├── BottomNav.tsx       # 4 tab navigation
│   │   │   ├── MobileHeader.tsx    # Top bar: title, back, avatar
│   │   │   └── FAB.tsx            # Floating action button "Tạo đơn"
│   │   ├── ui/
│   │   │   ├── PullToRefresh.tsx
│   │   │   ├── SwipeCard.tsx
│   │   │   ├── SkeletonLoader.tsx
│   │   │   ├── OfflineBadge.tsx
│   │   │   └── EmptyState.tsx
│   │   └── shared/
│   │       ├── CustomerPicker.tsx
│   │       ├── VehicleCard.tsx
│   │       └── PaymentStatus.tsx
│   ├── pages/
│   │   ├── DashboardPage.tsx       # Tổng quan ngày
│   │   ├── SalesListPage.tsx       # Danh sách đơn hàng
│   │   ├── SalesNewPage.tsx        # Wizard tạo đơn 3 bước
│   │   ├── SalesDetailPage.tsx     # Chi tiết đơn + thanh toán
│   │   ├── CustomersPage.tsx       # Danh sách & tìm kiếm khách
│   │   ├── CustomerDetailPage.tsx  # Chi tiết khách hàng
│   │   └── NotificationsPage.tsx   # Lịch sử thông báo
│   ├── hooks/
│   │   ├── useOfflineSync.ts       # Queue & sync logic
│   │   ├── usePushNotification.ts  # Subscribe/unsubscribe push
│   │   ├── useNetworkStatus.ts     # Online/offline detection
│   │   └── useMobileAuth.ts       # Auth wrapper cho mobile
│   ├── stores/
│   │   ├── offlineStore.ts         # IndexedDB persistence layer
│   │   └── syncQueue.ts           # Pending mutations queue
│   └── sw/
│       ├── service-worker.ts       # SW registration, cache, push handler
│       └── push-handler.ts         # Push event → notification display
├── shared/
│   ├── api/                        # API client (axios instance, interceptors)
│   │   ├── client.ts
│   │   ├── sales.ts
│   │   ├── customers.ts
│   │   └── types.ts
│   └── utils/
│       ├── formatCurrency.ts
│       ├── formatDate.ts
│       └── constants.ts
```

### Entry point & routing

- `index.html` → desktop app (existing)
- `mobile.html` → mobile shell (new entry point, Vite multi-page)
- Auto-detect: nếu `window.innerWidth < 768` và không phải Electron → suggest redirect `/m/`
- User có thể chọn "Dùng phiên bản desktop" để bỏ qua

---

## 3. Navigation Design

### Bottom Tab Bar (4 tabs)

| Tab | Icon | Label | Route |
|-----|------|-------|-------|
| 1 | 🏠 Home | Tổng quan | `/m/` |
| 2 | 📋 FileText | Đơn hàng | `/m/sales` |
| 3 | 👥 Users | Khách hàng | `/m/customers` |
| 4 | 🔔 Bell | Thông báo | `/m/notifications` |

### FAB (Floating Action Button)

- Vị trí: góc dưới phải, trên bottom nav 16px
- Action: Navigate → `/m/sales/new`
- Icon: ➕ với label "Tạo đơn"
- Ẩn khi đang ở trang `/m/sales/new` (tránh trùng lặp)
- Ẩn khi scroll xuống, hiện khi scroll lên (space cho content)

### Mobile Header

- Left: Back button (khi không ở root) hoặc Branch name
- Center: Page title
- Right: User avatar → tap để mở menu (đổi branch, logout)

---

## 4. Pages Chi Tiết

### 4.1 Dashboard (`/m/`)

Tổng quan hoạt động trong ngày, hiển thị dạng card stack:

**Cards:**
- **Doanh số hôm nay** — tổng tiền, số đơn, so sánh hôm qua
- **Cần xử lý** — đơn chờ xác nhận thanh toán (tap → đi đến đơn)
- **Đơn gần đây** — 5 đơn mới nhất, swipe để xem thêm

**Data source:** `GET /api/reports/dashboard` + `GET /api/sales?status=pending&limit=5`

### 4.2 Sales List (`/m/sales`)

**Layout:**
- Filter chips ngang: Tất cả | Chờ TT | Hoàn thành | Hủy
- List dạng card, mỗi card hiển thị: mã đơn, tên khách, tổng tiền, trạng thái, thời gian
- Pull-to-refresh
- Infinite scroll (load thêm 20 items)
- Search bar sticky top

**Data source:** `GET /api/sales?status=&page=&limit=20`

### 4.3 Sales New — Wizard (`/m/sales/new`)

**Step 1: Chọn khách hàng**
- Search input với autocomplete
- Hiển thị khách gần đây (3-5 người)
- Nút "Thêm khách mới" → inline form (tên, SĐT, địa chỉ)
- Tap khách → chuyển step 2

**Step 2: Chọn xe + phụ kiện**
- Vehicle cards dạng horizontal scroll (ảnh, tên, giá, tồn kho)
- Tap card → selected (viền highlight)
- Section phụ kiện: checkbox list với quantity stepper
- Section khuyến mãi: auto-apply nếu đủ điều kiện, hiển thị badge
- Hiển thị tạm tính realtime ở bottom

**Step 3: Xác nhận & thanh toán**
- Tóm tắt đơn hàng (khách, xe, phụ kiện, khuyến mãi)
- Chọn phương thức thanh toán (tiền mặt, chuyển khoản, trả góp)
- Nếu trả góp → chọn installment provider
- Nút "Tạo đơn" → confirm dialog → submit

**Navigation:** Progress bar top (Step 1/3), back button quay lại step trước, swipe left/right giữa steps.

**Data sources:**
- `GET /api/customers?search=`
- `GET /api/inventory?in_stock=true`
- `GET /api/accessories`
- `GET /api/promotions?active=true`
- `POST /api/sales`

### 4.4 Sales Detail (`/m/sales/:id`)

**Sections (scrollable):**
1. **Header** — Mã đơn, trạng thái (badge màu), ngày tạo
2. **Khách hàng** — Tên, SĐT (tap to call), địa chỉ
3. **Sản phẩm** — Xe + phụ kiện, đơn giá, thành tiền
4. **Thanh toán** — Lịch sử thanh toán, số tiền còn lại
5. **Actions** — Nút xác nhận TT, hủy đơn (tùy quyền + trạng thái)

**Action buttons:** Sticky bottom, context-aware:
- Đơn pending → "Xác nhận thanh toán"
- Đơn đã TT đủ → "Hoàn thành"
- Có thể hủy → "Hủy đơn" (secondary, cần confirm)

**Data source:** `GET /api/sales/:id` + `GET /api/sales/:id/payments`

### 4.5 Customers (`/m/customers`)

**Layout:**
- Search bar sticky top (tìm theo tên, SĐT)
- List dạng compact: avatar chữ cái, tên, SĐT, số đơn hàng
- Tap → Customer detail
- FAB "Thêm khách" (thay thế FAB tạo đơn ở trang này)

**Data source:** `GET /api/customers?search=&page=&limit=20`

### 4.6 Customer Detail (`/m/customers/:id`)

- Thông tin cơ bản (tên, SĐT, email, địa chỉ)
- Lịch sử mua hàng (list đơn hàng)
- Tap đơn → Sales detail
- Nút gọi điện, nhắn tin (tel:, sms: links)

### 4.7 Notifications (`/m/notifications`)

- List thông báo theo thời gian (mới nhất trên)
- Badge unread count trên tab icon
- Tap notification → navigate đến đơn hàng liên quan
- Mark all as read
- Hiển thị cả push history và in-app notifications

---

## 5. PWA Configuration

### manifest.json

```json
{
  "name": "XMD Sales",
  "short_name": "XMD",
  "description": "Quản lý bán hàng xe máy điện",
  "start_url": "/m/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#1a56db",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Vite PWA Plugin Config

- Plugin: `vite-plugin-pwa`
- Strategy: `injectManifest` (custom service worker)
- Workbox: precache static assets, runtime cache API calls

---

## 6. Service Worker & Offline

### Cache Strategy

| Resource | Strategy | TTL |
|----------|----------|-----|
| Static assets (JS, CSS, images) | Cache First | Until new SW |
| API GET `/api/sales` | Stale While Revalidate | 5 min |
| API GET `/api/customers` | Stale While Revalidate | 10 min |
| API GET `/api/inventory` | Network First | — |
| API POST/PUT/DELETE | Network Only + Queue | — |

### IndexedDB Schema (via idb library)

```
Stores:
- sales: { id, customer_name, total, status, updated_at }
- customers: { id, name, phone, email, order_count }
- syncQueue: { id, method, url, body, created_at, retries }
```

### Offline Write Queue

1. User tạo đơn khi offline → lưu vào `syncQueue`
2. Hiển thị đơn với badge "Chờ đồng bộ"
3. Khi online → Background Sync API trigger replay queue
4. Nếu conflict (xe đã bán) → notification lỗi, user xử lý thủ công
5. Retry tối đa 3 lần, sau đó mark failed và notify user

### Network Status UI

- Online: không hiển thị gì
- Offline: banner top "Đang offline — dữ liệu có thể không mới nhất"
- Syncing: banner "Đang đồng bộ..." với progress

---

## 7. Push Notification

### Backend

**Bảng mới:** `push_subscriptions`
```sql
CREATE TABLE push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);
```

**API endpoints mới:**
- `POST /api/push/subscribe` — lưu subscription
- `DELETE /api/push/unsubscribe` — xóa subscription
- `GET /api/notifications` — lịch sử notifications
- `PUT /api/notifications/:id/read` — mark as read

**Bảng mới:** `notifications`
```sql
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id),
  title VARCHAR(200) NOT NULL,
  body TEXT,
  type VARCHAR(50) NOT NULL,
  reference_type VARCHAR(50),
  reference_id INTEGER,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Push triggers (gọi trong business logic hiện tại):**

| Event | Người nhận | Title | Body |
|-------|-----------|-------|------|
| Thanh toán thành công (SEPay webhook) | Sales owner | "Thanh toán thành công" | "Đơn #X đã nhận {amount}" |
| Đơn hàng pending > 30 phút | Sales owner | "Đơn chờ xử lý" | "Đơn #X chờ xác nhận TT" |
| Manager duyệt cash advance | Requester | "Đã duyệt" | "Đề nghị tạm ứng đã được duyệt" |
| Manager từ chối | Requester | "Từ chối" | "Đề nghị tạm ứng bị từ chối" |
| Đơn mới được tạo | Branch managers | "Đơn hàng mới" | "NV X vừa tạo đơn #{id}" |

**Library:** `web-push` (Node.js) — VAPID keys stored trong env vars.

### Frontend (Service Worker)

```javascript
// Push event handler
self.addEventListener('push', (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: data.url },
      tag: data.tag, // group similar notifications
    })
  );
});

// Click handler → open app to relevant page
self.addEventListener('notificationclick', (event) => {
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
```

---

## 8. Authentication

- Dùng lại JWT auth hiện tại
- Mobile shell gọi cùng `/api/auth/login` endpoint
- Token lưu trong localStorage (đã có)
- Auto-redirect về `/m/login` khi token hết hạn
- Refresh token flow giữ nguyên

---

## 9. Auto-detect & Redirect

```typescript
// Trong main desktop entry point
if (
  window.innerWidth < 768 &&
  !window.navigator.userAgent.includes('Electron') &&
  !localStorage.getItem('prefer-desktop')
) {
  // Hiển thị prompt: "Bạn muốn dùng phiên bản mobile?"
  // Nếu đồng ý → redirect /m/
  // Nếu từ chối → set localStorage('prefer-desktop', '1')
}
```

---

## 10. Tech Stack (Mobile Shell)

| Concern | Choice | Lý do |
|---------|--------|-------|
| UI Framework | React 19 (shared) | Đã có |
| Router | React Router v7 | Đã có, dùng cho `/m/*` routes |
| State | Zustand + React Query | Đã có, share stores |
| Offline DB | idb (IndexedDB wrapper) | Lightweight, type-safe |
| PWA | vite-plugin-pwa + Workbox | Integrate tốt với Vite |
| Push | web-push (backend) | Standard, miễn phí |
| Styling | Tailwind CSS | Đã có trong project |
| Icons | Lucide React | Đã có |
| Animation | Framer Motion | Touch gestures, page transitions |

---

## 11. Build & Deploy

- Vite multi-page: thêm `mobile.html` entry
- Build output: `dist/` chứa cả desktop và mobile assets
- Service Worker build riêng (injectManifest)
- VAPID keys: generate 1 lần, lưu env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`)
- Nginx config: serve `/m/*` từ `mobile.html`

---

## 12. Phân chia giai đoạn triển khai

### Phase 1: PWA Shell + Navigation
- Setup Vite multi-page
- Mobile layout (BottomNav, Header, FAB)
- manifest.json + basic Service Worker
- Login page mobile
- Auto-detect redirect

### Phase 2: Sales Pages
- Dashboard page
- Sales list (filter, search, infinite scroll)
- Sales detail + payment actions
- Sales new wizard (3 steps)

### Phase 3: Customers + Offline
- Customers list + search
- Customer detail
- IndexedDB cache layer
- Offline read mode
- Sync queue cho offline writes

### Phase 4: Push Notification
- Backend: push_subscriptions table, web-push setup
- Backend: notifications table + API
- Notification triggers trong business logic
- Frontend: subscribe flow, notification page
- Service Worker push handler

---

## 13. Acceptance Criteria

- [ ] Installable trên Android Chrome và iOS Safari (Add to Home Screen)
- [ ] Lighthouse PWA score ≥ 90
- [ ] Tạo đơn hàng hoàn chỉnh trên mobile trong < 60s (với khách có sẵn)
- [ ] Xem được danh sách đơn hàng khi offline
- [ ] Push notification hiển thị trong < 5s sau event
- [ ] Không ảnh hưởng layout/chức năng desktop
- [ ] Touch targets ≥ 44px (WCAG)
- [ ] Page load < 3s trên 4G
