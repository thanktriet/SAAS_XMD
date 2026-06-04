const { body } = require('express-validator');

const VALID_GENDERS = ['male', 'female', 'other'];
const VALID_SOURCES = ['referral', 'facebook', 'zalo', 'showroom', 'website', 'call_center', 'other'];

const createCustomerRules = [
  // ── Bắt buộc ────────────────────────────────────────────
  body('full_name').notEmpty().withMessage('Họ tên không được để trống').trim(),
  body('phone')
    .notEmpty().withMessage('Số điện thoại không được để trống')
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),

  // ── Thông tin cơ bản ─────────────────────────────────────
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
  body('customer_type').optional().isIn(['individual', 'business']).withMessage('Loại khách hàng không hợp lệ'),
  body('gender').optional({ checkFalsy: true }).isIn(VALID_GENDERS).withMessage('Giới tính không hợp lệ'),
  body('source').optional({ checkFalsy: true }).isIn(VALID_SOURCES).withMessage('Nguồn khách hàng không hợp lệ'),

  // ── CCCD ────────────────────────────────────────────────
  body('id_card').optional({ checkFalsy: true }).trim(),
  body('id_card_date').optional({ checkFalsy: true }).isDate().withMessage('Ngày cấp CCCD không hợp lệ (YYYY-MM-DD)'),
  body('id_card_place').optional({ checkFalsy: true }).trim(),
  body('date_of_birth').optional({ checkFalsy: true }).isDate().withMessage('Ngày sinh không hợp lệ (YYYY-MM-DD)'),

  // ── Địa chỉ giao hàng ────────────────────────────────────
  body('address').notEmpty().withMessage('Địa chỉ không được để trống (cần để xuất hóa đơn)').trim(),
  body('district').optional({ checkFalsy: true }).trim(),
  body('province').optional({ checkFalsy: true }).trim(),

  // ── Doanh nghiệp ─────────────────────────────────────────
  body('company_name').optional({ checkFalsy: true }).trim(),
  body('tax_code').optional({ checkFalsy: true }).trim(),
  body('representative_name').optional({ checkFalsy: true }).trim(),
  body('representative_title').optional({ checkFalsy: true }).trim(),

  // ── Địa chỉ xuất hóa đơn ────────────────────────────────
  body('invoice_address').optional({ checkFalsy: true }).trim(),
  body('invoice_district').optional({ checkFalsy: true }).trim(),
  body('invoice_province').optional({ checkFalsy: true }).trim(),

  body('notes').optional({ checkFalsy: true }).trim(),
];

const updateCustomerRules = createCustomerRules.map(rule =>
  // Chuyển tất cả về optional cho update — giữ nguyên logic validator
  rule.optional ? rule : rule
);

// Override: full_name và phone khi update vẫn cần notEmpty nếu được gửi
const updateCustomerRulesOverride = [
  body('full_name').optional().notEmpty().withMessage('Họ tên không được để trống').trim(),
  body('phone').optional().matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
  body('customer_type').optional().isIn(['individual', 'business']).withMessage('Loại khách hàng không hợp lệ'),
  body('gender').optional({ checkFalsy: true }).isIn(VALID_GENDERS).withMessage('Giới tính không hợp lệ'),
  body('source').optional({ checkFalsy: true }).isIn(VALID_SOURCES).withMessage('Nguồn khách hàng không hợp lệ'),
  body('id_card').optional({ checkFalsy: true }).trim(),
  body('id_card_date').optional({ checkFalsy: true }).isDate().withMessage('Ngày cấp CCCD không hợp lệ (YYYY-MM-DD)'),
  body('id_card_place').optional({ checkFalsy: true }).trim(),
  body('date_of_birth').optional({ checkFalsy: true }).isDate().withMessage('Ngày sinh không hợp lệ (YYYY-MM-DD)'),
  body('address').optional().notEmpty().withMessage('Địa chỉ không được để trống').trim(),
  body('district').optional({ checkFalsy: true }).trim(),
  body('province').optional({ checkFalsy: true }).trim(),
  body('company_name').optional({ checkFalsy: true }).trim(),
  body('tax_code').optional({ checkFalsy: true }).trim(),
  body('representative_name').optional({ checkFalsy: true }).trim(),
  body('representative_title').optional({ checkFalsy: true }).trim(),
  body('invoice_address').optional({ checkFalsy: true }).trim(),
  body('invoice_district').optional({ checkFalsy: true }).trim(),
  body('invoice_province').optional({ checkFalsy: true }).trim(),
  body('notes').optional({ checkFalsy: true }).trim(),
];

module.exports = { createCustomerRules, updateCustomerRules: updateCustomerRulesOverride };
