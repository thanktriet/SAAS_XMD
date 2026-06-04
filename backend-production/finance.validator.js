const { body } = require('express-validator');

const createTransactionRules = [
  body('type')
    .notEmpty().withMessage('Loại giao dịch không được để trống')
    .isIn(['income', 'expense']).withMessage('Loại giao dịch phải là income hoặc expense'),
  body('amount')
    .notEmpty().withMessage('Số tiền không được để trống')
    .isFloat({ min: 1 }).withMessage('Số tiền phải lớn hơn 0'),
  body('category').notEmpty().withMessage('Danh mục không được để trống'),
  body('payment_method')
    .notEmpty().withMessage('Phương thức thanh toán không được để trống')
    .isIn(['cash', 'bank_transfer', 'installment', 'mixed']).withMessage('Phương thức không hợp lệ'),
  body('transaction_date')
    .notEmpty().withMessage('Ngày giao dịch không được để trống')
    .isDate().withMessage('Ngày giao dịch không đúng định dạng (YYYY-MM-DD)'),
];

module.exports = { createTransactionRules };
