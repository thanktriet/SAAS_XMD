const router = require('express').Router();
const { getDeposits, createDeposit } = require('./cashDeposit.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

// Xem: kế toán + manager + admin
router.get('/', authorize('admin', 'manager', 'accountant'), getDeposits);
// Tạo: chỉ kế toán + manager + admin (2B)
router.post('/', authorize('admin', 'manager', 'accountant'), createDeposit);

module.exports = router;
