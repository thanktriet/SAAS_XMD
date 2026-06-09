const router = require('express').Router();
const multer = require('multer');
const {
  createOrder,
  updateOrder,
  getOrders,
  getOrderDetail,
  updateOrderStatus,
  updateDmsCode,
} = require('./sales.controller');
const { getAttachments, uploadAttachment, replaceAttachment, deleteAttachment, downloadAttachment } = require('./attachment.controller');
const { authenticate, authorize } = require('./auth.middleware');
const { validate } = require('./validate.middleware');
const { createOrderRules, updateOrderStatusRules } = require('./sales.validator');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

router.get('/', getOrders);
router.post('/', createOrderRules, validate, createOrder);
router.get('/:id', getOrderDetail);
router.put('/:id', createOrderRules, validate, updateOrder);
router.patch('/:id/status', updateOrderStatusRules, validate, updateOrderStatus);
router.patch('/:id/dms-code', authorize('admin', 'manager', 'accountant'), updateDmsCode);

// Attachments
router.get('/:id/attachments', getAttachments);
router.post('/:id/attachments', upload.single('file'), uploadAttachment);
router.put('/:id/attachments/:attachmentId', upload.single('file'), replaceAttachment);
router.delete('/:id/attachments/:attachmentId', deleteAttachment);
router.get('/:id/attachments/:attachmentId/download', downloadAttachment);

module.exports = router;
