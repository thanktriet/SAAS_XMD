const router = require('express').Router();
const {
  getAccessoryOrders,
  getAccessoryOrderById,
  createAccessoryOrder,
  confirmCashPayment,
  cancelAccessoryOrder,
} = require('./accessoryOrder.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

router.get('/',     getAccessoryOrders);
router.get('/:id',  getAccessoryOrderById);

// Ai cũng được tạo (B.3)
router.post('/',                authorize('admin', 'manager', 'sales', 'technician', 'accountant', 'warehouse'), createAccessoryOrder);
router.patch('/:id/confirm-cash', authorize('admin', 'manager', 'accountant'), confirmCashPayment);
router.patch('/:id/cancel',     authorize('admin', 'manager', 'sales', 'technician', 'accountant', 'warehouse'), cancelAccessoryOrder);

module.exports = router;
