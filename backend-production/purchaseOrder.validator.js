const { body, query } = require('express-validator');

// ─── Đơn đặt mua ─────────────────────────────────────────────────────────────

const createPORules = [
  body('supplier_id')
    .notEmpty().withMessage('Nhà cung cấp không được để trống')
    .isUUID().withMessage('supplier_id không hợp lệ'),
  body('branch_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('branch_id không hợp lệ'),
  body('order_date')
    .optional().isDate().withMessage('Ngày đặt hàng phải có định dạng YYYY-MM-DD'),
  body('expected_date')
    .optional({ checkFalsy: true }).isDate().withMessage('Ngày giao dự kiến phải có định dạng YYYY-MM-DD'),
  body('payment_terms')
    .optional().isInt({ min: 0, max: 365 }).withMessage('Số ngày thanh toán từ 0-365'),
  body('payment_method')
    .optional({ checkFalsy: true })
    .isIn(['cash','bank_transfer','check','mixed'])
    .withMessage('Phương thức thanh toán không hợp lệ'),
  body('notes').optional({ checkFalsy: true }).trim(),
];

const updatePORules = [
  body('expected_date')
    .optional({ checkFalsy: true }).isDate(),
  body('payment_terms')
    .optional().isInt({ min: 0, max: 365 }),
  body('payment_method')
    .optional({ checkFalsy: true })
    .isIn(['cash','bank_transfer','check','mixed']),
  body('warehouse_note').optional({ checkFalsy: true }).trim(),
  body('notes').optional({ checkFalsy: true }).trim(),
  body('supplier_invoice_number').optional({ checkFalsy: true }).trim(),
  body('supplier_invoice_date').optional({ checkFalsy: true }).isDate(),
];

// ─── Dòng đơn đặt mua ────────────────────────────────────────────────────────

const createPOItemRules = [
  body('vehicle_model_id')
    .notEmpty().withMessage('Mẫu xe không được để trống')
    .isUUID().withMessage('vehicle_model_id không hợp lệ'),
  body('qty_ordered')
    .notEmpty().withMessage('Số lượng đặt không được để trống')
    .isInt({ min: 1 }).withMessage('Số lượng đặt phải >= 1'),
  body('unit_cost')
    .notEmpty().withMessage('Giá nhập không được để trống')
    .isInt({ min: 1 }).withMessage('Giá nhập phải > 0'),
  body('vat_rate')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Thuế suất VAT từ 0-100%'),
  body('color').optional({ checkFalsy: true }).trim(),
  body('year_manufacture')
    .optional()
    .isInt({ min: 2000, max: 2099 }).withMessage('Năm sản xuất không hợp lệ'),
  body('notes').optional({ checkFalsy: true }).trim(),
];

// ─── Phiếu nhận hàng ─────────────────────────────────────────────────────────

const createReceiptRules = [
  body('po_id')
    .notEmpty().withMessage('Mã đơn nhập hàng không được để trống')
    .isUUID().withMessage('po_id không hợp lệ'),
  body('receipt_date')
    .optional().isDate().withMessage('Ngày nhận phải có định dạng YYYY-MM-DD'),
  body('notes').optional({ checkFalsy: true }).trim(),
];

const acceptReceiptRules = [
  body('inspection_notes').optional({ checkFalsy: true }).trim(),
  body('items')
    .isArray({ min: 1 }).withMessage('Cần ít nhất 1 dòng xe để chấp nhận'),
  body('items.*.id')
    .notEmpty().withMessage('ID dòng nhận hàng không được để trống')
    .isUUID(),
  body('items.*.condition')
    .notEmpty()
    .isIn(['ok','defect','rejected']).withMessage('Tình trạng xe phải là ok / defect / rejected'),
  body('items.*.vin')
    .optional({ checkFalsy: true }).trim(),
  body('items.*.engine_number')
    .optional({ checkFalsy: true }).trim(),
  body('items.*.battery_serial')
    .optional({ checkFalsy: true }).trim(),
  body('items.*.defect_notes')
    .optional({ checkFalsy: true }).trim(),
  body('items.*.actual_unit_cost')
    .optional().isInt({ min: 0 }),
];

// ─── Thanh toán NCC ──────────────────────────────────────────────────────────

const createPaymentRules = [
  body('amount')
    .notEmpty().withMessage('Số tiền không được để trống')
    .isInt({ min: 1 }).withMessage('Số tiền phải > 0'),
  body('payment_method')
    .notEmpty().withMessage('Phương thức thanh toán không được để trống')
    .isIn(['cash','bank_transfer','check'])
    .withMessage('Phương thức phải là cash / bank_transfer / check'),
  body('payment_date')
    .optional().isDate().withMessage('Ngày thanh toán phải có định dạng YYYY-MM-DD'),
  body('bank_reference').optional({ checkFalsy: true }).trim(),
  body('note').optional({ checkFalsy: true }).trim(),
];

// ─── Query chung ─────────────────────────────────────────────────────────────

const listPOQueryRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn([
    'draft','submitted','approved','partial_received',
    'fully_received','invoiced','paid','rejected','cancelled',
  ]),
  query('supplier_id').optional().isUUID(),
  query('branch_id').optional().isUUID(),
  query('from_date').optional().isDate(),
  query('to_date').optional().isDate(),
];

module.exports = {
  createPORules,
  updatePORules,
  createPOItemRules,
  createReceiptRules,
  acceptReceiptRules,
  createPaymentRules,
  listPOQueryRules,
};
