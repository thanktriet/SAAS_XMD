const router = require('express').Router();
const {
  getTransactions,
  createTransaction,
  getMonthlyRevenue,
  getFinanceSummary,
  getCashflowToday,
} = require('./finance.controller');
const { getPendingAll, confirmPayment, cancelPayment } = require('./payment.controller');
const { authenticate, authorize } = require('./auth.middleware');
const { validate } = require('./validate.middleware');
const { createTransactionRules } = require('./finance.validator');
const { confirmPaymentRules }    = require('./payment.validator');

router.use(authenticate);

router.get('/', getTransactions);
router.post('/', createTransactionRules, validate, createTransaction);
router.get('/monthly-revenue', getMonthlyRevenue);
router.get('/summary', getFinanceSummary);

// Tồn quỹ
router.get('/cashflow/today', getCashflowToday);

// Danh sách payment chờ xác nhận — kế toán, manager, admin
router.get('/pending-payments', authorize('accountant', 'manager', 'admin'), getPendingAll);

// Middleware remap params: orderId → id (để dùng lại confirmPayment / cancelPayment)
const remapOrderId = (req, _res, next) => { req.params.id = req.params.orderId; next(); };

// Xác nhận payment từ module tài chính
router.patch('/pending-payments/:orderId/:paymentId/confirm',
  authorize('accountant', 'manager', 'admin'),
  remapOrderId,
  confirmPayment,
);

// Huỷ payment từ module tài chính
router.delete('/pending-payments/:orderId/:paymentId',
  authorize('accountant', 'manager', 'admin'),
  remapOrderId,
  cancelPayment,
);

module.exports = router;
