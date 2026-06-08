// Push Notification Service — web-push wrapper
const webpush = require('web-push');
const pool = require('./database');

// Configure VAPID keys from env
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@xmd.vn';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('[Push] VAPID keys not configured — push notifications disabled');
}

/**
 * Send push notification to a specific user
 */
async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY) return;

  const { rows: subs } = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    )
  );

  // Clean up expired subscriptions (410 Gone)
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected' && results[i].reason?.statusCode === 410) {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE endpoint = $1',
        [subs[i].endpoint]
      );
    }
  }
}

/**
 * Send push notification to all users in a branch with specific roles
 */
async function sendPushToBranch(branchId, roles, payload) {
  if (!VAPID_PUBLIC_KEY) return;

  const placeholders = roles.map((_, i) => `$${i + 2}`).join(',');
  const { rows: subs } = await pool.query(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.branch_id = $1 AND u.role IN (${placeholders})`,
    [branchId, ...roles]
  );

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    )
  );

  // Cleanup expired
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected' && results[i].reason?.statusCode === 410) {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE endpoint = $1',
        [subs[i].endpoint]
      );
    }
  }
}

/**
 * Create an in-app notification + send push
 */
async function createNotification({ userId, branchId, title, body, type, referenceType, referenceId, url }) {
  // Save to DB
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, branch_id, title, body, type, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, branchId, title, body, type, referenceType || null, referenceId || null]
  );

  // Send push
  await sendPushToUser(userId, {
    title,
    body,
    url: url || '/m/notifications',
    tag: `${type}-${referenceId || Date.now()}`,
  });

  return rows[0];
}

/**
 * Notify branch managers about a new order
 */
async function notifyNewOrder(order, salespersonName, branchId) {
  const { rows: managers } = await pool.query(
    `SELECT id FROM users WHERE branch_id = $1 AND role IN ('admin', 'manager') AND is_active = true`,
    [branchId]
  );

  for (const mgr of managers) {
    await createNotification({
      userId: mgr.id,
      branchId,
      title: 'Đơn hàng mới',
      body: `${salespersonName} vừa tạo đơn #${order.order_number}`,
      type: 'new_order',
      referenceType: 'sales_order',
      referenceId: order.id,
      url: `/m/sales/${order.id}`,
    });
  }
}

/**
 * Notify sales owner about payment received
 */
async function notifyPaymentReceived(order, amount) {
  await createNotification({
    userId: order.salesperson_id,
    branchId: order.branch_id,
    title: 'Thanh toán thành công',
    body: `Đơn #${order.order_number} đã nhận ${new Intl.NumberFormat('vi-VN').format(amount)}đ`,
    type: 'payment_received',
    referenceType: 'sales_order',
    referenceId: order.id,
    url: `/m/sales/${order.id}`,
  });
}

/**
 * Notify about pending orders (> 30 min without action)
 * Call this from a cron job
 */
async function notifyPendingOrders() {
  const { rows: pending } = await pool.query(
    `SELECT id, order_number, salesperson_id, branch_id
     FROM sales_orders
     WHERE status = 'confirmed'
       AND updated_at < NOW() - INTERVAL '30 minutes'
       AND id NOT IN (
         SELECT reference_id FROM notifications
         WHERE type = 'order_pending_reminder'
           AND created_at > NOW() - INTERVAL '1 hour'
           AND reference_type = 'sales_order'
       )`
  );

  for (const order of pending) {
    await createNotification({
      userId: order.salesperson_id,
      branchId: order.branch_id,
      title: 'Đơn chờ xử lý',
      body: `Đơn #${order.order_number} chờ xác nhận thanh toán`,
      type: 'order_pending_reminder',
      referenceType: 'sales_order',
      referenceId: order.id,
      url: `/m/sales/${order.id}`,
    });
  }
}

module.exports = {
  sendPushToUser,
  sendPushToBranch,
  createNotification,
  notifyNewOrder,
  notifyPaymentReceived,
  notifyPendingOrders,
};
