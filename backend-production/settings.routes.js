const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('./auth.middleware');
const {
  getFees, updateFee, createFee, deleteFee,
  getServices, updateService, createService, deleteService,
  getInstallmentProviders, createInstallmentProvider, updateInstallmentProvider, deleteInstallmentProvider,
  getPaymentSettings, updatePaymentSettings,
} = require('./settings.controller');

// ── Phí cố định ──────────────────────────────────────────────────
router.get   ('/fees',          authenticate, getFees);
router.post  ('/fees',          authenticate, authorize('admin'), createFee);
router.put   ('/fees/:id',      authenticate, authorize('admin'), updateFee);
router.delete('/fees/:id',      authenticate, authorize('admin'), deleteFee);

// ── Dịch vụ đăng ký ──────────────────────────────────────────────
router.get   ('/services',      authenticate, getServices);
router.post  ('/services',      authenticate, authorize('admin'), createService);
router.put   ('/services/:id',  authenticate, authorize('admin'), updateService);
router.delete('/services/:id',  authenticate, authorize('admin'), deleteService);

// ── Đơn vị tài chính (trả góp) ───────────────────────────────────
router.get   ('/installment-providers',      authenticate, getInstallmentProviders);
router.post  ('/installment-providers',      authenticate, authorize('admin'), createInstallmentProvider);
router.put   ('/installment-providers/:id',  authenticate, authorize('admin'), updateInstallmentProvider);
router.delete('/installment-providers/:id',  authenticate, authorize('admin'), deleteInstallmentProvider);

// ── Thanh toán & SEPay ────────────────────────────────────────────
router.get('/payment',          authenticate, getPaymentSettings);
router.put('/payment',          authenticate, authorize('admin'), updatePaymentSettings);

module.exports = router;
