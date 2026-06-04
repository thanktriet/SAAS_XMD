// accessories.routes.js — mount tại /api/accessories
// Toàn bộ logic đã chuyển vào inventory.routes.js (/api/inventory/accessories)
// File này giữ lại để tương thích ngược với PurchaseOrdersPage.tsx gọi /api/accessories
const router = require('express').Router();
const {
  getAccessories,
  getAccessoryById,
  createAccessory,
  updateAccessory,
  accessoryStockIn,
  accessoryStockOut,
  accessoryAdjust,
  getAccessoryMovements,
  getAccessoryLowStock,
} = require('./accessories.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

router.get('/low-stock',          getAccessoryLowStock);
router.get('/',                   getAccessories);
router.get('/:id',                getAccessoryById);
router.post('/',
  authorize('admin', 'warehouse'), createAccessory);
router.put('/:id',
  authorize('admin', 'warehouse'), updateAccessory);
router.post('/:id/stock-in',
  authorize('admin', 'manager', 'warehouse'), accessoryStockIn);
router.post('/:id/stock-out',
  authorize('admin', 'manager', 'warehouse', 'sales'), accessoryStockOut);
router.post('/:id/adjust',
  authorize('admin', 'warehouse'), accessoryAdjust);
router.get('/:id/movements',      getAccessoryMovements);

module.exports = router;
