// promotions.routes.js — mount tại /api/promotions
'use strict';
const router = require('express').Router();
const {
  getPromotions,
  getPromoDetail,
  createPromo,
  updatePromo,
  togglePromo,
  getActivePromos,
  applyPromoToOrder,
  getPromoUsage,
  getPromoStats,
} = require('./promotions.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

// Thống kê nhanh — chỉ admin/manager
router.get('/stats',   authorize('admin', 'manager'), getPromoStats);

// Danh sách KM đang hiệu lực (dùng trong POS — tất cả nhân viên sales)
router.get('/active',  getActivePromos);

// Lịch sử sử dụng — chỉ admin/manager
router.get('/usage',   authorize('admin', 'manager'), getPromoUsage);

// CRUD chính — chỉ admin (menu Khuyến mãi đã ẩn cho non-admin)
router.get('/',    authorize('admin', 'manager'), getPromotions);
router.post('/',   authorize('admin'), createPromo);
router.get('/:id', authorize('admin', 'manager'), getPromoDetail);
router.put('/:id', authorize('admin'), updatePromo);
router.patch('/:id/toggle', authorize('admin'), togglePromo);

// Áp dụng KM vào đơn hàng — sales cũng được
router.post('/apply', authorize('admin', 'manager', 'sales'), applyPromoToOrder);

module.exports = router;
