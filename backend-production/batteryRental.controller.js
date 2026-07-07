const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { validateBatteryItems, returnBatteryToStock } = require('./battery.service');
const { generateCode } = require('./codeGenerator');

const userId = (req) => req.user?.sub || null;

// ─── Sinh mã phiếu — có prefix chi nhánh: CN01-TP202600001 ────────────────────
async function generateRentalCode(req) {
  return generateCode(req, {
    table: 'battery_rentals', column: 'rental_code',
    prefix: 'TP', padLength: 5, yearInPrefix: true,
  });
}

// ─── Danh sách phiếu thuê ─────────────────────────────────────────────────────
const getRentals = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 30 } = req.query;
    let q = getDb(req).from('battery_rentals')
      .select(`
        *,
        users!created_by(full_name),
        customers(full_name, phone, loyalty_points)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) q = q.eq('status', status);
    if (search) {
      const s = String(search).trim();
      q = q.or(`rental_code.ilike.%${s}%,customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,vehicle_vin.ilike.%${s}%`);
    }

    const { data: rentals, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    // Fetch assignments riêng (source_id polymorphic, không có FK)
    const rentalIds = (rentals || []).map(r => r.id);
    let assignmentsByRental = {};
    if (rentalIds.length > 0) {
      const { data: assignments } = await getDb(req).from('battery_assignments')
        .select('id, source_id, accessory_id, serial_number, status, accessories(name, code)')
        .eq('source_type', 'battery_rental')
        .in('source_id', rentalIds);
      for (const a of assignments || []) {
        if (!assignmentsByRental[a.source_id]) assignmentsByRental[a.source_id] = [];
        assignmentsByRental[a.source_id].push(a);
      }
    }

    const enriched = (rentals || []).map(r => ({
      ...r,
      battery_assignments: assignmentsByRental[r.id] || [],
    }));

    res.json({ data: enriched, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết phiếu thuê ──────────────────────────────────────────────────────
const getRentalById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await getDb(req).from('battery_rentals')
      .select(`
        *,
        users!created_by(full_name),
        customers(full_name, phone, loyalty_points, address)
      `)
      .eq('id', id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy phiếu thuê' });

    // Fetch assignments riêng
    const { data: assignments } = await getDb(req).from('battery_assignments')
      .select('*, accessories(name, code, category)')
      .eq('source_type', 'battery_rental')
      .eq('source_id', id);

    res.json({ ...data, battery_assignments: assignments || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo phiếu thuê pin mới ───────────────────────────────────────────────────
const createRental = async (req, res) => {
  try {
    const { customer_id, vehicle_vin, items, notes } = req.body;

    if (!customer_id) return res.status(400).json({ error: 'Phải gắn KH' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Phải chọn ít nhất 1 pin để thuê' });
    }

    // Verify KH
    const { data: cust, error: custErr } = await getDb(req).from('customers')
      .select('id, full_name, phone')
      .eq('id', customer_id)
      .single();
    if (custErr || !cust) return res.status(404).json({ error: 'Không tìm thấy KH' });

    // Force assignment_type = 'rent' cho mọi item
    const rentItems = items.map(it => ({ ...it, assignment_type: 'rent' }));

    // Validate pin: serial phải đủ + không trùng + chưa được assign
    const check = await validateBatteryItems(rentItems);
    if (!check.ok) return res.status(400).json({ error: check.error });

    // Verify từng pin có trong kho + check tồn kho
    const accIds = [...new Set(rentItems.map(i => i.accessory_id))];
    const { data: accs } = await getDb(req).from('accessories')
      .select('id, name, qty_in_stock, category')
      .in('id', accIds);
    if (!accs || accs.length !== accIds.length) {
      return res.status(400).json({ error: 'Có pin không tồn tại' });
    }
    for (const acc of accs) {
      if (acc.category !== 'battery') {
        return res.status(400).json({ error: `"${acc.name}" không phải pin (category != battery)` });
      }
      const totalQty = rentItems
        .filter(i => i.accessory_id === acc.id)
        .reduce((s, i) => s + Number(i.quantity), 0);
      if (totalQty > acc.qty_in_stock) {
        return res.status(400).json({ error: `Không đủ tồn: "${acc.name}" còn ${acc.qty_in_stock}, cần ${totalQty}` });
      }
    }

    const rental_code = await generateRentalCode();

    // Tạo phiếu
    const { data: rental, error: rErr } = await getDb(req).from('battery_rentals')
      .insert([{
        rental_code,
        customer_id:    cust.id,
        customer_name:  cust.full_name,
        customer_phone: cust.phone,
        vehicle_vin:    vehicle_vin?.trim() || null,
        notes:          notes?.trim() || null,
        created_by:     userId(req),
      }])
      .select()
      .single();
    if (rErr) return res.status(400).json({ error: rErr.message });

    // Tạo battery_assignments + giảm tồn kho
    const assignmentRows = [];
    const movementRows   = [];
    for (const it of rentItems) {
      const serials = (it.serial_numbers || []).map(s => String(s).trim()).filter(Boolean);
      for (const sn of serials) {
        assignmentRows.push({
          accessory_id:    it.accessory_id,
          serial_number:   sn,
          assignment_type: 'rent',
          customer_id:     cust.id,
          vehicle_vin:     vehicle_vin?.trim() || null,
          source_type:     'battery_rental',
          source_id:       rental.id,
          created_by:      userId(req),
        });
      }
      // Mỗi item = 1 movement export tổng
      movementRows.push({
        item_type:      'accessory',
        item_id:        it.accessory_id,
        movement_type:  'export',
        quantity:       Number(it.quantity),
        reference_type: 'battery_rental',
        reference_id:   rental.id,
        note:           `Thuê pin phiếu ${rental_code}`,
        created_by:     userId(req),
      });
    }

    if (assignmentRows.length > 0) {
      const { error: aErr } = await getDb(req).from('battery_assignments').insert(assignmentRows);
      if (aErr) {
        await getDb(req).from('battery_rentals').delete().eq('id', rental.id);
        return res.status(400).json({ error: `Lưu assignments thất bại: ${aErr.message}` });
      }
    }
    if (movementRows.length > 0) {
      const { error: mErr } = await getDb(req).from('item_movements').insert(movementRows);
      if (mErr) console.error(`[battery-rental] xuất kho thất bại: ${mErr.message}`);
    }

    // Trả về phiếu kèm assignments
    const { data: full } = await getDb(req).from('battery_rentals')
      .select(`
        *,
        users!created_by(full_name),
        customers(full_name, phone),
        battery_assignments!source_id(*, accessories(name, code))
      `)
      .eq('id', rental.id)
      .single();

    res.status(201).json(full);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Trả pin (theo từng assignment_id) ────────────────────────────────────────
const returnAssignment = async (req, res) => {
  try {
    const { assignment_id, reason } = req.body;
    if (!assignment_id) return res.status(400).json({ error: 'Thiếu assignment_id' });

    await returnBatteryToStock(assignment_id, {
      reason:           reason || 'normal_return',
      returnedToStock:  true,
      returnedBy:       userId(req),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Trả pin theo serial (search & return) ───────────────────────────────────
const returnBySerial = async (req, res) => {
  try {
    const { serial_number, reason } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'Thiếu serial pin' });

    const { data: a } = await getDb(req).from('battery_assignments')
      .select('id, status')
      .eq('serial_number', String(serial_number).trim())
      .eq('status', 'assigned')
      .maybeSingle();

    if (!a) return res.status(404).json({ error: `Không tìm thấy pin đang được giao với serial "${serial_number}"` });

    await returnBatteryToStock(a.id, {
      reason:           reason || 'normal_return',
      returnedToStock:  true,
      returnedBy:       userId(req),
    });

    res.json({ ok: true, assignment_id: a.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Hủy phiếu (chỉ khi tất cả pin chưa trả) ─────────────────────────────────
const cancelRental = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: r } = await getDb(req).from('battery_rentals').select('status').eq('id', id).single();
    if (!r) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
    if (r.status === 'completed') return res.status(409).json({ error: 'Phiếu đã hoàn tất, không thể hủy' });

    // Hủy luôn các assignment còn assigned + trả pin về kho
    const { data: assignments } = await getDb(req).from('battery_assignments')
      .select('id')
      .eq('source_type', 'battery_rental')
      .eq('source_id', id)
      .eq('status', 'assigned');

    for (const a of assignments || []) {
      try {
        await returnBatteryToStock(a.id, {
          reason: 'rental_cancelled',
          returnedToStock: true,
          returnedBy: userId(req),
        });
      } catch (e) {
        console.error('[battery-rental cancel]', e.message);
      }
    }

    const { data, error } = await getDb(req).from('battery_rentals')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getRentals,
  getRentalById,
  createRental,
  returnAssignment,
  returnBySerial,
  cancelRental,
};
