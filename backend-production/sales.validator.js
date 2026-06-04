const { body } = require('express-validator');

const createOrderRules = [
  body('customer_id')
    .notEmpty().withMessage('Khách hàng không được để trống')
    .isUUID().withMessage('ID khách hàng không hợp lệ'),
  body('items')
    .isArray({ min: 1 }).withMessage('Đơn hàng phải có ít nhất 1 sản phẩm'),
  body('items.*.vehicle_model_id')
    .notEmpty().withMessage('Mẫu xe không được để trống'),
  body('items.*.quantity')
    .isInt({ min: 1 }).withMessage('Số lượng phải lớn hơn 0'),
  body('payment_method')
    .notEmpty().withMessage('Phương thức thanh toán không được để trống')
    .isIn(['cash', 'bank_transfer', 'qr', 'installment', 'mixed'])
    .withMessage('Phương thức thanh toán không hợp lệ'),
  body('discount_amount').optional().isFloat({ min: 0 }).withMessage('Chiết khấu phải >= 0'),
  body('deposit_amount').optional().isFloat({ min: 0 }).withMessage('Tiền đặt cọc phải >= 0'),
  body('delivery_address').optional({ checkFalsy: true }).isString().trim(),
  body('notes').optional({ checkFalsy: true }).isString().trim(),
  body('accessories').optional().isArray().withMessage('accessories phải là mảng'),
  body('accessories.*.accessory_id').optional().isUUID().withMessage('ID phụ kiện không hợp lệ'),
  body('accessories.*.quantity').optional().isInt({ min: 1 }).withMessage('Số lượng phụ kiện phải >= 1'),
  body('accessories.*.unit_price').optional().isFloat({ min: 0 }).withMessage('Đơn giá phụ kiện phải >= 0'),
];

const updateOrderStatusRules = [
  // ── Trạng thái ──────────────────────────────────────────────────────────
  body('status')
    .notEmpty().withMessage('Trạng thái không được để trống')
    .isIn([
      'draft', 'confirmed', 'deposit_paid', 'full_paid',
      'invoice_requested', 'invoice_approved',
      'pdi_pending', 'pdi_done',
      'delivered', 'cancelled',
    ]).withMessage('Trạng thái đơn hàng không hợp lệ'),

  // ── deposit_paid: cần số tiền cọc ────────────────────────────────────────
  body('deposit_amount')
    .if(body('status').equals('deposit_paid'))
    .notEmpty().withMessage('Số tiền cọc không được để trống')
    .isFloat({ min: 1 }).withMessage('Số tiền cọc phải lớn hơn 0'),

  // ── full_paid: cần phiếu thu đầy đủ ──────────────────────────────────────
  body('receipt_number')
    .if(body('status').equals('full_paid'))
    .notEmpty().withMessage('Số phiếu thu không được để trống')
    .isString().trim()
    .isLength({ max: 50 }).withMessage('Số phiếu thu tối đa 50 ký tự'),

  body('receipt_date')
    .if(body('status').equals('full_paid'))
    .notEmpty().withMessage('Ngày thu tiền không được để trống')
    .isDate().withMessage('Ngày thu tiền không hợp lệ (YYYY-MM-DD)'),

  body('payment_note')
    .if(body('status').equals('full_paid'))
    .optional({ checkFalsy: true })
    .isString().trim()
    .isLength({ max: 500 }).withMessage('Ghi chú thanh toán tối đa 500 ký tự'),

  // ── pdi_done: cần ghi chú kỹ thuật ───────────────────────────────────────
  body('pdi_notes')
    .if(body('status').equals('pdi_done'))
    .notEmpty().withMessage('Ghi chú PDI không được để trống')
    .isString().trim()
    .isLength({ min: 5, max: 1000 }).withMessage('Ghi chú PDI từ 5 đến 1000 ký tự'),

  // ── cancelled: cần lý do ─────────────────────────────────────────────────
  body('cancel_reason')
    .if(body('status').equals('cancelled'))
    .notEmpty().withMessage('Lý do huỷ không được để trống')
    .isString().trim()
    .isLength({ min: 5, max: 500 }).withMessage('Lý do huỷ từ 5 đến 500 ký tự'),
];

module.exports = { createOrderRules, updateOrderStatusRules };
