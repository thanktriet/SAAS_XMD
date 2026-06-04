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
} = require('./license.controller');

// Tất cả routes yêu cầu admin
const adminOnly = [authenticate, authorize('admin')];

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', ...adminOnly, getLicenseDashboard);

// ─── CRUD Chi nhánh ──────────────────────────────────────────────────────────
router.get('/branches',     ...adminOnly, getBranches);
router.get('/branches/:id', ...adminOnly, getBranch);
router.post('/branches',    ...adminOnly, createBranch);
router.put('/branches/:id', ...adminOnly, updateBranch);

// ─── License actions ─────────────────────────────────────────────────────────
router.post('/branches/:id/extend',    ...adminOnly, extendLicense);
router.post('/branches/:id/suspend',   ...adminOnly, suspendBranch);
router.post('/branches/:id/activate',  ...adminOnly, activateBranch);
router.post('/branches/:id/revoke',    ...adminOnly, revokeBranch);

// ─── Logs ────────────────────────────────────────────────────────────────────
router.get('/logs', ...adminOnly, getLicenseLogs);

module.exports = router;
