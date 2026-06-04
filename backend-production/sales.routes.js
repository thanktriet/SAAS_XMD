const router = require('express').Router();
const {
  createOrder,
  updateOrder,
  getOrders,
  getOrderDetail,
  updateOrderStatus,
  updateDmsCode,
} = require('./sales.controller');
const { authenticate, authorize } = require('./auth.middleware');
const { validate } = require('./validate.middleware');
const { createOrderRules, updateOrderStatusRules } = require('./sales.validator');

router.use(authenticate);

router.get('/', getOrders);
router.post('/', createOrderRules, validate, createOrder);
router.get('/:id', getOrderDetail);
router.put('/:id', createOrderRules, validate, updateOrder);
router.patch('/:id/status', updateOrderStatusRules, validate, updateOrderStatus);
router.patch('/:id/dms-code', authorize('admin', 'manager', 'accountant'), updateDmsCode);

module.exports = router;
