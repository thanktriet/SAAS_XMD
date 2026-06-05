const XLSX = require('xlsx');
const { supabaseAdmin } = require('./config/supabase');

// Helper: dùng branch-scoped client nếu có (từ auth middleware)
function getDb(req) { return req.db || supabaseAdmin; }

// Tên cột Excel hợp lệ (không phân biệt hoa thường, có trim)
// VIN là bắt buộc. Để xác định mẫu xe cần có SKU hoặc ma_model (ưu tiên SKU)
const COT_BAT_BUOC = ['vin']; // ma_model HOẶC sku — kiểm tra logic riêng
const COT_HOA_DON  = [
  'vin', 'sku', 'ma_model', 'so_may', 'so_pin', 'mau_sac',
  'nam_sx', 'ngay_nhap', 'gia_nhap', 'trang_thai', 'ghi_chu',
];

// Ánh xạ tên cột viết thường / có dấu → tên cột chuẩn
const ALIAS_COT = {
  // VIN / số khung
  'vin':            'vin',
  'số khung':       'vin',
  'so khung':       'vin',
  'frame number':   'vin',

  // Mã sản phẩm (SKU / product_code) — ưu tiên để match mẫu xe + màu
  'sku':              'sku',
  'mã sản phẩm':     'sku',
  'ma san pham':      'sku',
  'product_code':     'sku',
  'mã sp':            'sku',
  'ma sp':            'sku',

  // Mã model (fallback nếu không có SKU)
  'ma_model':        'ma_model',
  'mã model':        'ma_model',
  'ma model':        'ma_model',
  'model':           'ma_model',
  'model_id':        'ma_model',
  'vehicle_model_id': 'ma_model',

  // Số máy
  'so_may':          'so_may',
  'số máy':          'so_may',
  'engine number':   'so_may',
  'engine_number':   'so_may',

  // Số pin
  'so_pin':          'so_pin',
  'số pin':          'so_pin',
  'battery_serial':  'so_pin',
  'serial pin':      'so_pin',

  // Màu sắc
  'mau_sac':         'mau_sac',
  'màu sắc':         'mau_sac',
  'mau sac':         'mau_sac',
  'color':           'mau_sac',
  'màu':             'mau_sac',

  // Năm sản xuất
  'nam_sx':          'nam_sx',
  'năm sx':          'nam_sx',
  'nam sx':          'nam_sx',
  'year':            'nam_sx',
  'năm sản xuất':    'nam_sx',

  // Ngày nhập
  'ngay_nhap':       'ngay_nhap',
  'ngày nhập':       'ngay_nhap',
  'ngay nhap':       'ngay_nhap',
  'import_date':     'ngay_nhap',
  'ngày nhập kho':   'ngay_nhap',

  // Giá nhập
  'gia_nhap':        'gia_nhap',
  'giá nhập':        'gia_nhap',
  'gia nhap':        'gia_nhap',
  'import_price':    'gia_nhap',
  'giá vốn':         'gia_nhap',

  // Trạng thái
  'trang_thai':      'trang_thai',
  'trạng thái':      'trang_thai',
  'trang thai':      'trang_thai',
  'status':          'trang_thai',

  // Ghi chú
  'ghi_chu':         'ghi_chu',
  'ghi chú':         'ghi_chu',
  'ghi chu':         'ghi_chu',
  'notes':           'ghi_chu',
};

// Giá trị trạng thái hợp lệ
const TRANG_THAI_HOP_LE = {
  'in_stock': 'in_stock', 'con hang': 'in_stock', 'còn hàng': 'in_stock',
  'sold': 'sold', 'da ban': 'sold', 'đã bán': 'sold',
  'reserved': 'reserved', 'da dat': 'reserved', 'đã đặt': 'reserved', 'đặt cọc': 'reserved',
  'warranty_repair': 'warranty_repair', 'sua chua': 'warranty_repair', 'sửa chữa': 'warranty_repair',
  'demo': 'demo', 'trung bay': 'demo', 'trưng bày': 'demo',
};

/**
 * Chuẩn hoá header: trim + lowercase + xoá dấu tiếng Việt cơ bản
 */
function chuanHoaTenCot(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * Chuyển serial date của Excel → YYYY-MM-DD
 */
function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  // Nhận dạng DD/MM/YYYY
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  // Nhận dạng YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ─── POST /api/inventory/import/preview ──────────────────────────────────────
// Đọc file Excel, trả về dữ liệu đã parse để frontend hiển thị preview
const previewImport = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn file Excel (.xlsx / .xls)' });

    // Đọc workbook từ buffer
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rawRows.length < 2)
      return res.status(400).json({ error: 'File không có dữ liệu (cần ít nhất 1 dòng header + 1 dòng dữ liệu)' });

    // Ánh xạ header → cột chuẩn
    const headerRow = rawRows[0];
    const colMap = {}; // index → tên cột chuẩn
    for (let i = 0; i < headerRow.length; i++) {
      const alias = chuanHoaTenCot(headerRow[i]);
      if (ALIAS_COT[alias]) colMap[i] = ALIAS_COT[alias];
    }

    // Kiểm tra cột bắt buộc
    const colsCo = Object.values(colMap);
    const cotThieu = COT_BAT_BUOC.filter(c => !colsCo.includes(c));
    if (cotThieu.length > 0)
      return res.status(400).json({
        error: `File thiếu cột bắt buộc: ${cotThieu.join(', ')}`,
        hint:  `Tên cột có thể dùng: vin / số khung`,
      });

    // Phải có ít nhất SKU hoặc ma_model
    if (!colsCo.includes('sku') && !colsCo.includes('ma_model'))
      return res.status(400).json({
        error: 'File cần có cột "Mã sản phẩm" (SKU) hoặc "Mã model"',
        hint:  'Tên cột có thể dùng: sku / mã sản phẩm / product_code, hoặc ma_model / model',
      });

    // Lấy tất cả vehicle_models để map ma_model → id
    const { data: models } = await getDb(req).from('vehicle_models')
      .select('id, brand, model_name');

    // Tạo map: "brand model_name" → id  và  "id" → id
    const modelMap = {};
    for (const m of models) {
      modelMap[m.id.toLowerCase()] = m.id;
      modelMap[`${m.brand} ${m.model_name}`.toLowerCase()] = m.id;
      modelMap[m.model_name.toLowerCase()] = m.id;
    }

    // Lấy tất cả vehicle_model_colors (có product_code) để map SKU → model + color
    const { data: colorList } = await getDb(req).from('vehicle_model_colors')
      .select('id, vehicle_model_id, color_name, product_code')
      .not('product_code', 'is', null);

    // Tạo map: product_code (lowercase) → { vehicle_model_id, color_name }
    const skuMap = {};
    for (const c of (colorList || [])) {
      if (c.product_code) {
        skuMap[c.product_code.trim().toLowerCase()] = {
          vehicle_model_id: c.vehicle_model_id,
          color_name: c.color_name,
        };
      }
    }

    // Lấy tất cả VIN đã có trong kho để báo trùng
    const { data: vinList } = await getDb(req).from('inventory_vehicles')
      .select('vin');
    const vinSet = new Set((vinList || []).map(v => v.vin.toUpperCase()));

    // Parse từng dòng
    const rows = [];
    const dataRows = rawRows.slice(1);

    for (let ri = 0; ri < dataRows.length; ri++) {
      const row = dataRows[ri];
      // Bỏ qua dòng trống hoàn toàn
      if (row.every(c => String(c).trim() === '')) continue;

      const obj = {};
      for (const [idx, colName] of Object.entries(colMap)) {
        obj[colName] = row[idx] ?? '';
      }

      const errors = [];
      const warnings = [];

      // VIN
      const vin = String(obj.vin ?? '').trim().toUpperCase();
      if (!vin) errors.push('Thiếu số khung (VIN)');
      else if (vinSet.has(vin)) errors.push(`VIN ${vin} đã tồn tại trong kho`);

      // Match mẫu xe: ưu tiên SKU → fallback ma_model
      const skuRaw = String(obj.sku ?? '').trim().toLowerCase();
      const maModel = String(obj.ma_model ?? '').trim().toLowerCase();
      let modelId = null;
      let colorFromSku = null;

      if (skuRaw && skuMap[skuRaw]) {
        // SKU match thành công → lấy vehicle_model_id + color tự động
        modelId = skuMap[skuRaw].vehicle_model_id;
        colorFromSku = skuMap[skuRaw].color_name;
      } else if (skuRaw && !skuMap[skuRaw]) {
        // SKU có nhưng không tìm thấy trong hệ thống
        errors.push(`Mã sản phẩm (SKU) "${obj.sku}" không tồn tại trong hệ thống`);
      } else if (maModel) {
        // Không có SKU → dùng ma_model
        modelId = modelMap[maModel] || null;
        if (!modelId) errors.push(`Không tìm thấy model "${obj.ma_model}"`);
      } else {
        errors.push('Thiếu mã sản phẩm (SKU) hoặc mã model');
      }

      // Trạng thái
      const trangThaiRaw = String(obj.trang_thai ?? '').trim().toLowerCase();
      const trangThai    = TRANG_THAI_HOP_LE[trangThaiRaw] || 'in_stock';
      if (trangThaiRaw && !TRANG_THAI_HOP_LE[trangThaiRaw])
        warnings.push(`Trạng thái "${obj.trang_thai}" không nhận dạng được → dùng in_stock`);

      // Giá nhập
      const giaNhapRaw = String(obj.gia_nhap ?? '').replace(/[,\s]/g, '');
      const giaNhap    = giaNhapRaw ? Number(giaNhapRaw) : null;
      if (giaNhapRaw && isNaN(giaNhap)) errors.push('Giá nhập không phải số');

      // Năm SX
      const namSX = obj.nam_sx ? Number(String(obj.nam_sx).trim()) : null;
      if (namSX && (namSX < 2000 || namSX > 2099)) warnings.push('Năm sản xuất có vẻ không hợp lệ');

      // Ngày nhập
      const ngayNhap = excelDateToISO(obj.ngay_nhap) || new Date().toISOString().slice(0, 10);

      // Màu sắc: ưu tiên màu nhập tay, fallback màu từ SKU
      const colorManual = String(obj.mau_sac ?? '').trim() || null;
      const colorFinal  = colorManual || colorFromSku || null;

      rows.push({
        row_number:       ri + 2,         // +2 vì bỏ header và 0-index
        vin,
        vehicle_model_id: modelId,
        sku_raw:          obj.sku || null,
        ma_model_raw:     obj.ma_model || null,
        engine_number:    String(obj.so_may  ?? '').trim() || null,
        battery_serial:   String(obj.so_pin  ?? '').trim() || null,
        color:            colorFinal,
        year_manufacture: namSX,
        import_date:      ngayNhap,
        import_price:     giaNhap,
        status:           trangThai,
        notes:            String(obj.ghi_chu ?? '').trim() || null,
        errors,
        warnings,
        valid:            errors.length === 0,
      });
    }

    const tongHop = {
      total:    rows.length,
      valid:    rows.filter(r => r.valid).length,
      invalid:  rows.filter(r => !r.valid).length,
      warnings: rows.filter(r => r.warnings.length > 0).length,
    };

    res.json({ summary: tongHop, rows });
  } catch (err) {
    res.status(500).json({ error: `Lỗi đọc file Excel: ${err.message}` });
  }
};

// ─── POST /api/inventory/import/confirm ──────────────────────────────────────
// Nhận dữ liệu đã được preview + xác nhận, thực hiện bulk insert
const confirmImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: 'Không có dữ liệu để nhập' });

    // Chỉ insert các dòng hợp lệ
    const hopLe = rows.filter(r => r.valid !== false);
    if (hopLe.length === 0)
      return res.status(400).json({ error: 'Không có dòng hợp lệ nào để nhập' });

    // Kiểm tra lại VIN trùng lần cuối (tránh race condition)
    const vinsMoi = hopLe.map(r => r.vin.toUpperCase());
    const { data: trung } = await getDb(req).from('inventory_vehicles')
      .select('vin')
      .in('vin', vinsMoi);

    if (trung && trung.length > 0) {
      const vinTrung = trung.map(v => v.vin).join(', ');
      return res.status(409).json({
        error: `Các VIN sau đã tồn tại trong kho: ${vinTrung}`,
        duplicate_vins: trung.map(v => v.vin),
      });
    }

    // Chuẩn hoá payload để insert
    const payload = hopLe.map(r => ({
      vehicle_model_id: r.vehicle_model_id,
      vin:              r.vin,
      engine_number:    r.engine_number  || null,
      battery_serial:   r.battery_serial || null,
      color:            r.color          || null,
      year_manufacture: r.year_manufacture || null,
      import_date:      r.import_date    || null,
      import_price:     r.import_price   || null,
      status:           r.status         || 'in_stock',
      notes:            r.notes          || null,
    }));

    const { data, error } = await getDb(req).from('inventory_vehicles')
      .insert(payload)
      .select('id, vin, status');

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({
      message: `Đã nhập ${data.length} xe vào kho thành công`,
      inserted: data.length,
      data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/inventory/import/template ──────────────────────────────────────
// Tải file Excel mẫu để người dùng điền vào
const downloadTemplate = async (req, res) => {
  try {
    // Lấy danh sách model để điền vào sheet tham chiếu
    const { data: models } = await getDb(req).from('vehicle_models')
      .select('id, brand, model_name')
      .eq('is_active', true)
      .order('brand');

    // Lấy danh sách SKU (product_code) để điền vào sheet tham chiếu
    const { data: colorsList } = await getDb(req).from('vehicle_model_colors')
      .select('product_code, color_name, vehicle_model_id, vehicle_models(brand, model_name)')
      .not('product_code', 'is', null)
      .eq('is_active', true);

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Dữ liệu nhập ──
    const headerRow = [
      'vin', 'sku', 'so_may', 'so_pin', 'mau_sac',
      'nam_sx', 'ngay_nhap', 'gia_nhap', 'trang_thai', 'ghi_chu',
    ];
    const huongDanRow = [
      'Bắt buộc – VD: VF1ABC123456789',
      'Mã sản phẩm – tự match mẫu xe + màu (xem Sheet "Danh sách SKU")',
      'Số motor / số máy',
      'Serial pin lithium',
      'Màu sắc (nếu không có SKU sẽ match)',
      'VD: 2025',
      'DD/MM/YYYY hoặc YYYY-MM-DD',
      'Giá nhập (số, VD: 25000000)',
      'in_stock / sold / reserved / warranty_repair / demo',
      'Ghi chú tự do',
    ];
    // 3 dòng mẫu
    const skuVD = (colorsList && colorsList[0]?.product_code) || 'XMD-VF5-TRANG';
    const viDu = [
      ['VF1ABC1234567890', skuVD, 'EV2025001', 'BAT001', '', 2025, '01/01/2025', 25000000, 'in_stock', ''],
      ['VF1XYZ0987654321', colorsList?.[1]?.product_code || 'XMD-VF3-DEN', 'EV2025002', 'BAT002', '', 2025, '15/01/2025', 23000000, 'in_stock', 'Nhập từ HN'],
      ['VF1DEF1122334455', '', '', '', 'Đỏ', 2024, '', 0, 'demo', 'Xe trưng bày (dùng ma_model thay SKU)'],
    ];

    const wsData = [headerRow, huongDanRow, ...viDu];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Độ rộng cột
    ws['!cols'] = [
      { wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 12 },
      { wch: 8  }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 30 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Nhập kho xe');

    // ── Sheet 2: Danh sách SKU (mã sản phẩm) ──
    const wsSku = XLSX.utils.aoa_to_sheet([
      ['Mã sản phẩm (SKU)', 'Hãng', 'Tên model', 'Màu sắc', '→ Dùng cột "sku" ở Sheet 1'],
      ...(colorsList || []).map(c => [
        c.product_code,
        c.vehicle_models?.brand || '',
        c.vehicle_models?.model_name || '',
        c.color_name,
        `${c.vehicle_models?.brand || ''} ${c.vehicle_models?.model_name || ''} - ${c.color_name}`,
      ]),
    ]);
    wsSku['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsSku, 'Danh sách SKU');

    // ── Sheet 3: Danh sách model tham chiếu ──
    const wsModel = XLSX.utils.aoa_to_sheet([
      ['ID', 'Hãng', 'Tên model', '→ Dùng cột "ma_model" nếu không có SKU'],
      ...(models || []).map(m => [m.id, m.brand, m.model_name, `${m.brand} ${m.model_name}`]),
    ]);
    wsModel['!cols'] = [{ wch: 38 }, { wch: 12 }, { wch: 20 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsModel, 'Danh sách model');

    // ── Sheet 4: Hướng dẫn ──
    const wsGuide = XLSX.utils.aoa_to_sheet([
      ['HƯỚNG DẪN NHẬP FILE EXCEL KHO XE'],
      [''],
      ['Cột bắt buộc:', 'vin (số khung)'],
      ['Xác định mẫu xe:', 'Cần có "sku" (mã sản phẩm) HOẶC "ma_model" (tên model)'],
      [''],
      ['*** ƯU TIÊN DÙNG SKU ***'],
      ['', 'Chỉ cần điền mã sản phẩm (SKU) + VIN + Số máy'],
      ['', '→ Hệ thống tự động match đúng mẫu xe + màu sắc'],
      ['', '→ Không cần điền cột màu sắc'],
      [''],
      ['Nếu không có SKU:', 'Dùng cột ma_model + mau_sac để xác định xe'],
      [''],
      ['Cột trang_thai nhận các giá trị:'],
      ['', 'in_stock',        '→ Còn hàng (mặc định)'],
      ['', 'sold',            '→ Đã bán'],
      ['', 'reserved',        '→ Đã đặt cọc'],
      ['', 'warranty_repair', '→ Đang sửa chữa'],
      ['', 'demo',            '→ Xe trưng bày'],
      [''],
      ['Định dạng ngày nhập:', 'DD/MM/YYYY  hoặc  YYYY-MM-DD'],
      ['Giá nhập:', 'Số nguyên, không có dấu phẩy hay chữ đơn vị'],
      [''],
      ['Tên cột có thể dùng tiếng Việt có dấu:', 'VD: "số khung", "mã sản phẩm", "số máy"...'],
    ]);
    wsGuide['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Hướng dẫn');

    // Ghi buffer và trả về
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="mau_nhap_kho_xe.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { previewImport, confirmImport, downloadTemplate };
