const router = require('express').Router();
const {
  getVehicleModels,
  getVehicleModelDetail,
  createVehicleModel,
  updateVehicleModel,
  deleteVehicleModel,
  getBrands,
  getModelColors,
  addModelColor,
  updateModelColor,
  deleteModelColor,
} = require('./vehicle.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

// GET: ai cũng xem được (POS cần xem danh sách mẫu xe để tạo đơn)
router.get('/brands', getBrands);
router.get('/', getVehicleModels);
router.get('/:id', getVehicleModelDetail);

// Colors — GET: ai cũng xem được
router.get('/:id/colors', getModelColors);

// CRUD mẫu xe: chỉ admin
router.post('/',     authorize('admin'), createVehicleModel);
router.put('/:id',   authorize('admin'), updateVehicleModel);
router.delete('/:id', authorize('admin'), deleteVehicleModel);

// Colors CRUD: chỉ admin
router.post('/:id/colors',       authorize('admin'), addModelColor);
router.patch('/colors/:colorId', authorize('admin'), updateModelColor);
router.delete('/colors/:colorId', authorize('admin'), deleteModelColor);

module.exports = router;
