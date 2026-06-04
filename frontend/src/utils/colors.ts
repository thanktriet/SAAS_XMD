// Bảng màu xe máy điện dùng chung — sync giữa VehiclesPage / InventoryPage / SalesNewPage (POS)
// Khi admin set color_hex riêng trong vehicle_model_colors, ưu tiên DB; fallback bảng này.

export const MAU_HEX: Record<string, string> = {
  // Đen
  'Đen': '#1f2937', 'Đen bóng': '#0f172a', 'Đen nhám': '#374151',
  // Trắng
  'Trắng': '#f5f5f5', 'Trắng ngọc': '#fafafa', 'Trắng ngọc trai': '#f4f4f5',
  'Trắng Cam': 'linear-gradient(90deg, #f5f5f5 50%, #ea580c 50%)',
  // Đỏ
  'Đỏ': '#dc2626', 'Đỏ tươi': '#ef4444', 'Đỏ đen': '#7f1d1d',
  // Xanh
  'Xanh dương': '#2563eb', 'Xanh lá': '#16a34a',
  'Xanh Oliu': '#556b2f', 'Xanh rêu': '#3f6212',
  'Xanh Ngọc': '#14b8a6', 'Xanh Ong': '#0891b2',
  // Vàng
  'Vàng': '#d97706', 'Vàng cát': '#d4a373',
  // Xám / Bạc
  'Xám': '#6b7280', 'Xám xi măng': '#94a3b8', 'Bạc': '#9ca3af',
  // Khác
  'Cam': '#ea580c', 'Tím': '#7c3aed', 'Hồng': '#db2777', 'Nâu': '#92400e',
};

// Bộ màu gợi ý nhanh khi tạo Mẫu xe (giữ thứ tự để chip hiển thị đẹp)
export const MAU_GOI_Y = [
  'Đen', 'Đen bóng', 'Đen nhám',
  'Trắng', 'Trắng ngọc', 'Trắng ngọc trai', 'Trắng Cam',
  'Đỏ', 'Đỏ tươi', 'Đỏ đen',
  'Xanh dương', 'Xanh lá', 'Xanh Oliu', 'Xanh rêu', 'Xanh Ngọc', 'Xanh Ong',
  'Vàng', 'Vàng cát',
  'Xám', 'Xám xi măng', 'Bạc',
  'Cam', 'Tím', 'Hồng', 'Nâu',
];

// Bỏ dấu tiếng Việt để lookup không phân biệt dấu/hoa thường
function bo_dau(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const HEX_LOWER: Record<string, string> = {};
for (const [k, v] of Object.entries(MAU_HEX)) HEX_LOWER[bo_dau(k)] = v;

/**
 * Lấy mã màu hiển thị cho 1 màu xe.
 * @param mau     Tên màu (VD: "Đen", "Xanh Oliu")
 * @param dbHex   Hex từ DB (vehicle_model_colors.color_hex) — ưu tiên cao nhất nếu có
 * @returns Chuỗi CSS color (hex hoặc linear-gradient), fallback xám nhạt
 */
export function mauToHex(mau?: string | null, dbHex?: string | null): string {
  if (dbHex && dbHex.trim()) return dbHex;
  if (!mau) return '#9ca3af';
  return HEX_LOWER[bo_dau(mau)] || '#9ca3af';
}
