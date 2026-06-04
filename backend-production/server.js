const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const authRoutes          = require('./auth.routes');
const vehicleRoutes       = require('./vehicle.routes');
const inventoryRoutes     = require('./inventory.routes');
const customerRoutes      = require('./customer.routes');
const salesRoutes         = require('./sales.routes');
const warrantyRoutes      = require('./warranty.routes');
const financeRoutes       = require('./finance.routes');
const reportRoutes        = require('./report.routes');
const accessoriesRoutes   = require('./accessories.routes');
const uploadRoutes        = require('./upload.routes');
const purchaseOrderRoutes = require('./purchaseOrder.routes');
const promotionsRoutes    = require('./promotions.routes');
const settingsRoutes      = require('./settings.routes');
const serviceTicketRoutes = require('./serviceTicket.routes');
const accessoryOrderRoutes = require('./accessoryOrder.routes');
const batteryRentalRoutes = require('./batteryRental.routes');
const cashAdvanceRoutes = require('./cashAdvance.routes');
const cashDepositRoutes = require('./cashDeposit.routes');
const webhookRoutes        = require('./webhook.routes');
const paymentRoutes        = require('./payment.routes');
const brandingRoutes       = require('./branding.routes');
const licenseRoutes        = require('./license.routes');
const { errorHandler, notFoundHandler } = require('./error.middleware');

const app = express();

// CORS: FRONTEND_URL có thể liệt kê nhiều origin, phân tách bằng dấu phẩy
const corsOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Static files — serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Hệ Thống Bán Hàng Xe Máy Điện API đang hoạt động',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Routes
app.use('/api/auth',            authRoutes);
app.use('/api/vehicles',        vehicleRoutes);
app.use('/api/inventory',       inventoryRoutes);
app.use('/api/customers',       customerRoutes);
app.use('/api/sales',           salesRoutes);
app.use('/api/sales/:id/payments', paymentRoutes); // thanh toán theo đơn hàng
app.use('/api/warranty',        warrantyRoutes);
app.use('/api/finance',         financeRoutes);
app.use('/api/accounting',      financeRoutes); // CashflowPage gọi /api/accounting/cashflow/today
app.use('/api/reports',         reportRoutes);
app.use('/api/accessories',     accessoriesRoutes);
app.use('/api/upload',          uploadRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/promotions',      promotionsRoutes);
app.use('/api/settings',        settingsRoutes);
app.use('/api/service-tickets', serviceTicketRoutes);
app.use('/api/accessory-orders', accessoryOrderRoutes);
app.use('/api/battery-rentals', batteryRentalRoutes);
app.use('/api/cash-advances', cashAdvanceRoutes);
app.use('/api/cash-deposits', cashDepositRoutes);
app.use('/api/branding',      brandingRoutes);
app.use('/api/license',       licenseRoutes);

// Webhook — đặt TRƯỚC notFoundHandler, KHÔNG cần JWT (SEPay gửi API Key riêng)
app.use('/api/webhooks',        webhookRoutes);

// 404 & Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API Health: http://localhost:${PORT}/api/health`);
  console.log(`Env: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
