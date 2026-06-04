const router = require('express').Router();
const { getBranding, updateBranding, getBranches, createBranch } = require('./branding.controller');
const { authenticate, authorize } = require('./auth.middleware');

// Branding cho user hiện tại
router.get('/', authenticate, getBranding);

// Cập nhật branding (admin only)
router.put('/', authenticate, authorize('admin'), updateBranding);

// Quản lý branches (admin only)
router.get('/branches', authenticate, authorize('admin', 'manager'), getBranches);
router.post('/branches', authenticate, authorize('admin'), createBranch);

module.exports = router;
