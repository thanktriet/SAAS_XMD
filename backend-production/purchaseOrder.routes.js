const router = require('express').Router();
const {
  getSuppliers, createSupplier, updateSupplier, toggleSupplier,
  getPurchaseOrders,
  getPurchaseOrderDetail,
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePOStatus,
  createReceipt,
  acceptReceipt,
  getReceiptDetail,
  createPayment,
  getActionRequired,
} = require('./purchaseOrder.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

// ─── Nhà cung cấp — đặt TRƯỚC /:id để tránh conflict ────────────────────────
router.get('/suppliers',    getSuppliers);
router.post('/suppliers',   authorize('admin', 'manager', 'accountant'), createSupplier);
router.put('/suppliers/:id',    authorize('admin', 'manager', 'accountant'), updateSupplier);
router.patch('/suppliers/:id',  authorize('admin', 'manager', 'accountant'), toggleSupplier);

router.get('/action-required', getActionRequired);

// ─── Đơn nhập hàng ────────────────────────────────────────────────────────────
router.get('/',  getPurchaseOrders);

router.post('/',
  authorize('admin', 'manager', 'warehouse'),
  createPurchaseOrder);

router.get('/:id',  getPurchaseOrderDetail);

router.put('/:id',
  authorize('admin', 'manager', 'warehouse'),
  updatePurchaseOrder);

router.patch('/:id/status',
  authorize('admin', 'manager', 'warehouse'),
  updatePOStatus);

// ─── Phiếu nhận hàng ──────────────────────────────────────────────────────────
router.post('/:id/receipts',
  authorize('admin', 'manager', 'warehouse'),
  createReceipt);

// Route phiếu nhận dùng /receipts/:receiptId (tránh nhầm với /:id)
router.get('/receipts/:receiptId',
  getReceiptDetail);

router.patch('/receipts/:receiptId/accept',
  authorize('admin', 'manager', 'warehouse'),
  acceptReceipt);

// ─── Thanh toán NCC ───────────────────────────────────────────────────────────
router.post('/:id/payments',
  authorize('admin', 'manager', 'accountant'),
  createPayment);

module.exports = router;
