const router = require('express').Router();
const {
  getServiceTickets,
  getServiceTicketById,
  createServiceTicket,
  confirmCashPayment,
  cancelServiceTicket,
} = require('./serviceTicket.controller');
const { authenticate, authorize } = require('./auth.middleware');

router.use(authenticate);

router.get('/',     getServiceTickets);
router.get('/:id',  getServiceTicketById);

router.post('/',                authorize('admin', 'manager', 'technician', 'sales'), createServiceTicket);
router.patch('/:id/confirm-cash', authorize('admin', 'manager', 'accountant'), confirmCashPayment);
router.patch('/:id/cancel',     authorize('admin', 'manager', 'technician', 'sales'), cancelServiceTicket);

module.exports = router;
