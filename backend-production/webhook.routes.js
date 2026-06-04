const express = require('express');
const router = express.Router();
const { handleSepayWebhook } = require('./webhook.controller');

// POST /api/webhooks/sepay
// KHÔNG dùng authenticate middleware — SEPay không gửi JWT
// Xác thực bằng API Key trong header Authorization
router.post('/sepay', handleSepayWebhook);

module.exports = router;
