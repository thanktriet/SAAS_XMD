// Utility functions
export const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

export const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const getInitials = (name: string): string => {
  return name?.split(' ').map(w => w[0]).slice(-2).join('').toUpperCase() || '?';
};

// Map trạng thái → badge class + nhãn
export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  draft:              { label: 'Mở',             cls: 'badge-gray'   },
  confirmed:          { label: 'Đã xác nhận',    cls: 'badge-blue'   },
  deposit_paid:       { label: 'Đã đặt cọc',     cls: 'badge-yellow' },
  full_paid:          { label: 'Đã thanh toán',  cls: 'badge-green'  },
  invoice_requested:  { label: 'Chờ duyệt HĐ',  cls: 'badge-orange' },
  invoice_approved:   { label: 'HĐ đã duyệt',   cls: 'badge-teal'   },
  pdi_pending:        { label: 'Chờ PDI',        cls: 'badge-indigo' },
  pdi_done:           { label: 'PDI hoàn tất',   cls: 'badge-cyan'   },
  delivered:          { label: 'Đã giao xe',     cls: 'badge-purple' },
  cancelled:          { label: 'Đã huỷ',         cls: 'badge-red'    },
};

// Các bước hiển thị trên thanh tiến trình
export const ORDER_STATUS_STEPS = [
  'draft', 'confirmed', 'deposit_paid', 'full_paid',
  'invoice_requested', 'invoice_approved', 'pdi_pending', 'pdi_done', 'delivered',
] as const;

// ─── ActionDef ────────────────────────────────────────────────────────────────
export interface ActionDef {
  toStatus:  string;
  label:     string;
  variant:   'primary' | 'warning' | 'danger';
  formType:  'deposit' | 'payment' | 'pdi' | 'cancel' | 'reopen' | null;
}

// Trả về danh sách hành động mà role được phép thực hiện từ status hiện tại
export function getAllowedActions(currentStatus: string, userRole: string): ActionDef[] {
  const actions: ActionDef[] = [];

  const add = (toStatus: string, label: string, variant: ActionDef['variant'], formType: ActionDef['formType']) =>
    actions.push({ toStatus, label, variant, formType });

  const isAdmin    = userRole === 'admin';
  const isManager  = userRole === 'manager';
  const isSales    = userRole === 'sales';
  const isAcct     = userRole === 'accountant';
  const isTech     = userRole === 'technician';
  const canManage  = isAdmin || isManager;

  switch (currentStatus) {
    case 'draft':
      if (isSales || canManage)       add('confirmed',   '✅ Xác nhận đơn',          'primary', null);
      if (isAcct || canManage)        add('deposit_paid','💰 Ghi nhận đặt cọc',     'warning', 'deposit');
      if (isAcct || canManage)        add('full_paid',   '💳 Thu đủ tiền',            'primary', 'payment');
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'confirmed':
      if (isSales || isAcct || canManage) add('deposit_paid','💰 Ghi nhận đặt cọc', 'warning', 'deposit');
      if (isAcct || canManage)        add('full_paid',   '💳 Thu đủ tiền',            'primary', 'payment');
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'deposit_paid':
      if (isAcct || canManage)        add('full_paid',   '💳 Thu đủ tiền',            'primary', 'payment');
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'full_paid':
      if (isSales || canManage)       add('invoice_requested', '📄 Đề nghị xuất HĐ', 'primary', null);
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'invoice_requested':
      if (canManage)                  add('invoice_approved', '✅ Duyệt & chuyển PDI', 'primary', null);
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'invoice_approved':
      if (canManage)                  add('pdi_pending', '🔄 Chuyển sang chờ PDI',   'primary', null);
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      break;

    case 'pdi_pending':
      if (isTech || canManage)        add('pdi_done',    '🔧 Xác nhận PDI hoàn tất', 'primary', 'pdi');
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'pdi_done':
      if (isSales || canManage)       add('delivered',   '🏍️ Giao xe',               'primary', null);
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      if (canManage)                  add('cancelled',   '❌ Huỷ đơn',               'danger',  'cancel');
      break;

    case 'delivered':
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      break;

    case 'cancelled':
      if (canManage)                  add('draft',       '🔓 Mở lại đơn',           'warning', null);
      break;

    default:
      break;
  }
  return actions;
}

export const SERVICE_STATUS: Record<string, { label: string; cls: string }> = {
  received:      { label: 'Tiếp nhận',     cls: 'badge-blue' },
  diagnosing:    { label: 'Chẩn đoán',     cls: 'badge-yellow' },
  waiting_parts: { label: 'Chờ phụ tùng', cls: 'badge-orange' },
  repairing:     { label: 'Đang sửa',      cls: 'badge-purple' },
  done:          { label: 'Hoàn thành',    cls: 'badge-green' },
  delivered:     { label: 'Đã trả xe',     cls: 'badge-gray' },
  cancelled:     { label: 'Đã huỷ',        cls: 'badge-red' },
};

export const VEHICLE_STATUS: Record<string, { label: string; cls: string }> = {
  in_stock:       { label: 'Còn hàng',    cls: 'badge-green' },
  reserved:       { label: 'Đã đặt cọc',  cls: 'badge-orange' },
  sold:           { label: 'Đã bán',      cls: 'badge-gray' },
  warranty_repair:{ label: 'Đang sửa',    cls: 'badge-yellow' },
  demo:           { label: 'Trưng bày',   cls: 'badge-blue' },
};

export const WARRANTY_STATUS: Record<string, { label: string; cls: string }> = {
  active:  { label: 'Còn hiệu lực', cls: 'badge-green' },
  expired: { label: 'Hết hạn',      cls: 'badge-gray' },
  voided:  { label: 'Đã huỷ',       cls: 'badge-red' },
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash:          'Tiền mặt',
  bank_transfer: 'Chuyển khoản',
  qr:            'QR Code',
  installment:   'Trả góp',
  mixed:         'Kết hợp',
};
