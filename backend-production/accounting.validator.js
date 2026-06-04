const { body, query, param } = require('express-validator');

// ─── Chứng từ kế toán ────────────────────────────────────────────────────────

const createVoucherRules = [
  body('branch_id')
    .notEmpty().withMessage('Chi nhánh không được để trống')
    .isUUID().withMessage('branch_id không hợp lệ'),
  body('voucher_type')
    .notEmpty().withMessage('Loại chứng từ không được để trống')
    .isIn(['receipt','payment','journal','sales_invoice','purchase_invoice',
           'inventory_in','inventory_out','intercompany','allocation'])
    .withMessage('Loại chứng từ không hợp lệ'),
  body('voucher_date')
    .notEmpty().withMessage('Ngày chứng từ không được để trống')
    .isDate().withMessage('Ngày chứng từ phải có định dạng YYYY-MM-DD'),
  body('fiscal_period_id')
    .notEmpty().withMessage('Kỳ kế toán không được để trống')
    .isUUID().withMessage('fiscal_period_id không hợp lệ'),
  body('description')
    .optional({ checkFalsy: true }).trim()
    .isLength({ max: 500 }).withMessage('Diễn giải không quá 500 ký tự'),
  body('customer_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('customer_id không hợp lệ'),
  body('supplier_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('supplier_id không hợp lệ'),
  body('reference_type')
    .optional({ checkFalsy: true }).trim(),
  body('reference_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('reference_id không hợp lệ'),
  body('lines')
    .isArray({ min: 2 }).withMessage('Chứng từ cần ít nhất 2 dòng bút toán'),
  body('lines.*.account_id')
    .notEmpty().withMessage('Tài khoản kế toán không được để trống')
    .isUUID().withMessage('account_id dòng bút toán không hợp lệ'),
  body('lines.*.debit_amount')
    .isInt({ min: 0 }).withMessage('Số tiền Nợ phải là số nguyên không âm'),
  body('lines.*.credit_amount')
    .isInt({ min: 0 }).withMessage('Số tiền Có phải là số nguyên không âm'),
  body('lines.*.description')
    .optional({ checkFalsy: true }).trim(),
];

// ─── Kỳ kế toán ─────────────────────────────────────────────────────────────

const createFiscalPeriodRules = [
  body('fiscal_year_id')
    .notEmpty().withMessage('fiscal_year_id không được để trống')
    .isUUID().withMessage('fiscal_year_id không hợp lệ'),
  body('period')
    .notEmpty().withMessage('Số kỳ không được để trống')
    .isInt({ min: 1, max: 13 }).withMessage('Kỳ phải từ 1 đến 13'),
  body('start_date')
    .notEmpty().withMessage('Ngày bắt đầu không được để trống')
    .isDate().withMessage('start_date phải có định dạng YYYY-MM-DD'),
  body('end_date')
    .notEmpty().withMessage('Ngày kết thúc không được để trống')
    .isDate().withMessage('end_date phải có định dạng YYYY-MM-DD'),
];

const closePeriodRules = [
  body('status')
    .notEmpty()
    .isIn(['open','soft_close','hard_close','reopened'])
    .withMessage('Trạng thái chỉ được là: open, soft_close, hard_close, reopened'),
];

// ─── Tài khoản kế toán ───────────────────────────────────────────────────────

const createAccountRules = [
  body('account_number')
    .notEmpty().withMessage('Mã tài khoản không được để trống').trim()
    .matches(/^[0-9]{3,5}[A-Z0-9]*$/).withMessage('Mã tài khoản không hợp lệ (VD: 111, 1331, 5111A)'),
  body('name')
    .notEmpty().withMessage('Tên tài khoản không được để trống').trim(),
  body('account_type')
    .notEmpty()
    .isIn(['asset','liability','equity','revenue','expense','contra_asset','contra_revenue'])
    .withMessage('Loại tài khoản không hợp lệ'),
  body('account_group')
    .notEmpty()
    .isIn(['group_1','group_2','group_3','group_4','group_5',
           'group_6','group_7','group_8','group_9'])
    .withMessage('Nhóm tài khoản phải là group_1 đến group_9'),
  body('normal_balance')
    .notEmpty()
    .isIn(['debit','credit']).withMessage('Số dư thường phải là debit hoặc credit'),
  body('level')
    .optional()
    .isInt({ min: 1, max: 3 }).withMessage('Cấp tài khoản phải từ 1 đến 3'),
  body('parent_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('parent_id không hợp lệ'),
];

const updateAccountRules = [
  body('name').optional().notEmpty().trim(),
  body('name_en').optional({ checkFalsy: true }).trim(),
  body('notes').optional({ checkFalsy: true }).trim(),
  body('is_active').optional().isBoolean(),
  body('opening_balance').optional().isNumeric().withMessage('Số dư đầu kỳ phải là số'),
];

// ─── Nhà cung cấp ────────────────────────────────────────────────────────────

const createSupplierRules = [
  body('supplier_name')
    .notEmpty().withMessage('Tên nhà cung cấp không được để trống').trim(),
  body('phone')
    .optional({ checkFalsy: true })
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email')
    .optional({ checkFalsy: true }).isEmail().normalizeEmail()
    .withMessage('Email không hợp lệ'),
  body('tax_code')
    .optional({ checkFalsy: true }).trim()
    .isLength({ min: 10, max: 14 }).withMessage('Mã số thuế 10-14 ký tự'),
  body('payment_terms')
    .optional()
    .isInt({ min: 0, max: 365 }).withMessage('Số ngày thanh toán từ 0 đến 365'),
  body('credit_limit')
    .optional()
    .isInt({ min: 0 }).withMessage('Hạn mức tín dụng phải là số không âm'),
];

const updateSupplierRules = [
  body('supplier_name').optional().notEmpty().trim(),
  body('phone').optional({ checkFalsy: true })
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('payment_terms').optional().isInt({ min: 0, max: 365 }),
  body('credit_limit').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean(),
];

// ─── Query chung ─────────────────────────────────────────────────────────────

const listQueryRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('page phải >= 1'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit từ 1-200'),
];

module.exports = {
  createVoucherRules,
  createFiscalPeriodRules,
  closePeriodRules,
  createAccountRules,
  updateAccountRules,
  createSupplierRules,
  updateSupplierRules,
  listQueryRules,
};
