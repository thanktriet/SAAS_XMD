const router = require('express').Router();
const {
  getVehicleModels,
  getVehicleModelDetail,
  createVehicleModel,
  updateVehicleModel,
  deleteVehicleModel,
  getBrands,
} = require('./vehicle.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

// GET: ai cũng xem được (POS cần xem danh sách mẫu xe để tạo đơn)
router.get('/brands', getBrands);
router.get('/', getVehicleModels);
router.get('/:id', getVehicleModelDetail);

// CRUD: chỉ admin
router.post('/',     authorize('admin'), createVehicleModel);
router.put('/:id',   authorize('admin'), updateVehicleModel);
router.delete('/:id', authorize('admin'), deleteVehicleModel);

module.exports = router;
