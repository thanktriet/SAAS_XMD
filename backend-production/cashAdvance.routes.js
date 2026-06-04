const router = require('express').Router();
const {
  getAdvances,
  getAdvanceById,
  createAdvance,
  approveAdvance,
  rejectAdvance,
  completeAdvance,
  reconcileAdvance,
  cancelAdvance,
} = require('./cashAdvance.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

router.get('/',     getAdvances);
router.get('/:id',  getAdvanceById);

// Tạo: ai cũng được (3B)
router.post('/',                authorize('admin', 'manager', 'sales', 'technician', 'accountant', 'warehouse'), createAdvance);

// Người tạo có thể hoàn tất biên lai
router.patch('/:id/complete',   authorize('admin', 'manager', 'sales', 'technician', 'accountant', 'warehouse'), completeAdvance);

// Hủy: ai cũng được (chỉ trước khi reconciled)
router.patch('/:id/cancel',     authorize('admin', 'manager', 'sales', 'technician', 'accountant', 'warehouse'), cancelAdvance);

// Duyệt / từ chối: chỉ manager + admin
router.patch('/:id/approve',    authorize('admin', 'manager'), approveAdvance);
router.patch('/:id/reject',     authorize('admin', 'manager'), rejectAdvance);

// Đối chiếu: chỉ kế toán + manager + admin
router.patch('/:id/reconcile',  authorize('admin', 'manager', 'accountant'), reconcileAdvance);

module.exports = router;
