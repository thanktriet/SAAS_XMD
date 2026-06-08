// Notification & Push Subscription API routes
const router = require('express').Router();
const pool = require('./database');
const { authenticate } = require('./auth.middleware');

// ─── Push Subscription ───────────────────────────────────────────────────────

// POST /api/push/subscribe — save push subscription
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Thiếu thông tin subscription' });
    }

    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, branch_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
      [req.user.id, endpoint, keys.p256dh, keys.auth, req.user.branch_id || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Push] Subscribe error:', err.message);
    res.status(500).json({ error: 'Lỗi lưu subscription' });
  }
});

// DELETE /api/push/unsubscribe — remove push subscription
router.delete('/unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Thiếu endpoint' });
    }

    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Push] Unsubscribe error:', err.message);
    res.status(500).json({ error: 'Lỗi xóa subscription' });
  }
});

// GET /api/push/vapid-key — return public VAPID key
router.get('/vapid-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Push notifications chưa được cấu hình' });
  }
  res.json({ publicKey: key });
});

// ─── Notifications ───────────────────────────────────────────────────────────

// GET /api/notifications — list notifications for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { rows: data } = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
      [req.user.id]
    );

    const { rows: [{ count: unread }] } = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({ data, total: parseInt(count), unread: parseInt(unread), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[Notifications] List error:', err.message);
    res.status(500).json({ error: 'Lỗi tải thông báo' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ count: parseInt(count) });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi' });
  }
});

// PUT /api/notifications/:id/read — mark as read
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật' });
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi cập nhật' });
  }
});

module.exports = router;
