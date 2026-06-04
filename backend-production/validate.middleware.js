const { validationResult } = require('express-validator');

/**
 * Middleware kiểm tra kết quả validation
 * Đặt sau các express-validator rules
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: 'Dữ liệu không hợp lệ',
      details: errors.array().map(e => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
};

module.exports = { validate };
