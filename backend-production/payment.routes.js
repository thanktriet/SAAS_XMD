const router   = require('express').Router({ mergeParams: true }); // mergeParams để lấy :id từ parent
const { authenticate, authorize } = require('./auth.middleware');
const { validate }                = require('./validate.middleware');
const { createPaymentRules, confirmPaymentRules } = require('./payment.validator');
const {
  getPayments, createPayment, confirmPayment, cancelPayment,
} = require('./payment.controller');

router.use(authenticate);

// GET  /api/sales/:id/payments — tất cả role xem được
router.get('/', getPayments);

// POST /api/sales/:id/payments — TVBH, kế toán, manager, admin tạo payment pending
router.post('/',
  authorize('sales', 'accountant', 'manager', 'admin'),
  createPaymentRules,
  validate,
  createPayment,
);

// PATCH /api/sales/:id/payments/:paymentId/confirm — kế toán, manager, admin
router.patch('/:paymentId/confirm',
  authorize('accountant', 'manager', 'admin'),
  confirmPaymentRules,
  validate,
  confirmPayment,
);

// DELETE /api/sales/:id/payments/:paymentId — kế toán, manager, admin
router.delete('/:paymentId',
  authorize('accountant', 'manager', 'admin'),
  cancelPayment,
);

module.exports = router;
