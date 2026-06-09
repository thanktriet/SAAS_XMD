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

// Check vehicle conflict — đặt TRƯỚC /:id để không bị match sai
router.get('/check-vehicle-conflict', async (req, res) => {
  try {
    const { vehicle_id, exclude_order_id } = req.query;
    if (!vehicle_id) return res.status(400).json({ error: 'Thiếu vehicle_id' });

    const { supabaseAdmin } = require('./config/supabase');
    const db = req.db || supabaseAdmin;

    let q = db.from('sales_order_items')
      .select('order_id, sales_orders(id, order_number, status, customers(full_name))')
      .eq('inventory_vehicle_id', vehicle_id);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    // Filter: chỉ đơn chưa huỷ và chưa giao
    let conflicts = (data ?? []).filter(item => {
      const order = item.sales_orders;
      if (!order) return false;
      if (order.status === 'cancelled' || order.status === 'delivered') return false;
      if (exclude_order_id && order.id === exclude_order_id) return false;
      return true;
    }).map(item => ({
      order_id: item.order_id,
      order_number: item.sales_orders?.order_number,
      status: item.sales_orders?.status,
      customer_name: item.sales_orders?.customers?.full_name,
    }));

    res.json({ data: conflicts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', getOrders);
router.post('/', createOrderRules, validate, createOrder);
router.get('/:id', getOrderDetail);
router.put('/:id', createOrderRules, validate, updateOrder);
router.patch('/:id/status', updateOrderStatusRules, validate, updateOrderStatus);
router.patch('/:id/dms-code', authorize('admin', 'manager', 'accountant'), updateDmsCode);

// Attachments
router.get('/:id/attachments', getAttachments);
router.post('/:id/attachments', upload.array('files', 10), uploadAttachment);
router.put('/:id/attachments/:attachmentId', upload.single('file'), replaceAttachment);
router.delete('/:id/attachments/:attachmentId', deleteAttachment);
router.get('/:id/attachments/:attachmentId/download', downloadAttachment);

module.exports = router;
