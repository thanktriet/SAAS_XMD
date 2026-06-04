// Helpers xử lý pin xe — gắn KH với serial, trả pin về kho, validate
const { supabaseAdmin } = require('./config/supabase');

/**
 * Kiểm tra một accessory_id có phải là pin xe không (category === 'battery')
 */
async function isBatteryAccessory(accessoryId) {
  const { data } = await supabaseAdmin
    .from('accessories')
    .select('category')
    .eq('id', accessoryId)
    .single();
  return data?.category === 'battery';
}

/**
 * Validate đầu vào battery items.
 * Mỗi item có: { accessory_id, quantity, serial_numbers[], assignment_type, ... }
 *   - Nếu là pin: phải có đúng N serial (= quantity), serial không rỗng, không trùng nhau trong cùng đơn
 *   - assignment_type: 'purchase' | 'rent'
 * Trả về { ok: true } hoặc { ok: false, error: '...' }
 */
async function validateBatteryItems(items) {
  const allSerials = [];
  for (const it of items) {
    const isBattery = await isBatteryAccessory(it.accessory_id);
    if (!isBattery) continue;

    const qty = Number(it.quantity);
    const serials = Array.isArray(it.serial_numbers)
      ? it.serial_numbers.map(s => String(s).trim()).filter(Boolean)
      : [];

    if (serials.length !== qty) {
      return { ok: false, error: `Pin: cần ${qty} serial nhưng nhận ${serials.length}` };
    }
    const dup = serials.find((s, i) => serials.indexOf(s) !== i);
    if (dup) return { ok: false, error: `Serial pin trùng trong đơn: ${dup}` };

    const at = it.assignment_type;
    if (!['purchase', 'rent'].includes(at)) {
      return { ok: false, error: `Pin cần chọn loại: mua đứt hay thuê` };
    }

    allSerials.push(...serials);
  }

  // Check serial đã được assign chưa (status = 'assigned')
  if (allSerials.length > 0) {
    const { data: existing } = await supabaseAdmin
      .from('battery_assignments')
      .select('serial_number, customer_id')
      .in('serial_number', allSerials)
      .eq('status', 'assigned');
    if (existing && existing.length > 0) {
      const list = existing.map(e => e.serial_number).join(', ');
      return { ok: false, error: `Serial đang được gán: ${list}` };
    }
  }

  return { ok: true };
}

/**
 * Tính số tiền cần thu thực tế cho 1 item — pin thuê thì không tính
 */
function effectiveLineTotal(item, isBattery) {
  const qty = Number(item.quantity);
  const price = Number(item.unit_price ?? 0);
  if (isBattery && item.assignment_type === 'rent') return 0;
  return price * qty;
}

/**
 * Tạo battery_assignments cho mỗi serial trong items (tự động bỏ qua item không phải pin)
 */
async function createAssignments({ items, customerId, vehicleVin, vehicleId, sourceType, sourceId, createdBy }) {
  const rows = [];
  for (const it of items) {
    const isBattery = await isBatteryAccessory(it.accessory_id);
    if (!isBattery) continue;

    const serials = Array.isArray(it.serial_numbers)
      ? it.serial_numbers.map(s => String(s).trim()).filter(Boolean)
      : [];

    for (const sn of serials) {
      rows.push({
        accessory_id:    it.accessory_id,
        serial_number:   sn,
        assignment_type: it.assignment_type,
        customer_id:     customerId || null,
        vehicle_vin:     vehicleVin || null,
        vehicle_id:      vehicleId || null,
        source_type:     sourceType,
        source_id:       sourceId,
        created_by:      createdBy || null,
      });
    }
  }
  if (rows.length === 0) return { count: 0 };

  const { error } = await supabaseAdmin.from('battery_assignments').insert(rows);
  if (error) throw new Error(`Lưu battery_assignments thất bại: ${error.message}`);
  return { count: rows.length };
}

/**
 * Trả pin về kho — đánh dấu returned + tăng tồn kho qua item_movements (import)
 */
async function returnBatteryToStock(assignmentId, { reason, returnedToStock = true, returnedBy }) {
  const { data: a, error: fErr } = await supabaseAdmin
    .from('battery_assignments')
    .select('id, accessory_id, serial_number, status')
    .eq('id', assignmentId)
    .single();
  if (fErr || !a) throw new Error('Không tìm thấy bản ghi pin');
  if (a.status === 'returned') throw new Error('Pin đã trả rồi');

  const { error: updErr } = await supabaseAdmin
    .from('battery_assignments')
    .update({
      status:            'returned',
      returned_at:       new Date().toISOString(),
      returned_to_stock: returnedToStock,
      return_reason:     reason || 'normal_return',
    })
    .eq('id', assignmentId);
  if (updErr) throw new Error(updErr.message);

  // Nếu returnedToStock — tăng tồn pin lên 1 (qua item_movement import)
  if (returnedToStock) {
    const { error: mvErr } = await supabaseAdmin.from('item_movements').insert({
      item_type:      'accessory',
      item_id:        a.accessory_id,
      movement_type:  'import',
      quantity:       1,
      reference_type: 'battery_return',
      reference_id:   assignmentId,
      note:           `Trả pin serial ${a.serial_number}`,
      created_by:     returnedBy || null,
    });
    if (mvErr) console.error(`[battery] tăng tồn kho thất bại: ${mvErr.message}`);
  }

  return { ok: true };
}

module.exports = {
  isBatteryAccessory,
  validateBatteryItems,
  effectiveLineTotal,
  createAssignments,
  returnBatteryToStock,
};
