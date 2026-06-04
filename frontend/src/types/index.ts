// Định nghĩa TypeScript types cho toàn bộ hệ thống

export interface PaymentSettings {
  bank_code:         string;   // Mã ngân hàng SEPay: TCB, VCB, MB...
  bank_name:         string;   // Tên hiển thị: Techcombank
  bank_account:      string;   // STK thụ hưởng
  bank_account_name: string;   // Tên chủ tài khoản
  sepay_api_key:     string;   // API Key xác thực webhook
  max_cash_allowed:  string;   // Ngưỡng tồn quỹ tiền mặt (chuỗi số)
  loyalty_amount_per_point: string; // VD "10000" = 10k chi tiêu được 1 điểm
  loyalty_enabled:   string;   // "true" | "false"
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  bank_code:         'TCB',
  bank_name:         'Techcombank',
  bank_account:      '',
  bank_account_name: '',
  sepay_api_key:     '',
  max_cash_allowed:  '50000000',
  loyalty_amount_per_point: '10000',
  loyalty_enabled:   'true',
};

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: 'admin' | 'manager' | 'sales' | 'technician' | 'accountant' | 'warehouse';
  is_active: boolean;
  avatar_url?: string;
  branch_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string;
  email?: string;

  // Cá nhân
  gender?: 'male' | 'female' | 'other';
  source?: 'referral' | 'facebook' | 'zalo' | 'showroom' | 'website' | 'call_center' | 'other';
  id_card?: string;
  id_card_date?: string;    // Ngày cấp CCCD — YYYY-MM-DD
  id_card_place?: string;   // Nơi cấp CCCD
  date_of_birth?: string;   // YYYY-MM-DD

  // Địa chỉ giao hàng
  address?: string;
  district?: string;
  province?: string;

  // Doanh nghiệp
  customer_type: 'individual' | 'business';
  company_name?: string;
  tax_code?: string;
  representative_name?: string;   // Người đại diện pháp lý
  representative_title?: string;  // Chức vụ người đại diện

  // Địa chỉ xuất hóa đơn (doanh nghiệp)
  invoice_address?: string;
  invoice_district?: string;
  invoice_province?: string;

  notes?: string;
  loyalty_points: number;
  created_at: string;
  updated_at?: string;
}

export interface VehicleVariant {
  ten: string;       // VD: "Tiêu Chuẩn", "Cao Cấp", "Đặc Biệt"
  gia_chen_them: number; // chênh lệch so với giá bán cơ bản (0 = giá gốc)
}

export interface VehicleModel {
  id: string;
  brand: string;
  model_name: string;
  category: 'xe_may' | 'xe_dap' | 'xe_ba_banh' | 'xe_tay_ga';
  year?: number;
  price_cost: number;
  price_sell: number;
  battery_capacity?: string;         // tương thích field cũ
  battery_capacity_kwh?: number;
  battery_type?: string;
  max_range?: number;
  range_km?: number;
  max_speed_kmh?: number;
  warranty_months: number;
  image_url?: string;
  description?: string;
  is_active?: boolean;
  available_colors?: string[];       // mảng màu: ['Trắng', 'Đen', 'Đỏ']
  variants?: VehicleVariant[];       // phiên bản: [{ten, gia_chen_them}]
  created_at?: string;
  updated_at?: string;
}

export interface InventoryVehicle {
  id: string;
  vehicle_model_id: string;
  vin: string;
  engine_number?: string;
  battery_serial?: string;
  color: string;
  year_manufacture?: number;
  status: 'in_stock' | 'sold' | 'warranty_repair' | 'demo' | 'reserved';
  import_date?: string;
  import_price?: number;
  notes?: string;
  vehicle_models?: VehicleModel;
}

export interface SalesOrder {
  id: string;
  order_number: string;
  customer_id: string;
  salesperson_id: string;
  status: 'draft' | 'confirmed' | 'deposit_paid' | 'full_paid'
        | 'invoice_requested' | 'invoice_approved'
        | 'pdi_pending' | 'pdi_done' | 'delivered' | 'cancelled';
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  payment_method: 'cash' | 'bank_transfer' | 'installment' | 'mixed';
  deposit_amount: number;
  delivery_date?: string;
  order_date: string;
  dms_order_number?: string | null;
  installment_contract_number?: string | null;
  customers?: { full_name: string; phone: string };
  users?: { full_name: string };
  sales_order_items?: Array<{
    quantity: number;
    vehicle_models?: { brand: string; model_name: string };
    inventory_vehicles?: { color: string | null; vin?: string | null } | null;
  }>;
}

export interface WarrantyRecord {
  id: string;
  warranty_number: string;
  customer_id: string;
  inventory_vehicle_id: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'expired' | 'voided';
  customers?: { full_name: string; phone: string };
  inventory_vehicles?: {
    vin: string; color: string;
    vehicle_models?: { brand: string; model_name: string };
  };
}

export interface ServiceRequest {
  id: string;
  ticket_number: string;
  customer_id: string;
  inventory_vehicle_id?: string;
  service_type: 'warranty' | 'paid_repair' | 'periodic_maintenance' | 'upgrade';
  status: 'received' | 'diagnosing' | 'waiting_parts' | 'repairing' | 'done' | 'delivered' | 'cancelled';
  description?: string;
  technician_id?: string;
  labor_cost: number;
  parts_cost: number;
  received_date: string;
  customers?: { full_name: string; phone: string };
  users?: { full_name: string };
}

export interface FinanceTransaction {
  id: string;
  transaction_number: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  payment_method: string;
  transaction_date: string;
  description?: string;
  notes?: string;
  reference_id?: string;
  reference_type?: string;
  sepay_transaction_id?: number | null;   // có giá trị → giao dịch tự động từ SEPay
  users?: { full_name: string };
}

export interface DashboardTopModel {
  vehicle_model_id: string;
  brand:            string;
  model_name:       string;
  quantity:         number;
  revenue:          number;
}

export interface DashboardRecentOrder {
  id:             string;
  order_number:   string;
  total_amount:   number;
  deposit_amount: number;
  status:         string;
  order_date:     string;
  customers?:     { full_name: string; phone: string } | null;
}

export interface DashboardStats {
  vehicles_in_stock:           number;
  orders_this_month:           number;
  orders_pending:              number;
  open_service_tickets:        number;
  service_count_this_month:    number;
  revenue_this_month:          number;   // doanh thu xe
  service_revenue_this_month:  number;   // doanh thu DV + phụ kiện
  grand_revenue_this_month:    number;   // tổng
  orders_change_pct:           number;
  revenue_change_pct:          number;
  service_revenue_change_pct:  number;
  grand_revenue_change_pct:    number;
  top_models:                  DashboardTopModel[];
  recent_orders:               DashboardRecentOrder[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Phụ kiện bán kèm theo xe ───────────────────────────────────────────────
export type AccessoryCategory = 'battery' | 'safety' | 'luggage' | 'comfort' | 'weather' | 'decor' | 'other';

export interface Accessory {
  id:                 string;
  code:               string;
  name:               string;
  description?:       string;
  category:           AccessoryCategory;
  image_url?:         string;
  price_sell:         number;   // giá bán (API trả về price_sell)
  price_cost?:        number;   // giá nhập (tùy chọn)
  /** @deprecated dùng price_sell */
  price?:             number;
  unit:               string;
  qty_in_stock:       number;
  qty_minimum:        number;
  brand?:             string;
  supplier?:          string;
  compatible_models?: string[] | null;
  is_active:          boolean;
  created_at:         string;
  updated_at:         string;
}

// Item trong giỏ phụ kiện (state nội bộ POS)
export interface CartAccessory {
  accessory:        Accessory;
  quantity:         number;
  unit_price:       number;   // snapshot giá tại thời điểm thêm
  line_total:       number;   // quantity * unit_price
  serial_numbers?:  string[];                          // chỉ dùng khi accessory.category = 'battery'
  assignment_type?: 'purchase' | 'rent';               // chỉ dùng khi accessory.category = 'battery'
}

// Bản ghi đã lưu trong đơn hàng (khi fetch chi tiết)
export interface SalesOrderAccessory {
  id:           string;
  order_id:     string;
  accessory_id: string;
  quantity:     number;
  unit_price:   number;
  line_total:   number;
  created_at:   string;
  accessories?: Pick<Accessory, 'id' | 'code' | 'name' | 'category' | 'image_url' | 'unit' | 'price_sell'>;
}

// ─── Đơn nhập hàng ────────────────────────────────────────────────────────────
export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_name: string;
  supplier_phone?: string;
  order_date: string;
  expected_date?: string;
  received_date?: string;
  status: 'draft' | 'confirmed' | 'received' | 'cancelled';
  subtotal: number;
  notes?: string;
  created_at: string;
  users?: { full_name: string };
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  vehicle_model_id?: string;
  color?: string;
  year_manufacture?: number;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number;
  line_total: number;
  notes?: string;
  vehicle_models?: Pick<VehicleModel, 'id' | 'brand' | 'model_name' | 'category'>;
}

// ─── Phụ tùng mở rộng ─────────────────────────────────────────────────────────
export interface SparePart {
  id: string;
  code: string;
  name: string;
  category?: string;
  unit: string;
  qty_in_stock: number;
  qty_minimum: number;
  price_cost: number;
  price_sell: number;
  supplier?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface StockMovement {
  id: string;
  spare_part_id: string;
  movement_type: 'import' | 'export' | 'adjustment';
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_id?: string;
  reference_type?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  users?: { full_name: string };
}


// ─── Khuyến Mãi ───────────────────────────────────────────────────────────────
export type PromoType = 'percent' | 'fixed' | 'gift' | 'combo';
export type PromoAppliesTo = 'vehicle' | 'accessory' | 'both';

export interface Promotion {
  id:                 string;
  promo_code:         string;
  name:               string;
  description?:       string;
  promo_type:         PromoType;
  discount_percent:   number;
  discount_amount:    number;
  min_order_amount:   number;
  max_discount_cap?:  number | null;
  valid_from:         string;
  valid_until:        string;
  is_active:          boolean;
  usage_limit?:       number | null;
  usage_count:        number;
  applicable_models?: string[] | null;
  applicable_brands?: string[] | null;
  applies_to:              PromoAppliesTo;
  applicable_accessories?: string[] | null;  // null = áp dụng cho mọi phụ kiện trong giỏ
  gift_item_id?:      string | null;
  gift_quantity:      number;
  display_order?:     number | null;
  note?:              string;
  created_by?:        string;
  created_at:         string;
  updated_at:         string;
  gift_items?:        { id: string; code: string; name: string; category: string; qty_in_stock: number } | null;
  users?:             { full_name: string } | null;
  usage_history?:     PromoUsage[];
}

export interface PromoUsage {
  id:              string;
  order_id:        string;
  promotion_id?:   string | null;
  promo_name:      string;
  promo_type:      string;
  discount_amount: number;
  gift_item_id?:   string | null;
  gift_item_name?: string | null;
  gift_quantity:   number;
  created_at:      string;
  sales_orders?:   {
    order_number: string;
    order_date:   string;
    total_amount: number;
    status:       string;
    customers?:   { full_name: string; customer_code: string; phone: string } | null;
  } | null;
}

export interface PromoStats {
  total:          number;
  active:         number;
  expiring_soon:  number;
  total_discount: number;
}

export interface FeeSetting {
  id:         string;
  key:        string;
  label:      string;
  amount:     number;
  is_active:  boolean;
  note?:      string | null;
  sort_order: number;
  model_id?:  string | null;
  vehicle_models?: { brand: string; model_name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface InstallmentProvider {
  id:                       string;
  name:                     string;
  interest_rate_per_month:  number;
  available_months:         number[];
  default_months:           number;
  min_down_payment_percent: number;
  is_active:                boolean;
  note?:                    string | null;
  sort_order:               number;
  created_at:               string;
  updated_at:               string;
}

export interface RegistrationService {
  id:          string;
  name:        string;
  description?: string | null;
  price:       number;
  is_active:   boolean;
  sort_order:  number;
  created_at:  string;
  updated_at:  string;
}
