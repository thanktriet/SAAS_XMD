/**
 * Middleware xử lý lỗi tập trung
 * Bắt tất cả lỗi từ controllers và trả về response chuẩn
 */
const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Lỗi validation từ express-validator
  if (err.type === 'validation') {
    return res.status(422).json({
      success: false,
      error: 'Dữ liệu không hợp lệ',
      details: err.errors,
    });
  }

  // Lỗi JWT hết hạn / không hợp lệ
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token không hợp lệ hoặc đã hết hạn',
    });
  }

  // Lỗi Supabase / database
  if (err.code && err.code.startsWith('PG')) {
    return res.status(500).json({
      success: false,
      error: 'Lỗi cơ sở dữ liệu',
    });
  }

  // Lỗi mặc định
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Lỗi server nội bộ',
  });
};

/**
 * Middleware bắt route không tồn tại
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} không tồn tại`,
  });
};

module.exports = { errorHandler, notFoundHandler };
