const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }
const { generateCode } = require('./codeGenerator');

// ═══════════════════════════════════════════════════════════════════════════════
// ĐƠN NHẬP HÀNG (Purchase Orders)
// Quy tắc: 1 đơn nhập = 1 loại hàng duy nhất
//   item_type = 'vehicle'    → nhập xe máy điện
//   item_type = 'spare_part' → nhập phụ tùng / linh kiện
//   item_type = 'accessory'  → nhập phụ kiện bán kèm
//
// Luồng: draft → submitted → approved → (partial_received →) fully_received
//        → invoiced → paid
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helper: select chuẩn cho PO ─────────────────────────────────────────────
const PO_SELECT = `
  id, po_number, status, item_type, order_date, expected_date, actual_date,
  subtotal, vat_amount, total_amount, paid_amount, balance_due,
  payment_due_date, payment_method, payment_terms,
  supplier_invoice_number, supplier_invoice_date,
  warehouse_note, notes, cancel_reason, created_at,
  acc_suppliers ( id, supplier_code, supplier_name, phone, email ),
  users!created_by  ( full_name )
`;

// ─── Helper: select cho PO items (đa loại hàng) ──────────────────────────────
const POI_SELECT = `
  *,
  vehicle_models ( id, brand, model_name, category, image_url, price_cost ),
  spare_parts    ( id, code, name, unit, price_cost ),
  accessories    ( id, code, name, unit, price_sell )
`;

// ─── Danh sách nhà cung cấp (cho dropdown frontend) ──────────────────────────
const getSuppliers = async (req, res) => {
  try {
    const { search } = req.query;
    let q = getDb(req).from('acc_suppliers')
      .select('id, supplier_code, supplier_name, phone, email, payment_terms, is_active')
      .eq('is_active', true)
      .order('supplier_name');

    if (search) q = q.or(`supplier_name.ilike.%${search}%,supplier_code.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders — Danh sách đơn nhập hàng
const getPurchaseOrders = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const { status, from_date, to_date, search } = req.query;

    let q = getDb(req).from('purchase_orders')
      .select(PO_SELECT, { count: 'exact' })
      .order('order_date',  { ascending: false })
      .order('created_at',  { ascending: false });

    if (status)    q = q.eq('status', status);
    if (from_date) q = q.gte('order_date', from_date);
    if (to_date)   q = q.lte('order_date', to_date);
    if (search)    q = q.or(`po_number.ilike.%${search}%`);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/:id — Chi tiết đơn kèm items (xe + phụ tùng + phụ kiện)
const getPurchaseOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const [poRes, itemsRes, receiptsRes] = await Promise.all([
      getDb(req).from('purchase_orders')
        .select(`
          *,
          acc_suppliers ( id, supplier_code, supplier_name, phone, email, bank_account, bank_name ),
          users!created_by   ( full_name ),
          users!approved_by  ( full_name ),
          users!received_by  ( full_name )
        `)
        .eq('id', id)
        .single(),

      // Lấy items kèm thông tin chi tiết theo từng loại hàng
      getDb(req).from('purchase_order_items')
        .select(POI_SELECT)
        .eq('po_id', id)
        .order('line_number'),

      getDb(req).from('purchase_receipts')
        .select('id, receipt_number, receipt_date, status, notes')
        .eq('po_id', id)
        .order('receipt_date', { ascending: false }),
    ]);

    if (!poRes.data) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });
    res.json({
      purchase_order: poRes.data,
      items:    itemsRes.data    || [],
      receipts: receiptsRes.data || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/purchase-orders — Tạo đơn nhập mới (draft)
// 1 đơn chỉ 1 loại hàng: item_type xác định loại cho toàn bộ đơn
//   'vehicle'    → nhập xe     (các dòng items dùng vehicle_model_id)
//   'spare_part' → nhập phụ tùng (các dòng items dùng spare_part_id)
//   'accessory'  → nhập phụ kiện (các dòng items dùng accessory_id)
const createPurchaseOrder = async (req, res) => {
  try {
    const {
      supplier_id, branch_id, order_date, expected_date,
      payment_terms, payment_method, notes, warehouse_note,
      item_type,   // loại hàng của cả đơn: 'vehicle' | 'spare_part' | 'accessory'
      items = [],
    } = req.body;

    if (!supplier_id)  return res.status(400).json({ error: 'Thiếu nhà cung cấp (supplier_id)' });
    if (!item_type || !['vehicle', 'spare_part', 'accessory'].includes(item_type))
      return res.status(400).json({ error: 'item_type phải là "vehicle", "spare_part" hoặc "accessory"' });
    if (!items.length) return res.status(400).json({ error: 'Đơn nhập cần ít nhất 1 dòng hàng' });

    // Validate từng dòng — bắt buộc cùng loại với item_type của đơn
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (item_type === 'vehicle'    && !it.vehicle_model_id)
        return res.status(400).json({ error: `Dòng ${i + 1}: chọn mẫu xe (vehicle_model_id)` });
      if (item_type === 'spare_part' && !it.spare_part_id)
        return res.status(400).json({ error: `Dòng ${i + 1}: chọn phụ tùng (spare_part_id)` });
      if (item_type === 'accessory'  && !it.accessory_id)
        return res.status(400).json({ error: `Dòng ${i + 1}: chọn phụ kiện (accessory_id)` });
      if (!it.qty_ordered || it.qty_ordered < 1)
        return res.status(400).json({ error: `Dòng ${i + 1}: số lượng phải >= 1` });
    }

    // Kiểm tra NCC tồn tại
    const { data: ncc, error: nccErr } = await getDb(req).from('acc_suppliers').select('id, supplier_name, payment_terms').eq('id', supplier_id).single();
    if (nccErr || !ncc) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });

    // Tạo đầu phiếu — item_type ghi vào đơn để biết loại hàng
    const { data: po, error: poErr } = await getDb(req).from('purchase_orders')
      .insert([{
        supplier_id,
        branch_id:      branch_id     || null,
        order_date:     order_date    || new Date().toISOString().slice(0, 10),
        expected_date:  expected_date || null,
        payment_terms:  payment_terms ?? ncc.payment_terms ?? 30,
        payment_method: payment_method || null,
        notes:          notes          || null,
        warehouse_note: warehouse_note || null,
        item_type,    // 'vehicle' | 'spare_part' | 'accessory'
        status:         'draft',
        created_by:     req.user?.sub  || null,
        po_number:      '',   // tự sinh qua trigger fn_generate_po_number
      }])
      .select()
      .single();

    if (poErr) return res.status(400).json({ error: poErr.message });

    // Xây dựng các dòng chi tiết — tất cả cùng item_type với đơn
    const itemRows = items.map((it, idx) => ({
      po_id:            po.id,
      line_number:      idx + 1,
      item_type,
      // Xe
      vehicle_model_id: item_type === 'vehicle'    ? (it.vehicle_model_id || null) : null,
      color:            item_type === 'vehicle'    ? (it.color            || null) : null,
      year_manufacture: item_type === 'vehicle'    ? (it.year_manufacture || new Date().getFullYear()) : null,
      // Phụ tùng
      spare_part_id:    item_type === 'spare_part' ? (it.spare_part_id   || null) : null,
      // Phụ kiện
      accessory_id:     item_type === 'accessory'  ? (it.accessory_id    || null) : null,
      // Tên dự phòng
      item_name:        it.item_name || null,
      // Số lượng + giá
      qty_ordered:      it.qty_ordered,
      unit_cost:        it.unit_cost  || 0,
      vat_rate:         it.vat_rate   ?? 10,
      notes:            it.notes      || null,
    }));

    const { error: itemErr } = await getDb(req).from('purchase_order_items')
      .insert(itemRows);

    if (itemErr) {
      await getDb(req).from('purchase_orders').delete().eq('id', po.id);
      return res.status(400).json({ error: itemErr.message });
    }

    // Lấy lại PO với tổng tiền đã được trigger tính
    const { data: finalPO } = await getDb(req).from('purchase_orders').select(PO_SELECT).eq('id', po.id).single();

    res.status(201).json({
      message: `Đã tạo đơn nhập ${finalPO?.po_number || po.po_number}`,
      data: finalPO,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/purchase-orders/:id — Cập nhật thông tin (chỉ khi draft)
const updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur } = await getDb(req).from('purchase_orders').select('status, po_number').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });

    if (cur.status !== 'draft')
      return res.status(409).json({ error: `Đơn ${cur.po_number} đang ở trạng thái "${cur.status}" — chỉ sửa được khi còn draft` });

    const allowed = ['supplier_id', 'expected_date', 'payment_terms', 'payment_method', 'notes', 'warehouse_note'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const { data, error } = await getDb(req).from('purchase_orders').update(updates).eq('id', id).select(PO_SELECT).single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: `Đã cập nhật đơn ${cur.po_number}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/purchase-orders/:id/status — Chuyển trạng thái đơn
const updatePOStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cancel_reason } = req.body;

    const allowedTransitions = {
      draft:            ['submitted', 'cancelled'],
      submitted:        ['approved', 'rejected', 'cancelled'],
      approved:         ['cancelled'],
      partial_received: [],
      fully_received:   ['invoiced'],
      invoiced:         ['paid'],
    };

    const { data: cur } = await getDb(req).from('purchase_orders').select('status, po_number').eq('id', id).single();
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });

    const ok = (allowedTransitions[cur.status] || []).includes(status);
    if (!ok)
      return res.status(409).json({
        error: `Không thể chuyển từ "${cur.status}" sang "${status}"`,
      });

    const updates = { status };
    if (status === 'submitted')  updates.submitted_by = req.user?.sub || null;
    if (status === 'approved')   updates.approved_by  = req.user?.sub || null;
    if (status === 'cancelled')  updates.cancel_reason = cancel_reason || null;
    if (status === 'invoiced' && req.body.supplier_invoice_number) {
      updates.supplier_invoice_number = req.body.supplier_invoice_number;
      updates.supplier_invoice_date   = req.body.supplier_invoice_date || new Date().toISOString().slice(0, 10);
    }
    if (status === 'approved' && req.body.payment_due_date) {
      updates.payment_due_date = req.body.payment_due_date;
    }

    const { data, error } = await getDb(req).from('purchase_orders').update(updates).eq('id', id).select(PO_SELECT).single();
    if (error) return res.status(400).json({ error: error.message });

    const tenTrangThai = {
      submitted: 'đã gửi NCC', approved: 'đã duyệt', rejected: 'đã từ chối',
      cancelled: 'đã hủy', invoiced: 'đã có hóa đơn', paid: 'đã thanh toán',
    };
    res.json({ message: `Đơn ${cur.po_number} ${tenTrangThai[status] ?? status}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/purchase-orders/:id/receipts — Tạo phiếu nhận hàng
// Body:
//   receipt_date, notes
//   vehicles: [{ po_item_id, vin, engine_number, battery_serial, color, year_manufacture, condition, defect_notes, actual_unit_cost }]
//   parts:    [{ po_item_id, qty_received, condition, defect_notes }]  ← phụ tùng + phụ kiện
const createReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { receipt_date, notes, vehicles = [], parts = [] } = req.body;

    const { data: po } = await getDb(req).from('purchase_orders').select('status, po_number').eq('id', id).single();
    if (!po) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });
    if (!['approved', 'partial_received'].includes(po.status))
      return res.status(409).json({
        error: `Đơn phải ở trạng thái "approved" hoặc "partial_received" để nhận hàng (hiện: ${po.status})`,
      });

    const tongHang = vehicles.length + parts.length;
    if (tongHang === 0)
      return res.status(400).json({ error: 'Cần ít nhất 1 mặt hàng để tạo phiếu nhận' });

    // Tạo phiếu nhận (receipt_number tự sinh qua trigger)
    const { data: receipt, error: rcpErr } = await getDb(req).from('purchase_receipts')
      .insert([{
        po_id:          id,
        receipt_date:   receipt_date || new Date().toISOString().slice(0, 10),
        notes:          notes || null,
        status:         'pending',
        received_by:    req.user?.sub || null,
        receipt_number: '',
      }])
      .select()
      .single();

    if (rcpErr) return res.status(400).json({ error: rcpErr.message });

    // ── Dòng xe ────────────────────────────────────────────────────────────
    const itemRows = [];
    let lineNum = 1;

    for (const v of vehicles) {
      itemRows.push({
        receipt_id:       receipt.id,
        po_item_id:       v.po_item_id,
        line_number:      lineNum++,
        item_type:        'vehicle',
        vin:              v.vin              || null,
        engine_number:    v.engine_number    || null,
        battery_serial:   v.battery_serial   || null,
        color:            v.color            || null,
        year_manufacture: v.year_manufacture || null,
        condition:        v.condition        || 'ok',
        defect_notes:     v.defect_notes     || null,
        actual_unit_cost: v.actual_unit_cost || null,
        qty_received:     1,
      });
    }

    // ── Dòng phụ tùng / phụ kiện ───────────────────────────────────────────
    for (const p of parts) {
      if (!p.po_item_id) continue;
      if (!p.qty_received || p.qty_received < 1)
        return res.status(400).json({ error: 'Số lượng nhận phụ tùng/phụ kiện phải >= 1' });

      // Lấy item_type từ PO item để điền đúng cột
      const { data: poItem } = await getDb(req).from('purchase_order_items')
        .select('item_type, spare_part_id, accessory_id')
        .eq('id', p.po_item_id)
        .single();

      itemRows.push({
        receipt_id:    receipt.id,
        po_item_id:    p.po_item_id,
        line_number:   lineNum++,
        item_type:     poItem?.item_type     || 'spare_part',
        spare_part_id: poItem?.spare_part_id || null,
        accessory_id:  poItem?.accessory_id  || null,
        condition:     p.condition           || 'ok',
        defect_notes:  p.defect_notes        || null,
        qty_received:  p.qty_received,
      });
    }

    const { error: itemErr } = await getDb(req).from('purchase_receipt_items').insert(itemRows);

    if (itemErr) {
      await getDb(req).from('purchase_receipts').delete().eq('id', receipt.id);
      return res.status(400).json({ error: itemErr.message });
    }

    res.status(201).json({
      message: `Đã tạo phiếu nhận hàng cho đơn ${po.po_number}`,
      data: receipt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/purchase-orders/receipts/:receiptId/accept — Chấp nhận phiếu → tự nhập kho
const acceptReceipt = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const { inspected_by, inspection_notes } = req.body;

    const { data: rcp } = await getDb(req).from('purchase_receipts').select('status, receipt_number').eq('id', receiptId).single();
    if (!rcp) return res.status(404).json({ error: 'Không tìm thấy phiếu nhận hàng' });
    if (rcp.status === 'accepted') return res.status(409).json({ error: 'Phiếu đã được chấp nhận rồi' });

    // Cập nhật status → accepted
    // Trigger fn_receipt_accepted sẽ tự động:
    //   - Xe:        tạo inventory_vehicles
    //   - Phụ tùng:  ghi stock_movements (import) → cộng qty_in_stock
    //   - Phụ kiện:  cộng qty_received trên PO item
    const { data, error } = await getDb(req).from('purchase_receipts')
      .update({
        status:           'accepted',
        inspected_by:     inspected_by || req.user?.sub || null,
        inspection_notes: inspection_notes || null,
      })
      .eq('id', receiptId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Thống kê số lượng từng loại đã nhập
    const { data: items } = await getDb(req).from('purchase_receipt_items')
      .select('item_type, qty_received, condition')
      .eq('receipt_id', receiptId)
      .in('condition', ['ok', 'defect']);

    const slXe   = (items || []).filter(x => x.item_type === 'vehicle').length;
    const slPT   = (items || []).filter(x => x.item_type === 'spare_part').reduce((s, x) => s + x.qty_received, 0);
    const slPK   = (items || []).filter(x => x.item_type === 'accessory').reduce((s, x) => s + x.qty_received, 0);

    const tongKet = [
      slXe  > 0 ? `${slXe} xe`           : null,
      slPT  > 0 ? `${slPT} phụ tùng`     : null,
      slPK  > 0 ? `${slPK} phụ kiện`     : null,
    ].filter(Boolean).join(', ');

    res.json({
      message: `Phiếu ${rcp.receipt_number} đã chấp nhận — nhập kho: ${tongKet || '0 hàng'}`,
      data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/receipts/:receiptId — Chi tiết phiếu nhận hàng
const getReceiptDetail = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const [rcpRes, itemsRes] = await Promise.all([
      getDb(req).from('purchase_receipts').select('*').eq('id', receiptId).single(),
      getDb(req).from('purchase_receipt_items')
        .select(`
          *,
          purchase_order_items (
            item_type, vehicle_model_id, spare_part_id, accessory_id, unit_cost,
            vehicle_models ( brand, model_name ),
            spare_parts    ( code, name, unit ),
            accessories    ( code, name, unit )
          ),
          inventory_vehicles ( id, vin, status )
        `)
        .eq('receipt_id', receiptId)
        .order('line_number'),
    ]);
    if (!rcpRes.data) return res.status(404).json({ error: 'Không tìm thấy phiếu nhận hàng' });
    res.json({ receipt: rcpRes.data, items: itemsRes.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/purchase-orders/:id/payments — Ghi nhận thanh toán NCC
const createPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_method, payment_date, bank_reference, note } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Số tiền thanh toán phải > 0' });

    const { data: po } = await getDb(req).from('purchase_orders').select('status, po_number, balance_due').eq('id', id).single();
    if (!po) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });
    if (!['invoiced', 'fully_received'].includes(po.status))
      return res.status(409).json({ error: `Chỉ thanh toán được đơn ở trạng thái "invoiced" hoặc "fully_received"` });
    if (amount > po.balance_due)
      return res.status(409).json({
        error: `Số tiền thanh toán (${amount.toLocaleString('vi-VN')}₫) vượt quá số dư còn nợ (${po.balance_due.toLocaleString('vi-VN')}₫)`,
      });

    const { data, error } = await getDb(req).from('po_payments')
      .insert([{
        po_id:          id,
        amount,
        payment_method: payment_method || 'bank_transfer',
        payment_date:   payment_date   || new Date().toISOString().slice(0, 10),
        bank_reference: bank_reference || null,
        note:           note           || null,
        created_by:     req.user?.sub  || null,
        payment_number: '',   // tự sinh qua trigger
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({
      message: `Đã ghi nhận thanh toán ${amount.toLocaleString('vi-VN')}₫ cho đơn ${po.po_number}`,
      data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/action-required — Dashboard: đơn cần xử lý
const getActionRequired = async (req, res) => {
  try {
    const { data, error } = await getDb(req).from('v_po_action_required')
      .select('*')
      .limit(50);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/purchase-orders/suppliers — Tạo nhà cung cấp mới
const createSupplier = async (req, res) => {
  try {
    const orgId = '00000000-0000-0000-0000-000000000001';

    // Tự sinh supplier_code có prefix chi nhánh
    const supplierCode = await generateCode(req, {
      table: 'acc_suppliers', column: 'supplier_code',
      prefix: 'NCC', padLength: 6, yearInPrefix: false,
    });

    const { data, error } = await getDb(req).from('acc_suppliers')
      .insert([{ org_id: orgId, supplier_code: supplierCode, ...req.body }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: `Đã thêm nhà cung cấp ${supplierCode}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/purchase-orders/suppliers/:id — Cập nhật nhà cung cấp
const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['supplier_name', 'contact_person', 'phone', 'email', 'address',
                     'tax_code', 'bank_account', 'bank_name', 'payment_terms',
                     'credit_limit', 'is_active', 'notes'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const { data, error } = await getDb(req).from('acc_suppliers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    res.json({ message: 'Đã cập nhật nhà cung cấp', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/purchase-orders/suppliers/:id — Bật/tắt trạng thái
const toggleSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const { data, error } = await getDb(req).from('acc_suppliers')
      .update({ is_active })
      .eq('id', id)
      .select('id, supplier_name, is_active')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    res.json({ message: `Đã ${is_active ? 'kích hoạt' : 'ngừng'} nhà cung cấp`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getSuppliers, createSupplier, updateSupplier, toggleSupplier,
  getPurchaseOrders,
  getPurchaseOrderDetail,
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePOStatus,
  createReceipt,
  acceptReceipt,
  getReceiptDetail,
  createPayment,
  getActionRequired,
};
