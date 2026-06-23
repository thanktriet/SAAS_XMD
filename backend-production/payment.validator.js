const { body, param } = require('express-validator');

// ── Tạo payment mới (TVBH) ─────────────────────────────────────────────────
const createPaymentRules = [
  body('payment_method')
    .isIn(['cash', 'bank_transfer', 'qr_code'])
    .withMessage('Phương thức không hợp lệ (cash | bank_transfer | qr_code)'),

  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Số tiền phải lớn hơn 0'),

  body('payment_date')
    .isDate()
    .withMessage('Ngày thanh toán không hợp lệ'),

  // Chuyển khoản → bắt buộc có ảnh
  body('transfer_screenshot_url')
    .if(body('payment_method').equals('bank_transfer'))
    .notEmpty()
    .withMessage('Vui lòng đính kèm ảnh chuyển khoản'),

  body('notes').optional().isString().trim(),
];

// ── Kế toán xác nhận payment ───────────────────────────────────────────────
const confirmPaymentRules = [
  param('paymentId').isUUID().withMessage('Payment ID không hợp lệ'),
  body('receipt_number').optional({ nullable: true }).isString().trim(),
  body('bank_reference').optional({ nullable: true }).isString().trim(),
  body('notes').optional({ nullable: true }).isString().trim(),
];

module.exports = { createPaymentRules, confirmPaymentRules };
