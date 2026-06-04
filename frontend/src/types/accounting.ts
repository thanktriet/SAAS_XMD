// types/accounting.ts
// Chỉ giữ các type và utility được dùng bởi CashflowPage và PaymentPage.
// Module kế toán nội bộ (acc_*) đã được xoá khỏi hệ thống.

// ============================================================
// CASHFLOW — CashflowPage.tsx
// ============================================================

export interface CashBalanceSummary {
  branch_id: string;
  branch_name: string;
  branch_code: string;
  period_name: string;

  cash_111_balance: number;
  bank_112_balance: number;

  receipts_cash: number;
  receipts_bank: number;
  total_receipts: number;

  payments_cash: number;
  payments_bank: number;
  total_payments: number;

  max_cash_allowed: number;
  is_over_threshold: boolean;
  updated_at: string;
}

export type CashBalance = CashBalanceSummary;
export type CashBalanceStatus = 'open' | 'reconciling' | 'reconciled' | 'discrepancy';

// ============================================================
// PAYMENT / RECEIPT — PaymentPage.tsx
// ============================================================

export type PaymentMethod = 'bank_transfer' | 'cash' | 'debt';
export type VoucherStatus = 'draft' | 'posted' | 'reversed' | 'cancelled';

export interface Receipt {
  id: string;
  receipt_code: string;
  order_id: string | null;
  customer_id: string | null;
  branch_id: string;
  amount: number;
  payment_method: PaymentMethod;
  status: VoucherStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// SEPay QR — PaymentPage.tsx
// ============================================================

export interface SePayWebhookPayload {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount: string | null;
  code: string | null;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  accumulated: number;
  referenceCode: string;
  description: string;
}

export interface SePayQRParams {
  bank: string;
  account_number: string;
  amount: number;
  description: string;
  template?: 'compact' | 'compact2' | 'qr_only' | 'print';
}

export function buildSePayQRUrl(params: SePayQRParams): string {
  const p = new URLSearchParams({
    bank:     params.bank,
    acc:      params.account_number,
    amount:   String(params.amount),
    des:      params.description,
    template: params.template ?? 'compact2',
  });
  return `https://qr.sepay.vn/img?${p.toString()}`;
}

// ============================================================
// Helpers hiển thị — dùng bởi CashflowPage + PaymentPage
// ============================================================

export function formatVND(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency: 'VND',
  }).format(amount);
}

export function formatVNDateTime(utcString: string): string {
  if (!utcString) return '—';
  return new Date(utcString).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatVNDate(dateStr: string): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
