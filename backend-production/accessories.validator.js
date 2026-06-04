const { body } = require('express-validator');

const VALID_CATEGORIES = ['safety', 'luggage', 'comfort', 'weather', 'decor', 'other'];

const createAccessoryRules = [
  body('code')
    .notEmpty().withMessage('Mã phụ kiện không được để trống')
    .isLength({ max: 20 }).withMessage('Mã phụ kiện tối đa 20 ký tự'),
  body('name')
    .notEmpty().withMessage('Tên phụ kiện không được để trống'),
  body('price')
    .notEmpty().withMessage('Giá không được để trống')
    .isFloat({ min: 0 }).withMessage('Giá phải >= 0'),
  body('category')
    .optional()
    .isIn(VALID_CATEGORIES).withMessage(`Danh mục phải là: ${VALID_CATEGORIES.join(', ')}`),
  body('unit')
    .optional()
    .notEmpty().withMessage('Đơn vị không được rỗng'),
  body('compatible_models')
    .optional()
    .isArray().withMessage('compatible_models phải là mảng'),
];

const updateAccessoryRules = [
  body('name')
    .optional()
    .notEmpty().withMessage('Tên phụ kiện không được rỗng'),
  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Giá phải >= 0'),
  body('category')
    .optional()
    .isIn(VALID_CATEGORIES).withMessage(`Danh mục phải là: ${VALID_CATEGORIES.join(', ')}`),
  body('compatible_models')
    .optional()
    .isArray().withMessage('compatible_models phải là mảng'),
];

module.exports = { createAccessoryRules, updateAccessoryRules };
