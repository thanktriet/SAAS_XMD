// Helper tích điểm khách hàng — dùng chung cho đơn bán xe + phiếu DV
const { supabaseAdmin } = require('./config/supabase');

let _cache = { ratio: 10000, enabled: true, ts: 0 };

// Lấy cấu hình tích điểm từ payment_settings, cache 60s
async function getLoyaltyConfig() {
  const now = Date.now();
  if (now - _cache.ts < 60_000) return _cache;

  const { data } = await supabaseAdmin
    .from('payment_settings')
    .select('key, value')
    .in('key', ['loyalty_amount_per_point', 'loyalty_enabled']);

  const map = {};
  (data || []).forEach(r => { map[r.key] = r.value; });

  _cache = {
    ratio:   Number(map.loyalty_amount_per_point) || 10000,
    enabled: (map.loyalty_enabled ?? 'true') !== 'false',
    ts:      now,
  };
  return _cache;
}

/**
 * Cộng điểm tích lũy cho KH theo số tiền chi tiêu.
 * Tự đọc tỷ lệ từ payment_settings (loyalty_amount_per_point).
 * Trả về số điểm thực tế đã cộng (0 nếu tắt hoặc thiếu thông tin).
 */
async function awardLoyaltyPoints(customerId, amount, source) {
  if (!customerId || !amount || amount <= 0) return 0;

  const cfg = await getLoyaltyConfig();
  if (!cfg.enabled || cfg.ratio <= 0) return 0;

  const points = Math.floor(Number(amount) / cfg.ratio);
  if (points <= 0) return 0;

  // Đọc điểm hiện tại
  const { data: cur, error: readErr } = await supabaseAdmin
    .from('customers')
    .select('loyalty_points')
    .eq('id', customerId)
    .single();
  if (readErr || !cur) return 0;

  const newPoints = (cur.loyalty_points || 0) + points;
  const { error: updErr } = await supabaseAdmin
    .from('customers')
    .update({ loyalty_points: newPoints })
    .eq('id', customerId);
  if (updErr) {
    console.error(`[loyalty] cộng điểm thất bại (KH ${customerId}):`, updErr.message);
    return 0;
  }

  console.log(`[loyalty] +${points} điểm cho KH ${customerId} (${source ?? '?'}) → tổng ${newPoints}`);
  return points;
}

module.exports = { awardLoyaltyPoints, getLoyaltyConfig };
