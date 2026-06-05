const router = require('express').Router();
const { authenticate, authorize } = require('./auth.middleware');
const {
  getBranches,
  getBranch,
  createBranch,
  updateBranch,
  extendLicense,
  suspendBranch,
  activateBranch,
  revokeBranch,
  getLicenseLogs,
  getLicenseDashboard,
  getPlans,
  changePlan,
} = require('./license.controller');

// Chỉ super admin (không có branch_id) mới quản lý license
const superAdminOnly = [authenticate, authorize('admin'), (req, res, next) => {
  if (req.user.branch_id) {
    return res.status(403).json({ error: 'Chỉ quản trị viên hệ thống mới có quyền này', code: 'NOT_SUPER_ADMIN' });
  }
  next();
}];

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', ...superAdminOnly, getLicenseDashboard);

// ─── Gói license ─────────────────────────────────────────────────────────────
router.get('/plans', ...superAdminOnly, getPlans);

// ─── CRUD Chi nhánh ──────────────────────────────────────────────────────────
router.get('/branches',     ...superAdminOnly, getBranches);
router.get('/branches/:id', ...superAdminOnly, getBranch);
router.post('/branches',    ...superAdminOnly, createBranch);
router.put('/branches/:id', ...superAdminOnly, updateBranch);

// ─── License actions ─────────────────────────────────────────────────────────
router.post('/branches/:id/extend',    ...superAdminOnly, extendLicense);
router.post('/branches/:id/suspend',   ...superAdminOnly, suspendBranch);
router.post('/branches/:id/activate',  ...superAdminOnly, activateBranch);
router.post('/branches/:id/revoke',    ...superAdminOnly, revokeBranch);
router.post('/branches/:id/plan',      ...superAdminOnly, changePlan);

// ─── Logs ────────────────────────────────────────────────────────────────────
router.get('/logs', ...superAdminOnly, getLicenseLogs);

module.exports = router;
