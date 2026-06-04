const router = require('express').Router();
const {
  getWarranties,
  createServiceRequest,
  getServiceRequests,
  updateServiceRequest,
} = require('./warranty.controller');
const { authenticate } = require('./auth.middleware');

router.use(authenticate);

// Bảo hành
router.get('/', getWarranties);

// Phiếu dịch vụ / sửa chữa
router.get('/services', getServiceRequests);
router.post('/services', createServiceRequest);
router.patch('/services/:id', updateServiceRequest);

module.exports = router;
