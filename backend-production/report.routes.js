const router = require('express').Router();
const { getDashboard, getDailyReport } = require('./report.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

// Báo cáo: chỉ admin/manager/accountant xem được (sales không thấy doanh số toàn bộ)
router.get('/dashboard', authorize('admin', 'manager', 'accountant'), getDashboard);
router.get('/daily',     authorize('admin', 'manager', 'accountant'), getDailyReport);

module.exports = router;
