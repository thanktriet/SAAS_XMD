const router  = require('express').Router();
const multer  = require('multer');
const {
  getInventory, addVehicle, updateVehicle, deleteVehicle, getStockSummary,
  getSpareParts, getSparePartById, createSparePart, updateSparePart,
  stockIn, stockOut, getStockMovements, getLowStockAlert,
} = require('./inventory.controller');
const { previewImport, confirmImport, downloadTemplate } = require('./inventoryImport.controller');
const {
  getAccessories, getAccessoryById, createAccessory, updateAccessory,
  accessoryStockIn, accessoryStockOut, accessoryAdjust,
  getAccessoryMovements, getAccessoryLowStock,
} = require('./accessories.controller');
const {
  getGiftItems, getGiftItemById, createGiftItem, updateGiftItem,
  giftStockIn, giftStockOut, getGiftMovements,
  getOrderGifts, addOrderGift, issueOrderGift, getGiftLowStock,
} = require('./gifts.controller');
const { authenticate, authorize } = require('./auth.middleware');

// Multer nhận file Excel (tối đa 10 MB, chỉ .xlsx/.xls)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
    ].includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i);
    ok ? cb(null, true) : cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls)'));
  },
}).single('file');

router.use(authenticate);

// ─── Import Excel (đặt TRƯỚC /:id để tránh conflict) ─────────────────────────
router.get('/import/template', downloadTemplate);
router.post('/import/preview',
  authorize('admin', 'manager', 'warehouse'),
  (req, res, next) => uploadExcel(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  }),
  previewImport,
);
router.post('/import/confirm',
  authorize('admin', 'manager', 'warehouse'),
  confirmImport,
);

// ─── Phụ tùng (spare-parts) — đặt TRƯỚC /:id ─────────────────────────────────
router.get('/spare-parts',            getSpareParts);
router.get('/spare-parts/:id',        getSparePartById);
router.post('/spare-parts',
  authorize('admin', 'manager', 'warehouse'),
  createSparePart);
router.put('/spare-parts/:id',
  authorize('admin', 'manager', 'warehouse'),
  updateSparePart);
router.post('/spare-parts/:id/stock-in',
  authorize('admin', 'manager', 'warehouse'),
  stockIn);
router.post('/spare-parts/:id/stock-out',
  authorize('admin', 'manager', 'warehouse', 'technician'),
  stockOut);
router.get('/spare-parts/:id/movements', getStockMovements);

// ─── Tồn kho & cảnh báo ───────────────────────────────────────────────────────
router.get('/summary',   getStockSummary);
router.get('/low-stock', getLowStockAlert);

// ─── Phụ kiện (accessories) ───────────────────────────────────────────────────
router.get('/accessories/low-stock',           getAccessoryLowStock);
router.get('/accessories',                     getAccessories);
router.get('/accessories/:id',                 getAccessoryById);
router.post('/accessories',
  authorize('admin', 'warehouse'),  createAccessory);
router.put('/accessories/:id',
  authorize('admin', 'warehouse'),  updateAccessory);
router.post('/accessories/:id/stock-in',
  authorize('admin', 'manager', 'warehouse'),  accessoryStockIn);
router.post('/accessories/:id/stock-out',
  authorize('admin', 'manager', 'warehouse', 'sales'), accessoryStockOut);
router.post('/accessories/:id/adjust',
  authorize('admin', 'warehouse'),  accessoryAdjust);
router.get('/accessories/:id/movements',       getAccessoryMovements);

// ─── Quà tặng (gift-items) ────────────────────────────────────────────────────
router.get('/gift-items/low-stock',            getGiftLowStock);
router.get('/gift-items',                      getGiftItems);
router.get('/gift-items/:id',                  getGiftItemById);
router.post('/gift-items',
  authorize('admin', 'warehouse'),  createGiftItem);
router.put('/gift-items/:id',
  authorize('admin', 'warehouse'),  updateGiftItem);
router.post('/gift-items/:id/stock-in',
  authorize('admin', 'manager', 'warehouse'),  giftStockIn);
router.post('/gift-items/:id/stock-out',
  authorize('admin', 'manager', 'warehouse', 'sales'), giftStockOut);
router.get('/gift-items/:id/movements',        getGiftMovements);

// ─── Quà tặng theo đơn hàng (order-gifts) ────────────────────────────────────
router.get('/order-gifts/:order_id',           getOrderGifts);
router.post('/order-gifts/:order_id',
  authorize('admin', 'manager', 'sales', 'warehouse'), addOrderGift);
router.patch('/order-gifts/issue/:id',
  authorize('admin', 'manager', 'warehouse'),  issueOrderGift);

// ─── CRUD xe (đặt CUỐI để /:id không conflict với /spare-parts, /accessories, v.v.) ──
router.get('/',       getInventory);
router.post('/',      authorize('admin', 'manager', 'warehouse'), addVehicle);
router.put('/:id',    authorize('admin', 'warehouse'), updateVehicle);
router.delete('/:id', authorize('admin'), deleteVehicle);

module.exports = router;
