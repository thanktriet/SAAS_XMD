const router = require('express').Router();
const {
  getRentals,
  getRentalById,
  createRental,
  returnAssignment,
  returnBySerial,
  cancelRental,
} = require('./batteryRental.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

router.get('/',     getRentals);
router.get('/:id',  getRentalById);

// Tạo & quản lý — sales / KTV / manager / admin
router.post('/',                  authorize('admin', 'manager', 'sales', 'technician'), createRental);
router.post('/return-by-serial',  authorize('admin', 'manager', 'sales', 'technician', 'warehouse'), returnBySerial);
router.post('/return-assignment', authorize('admin', 'manager', 'sales', 'technician', 'warehouse'), returnAssignment);
router.patch('/:id/cancel',       authorize('admin', 'manager'), cancelRental);

module.exports = router;
