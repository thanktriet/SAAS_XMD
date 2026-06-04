// Trang Tồn quỹ — đơn giản hóa: tiền mặt / ngân hàng / chi / quỹ TM hiện tại
// + nút Nộp tiền về tài khoản công ty
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatCurrency, formatDate, formatDateTime } from '../utils/helpers';
import { useUploadImage } from '../hooks/useUploadImage';
import type { PaymentSettings } from '../types';
import toast from 'react-hot-toast';

interface FinanceTxn {
  type:             'income' | 'expense';
  amount:           number;
  payment_method:   string;
  category:         string | null;
  description:      string | null;
  transaction_date: string;
  created_at:       string;
}

interface CashflowToday {
  today: {
    cash_in:   number;
    bank_in:   number;
    total_in:  number;
    cash_out:  number;
    bank_out:  number;
    total_out: number;
  };
  cash_balance:       number;
  max_cash_allowed:   number;
  is_over_threshold:  boolean;
  transactions_today: FinanceTxn[];
  updated_at:         string;
}

interface CashDeposit {
  id:                string;
  deposit_code:      string;
  amount:            number;
  bank_name:         string;
  bank_account:      string;
  bank_account_name: string | null;
  deposit_date:      string;
  receipt_number:    string | null;
  receipt_image_url: string | null;
  notes:             string | null;
  created_at:        string;
  users?:            { full_name: string } | null;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash:          '💵 Tiền mặt',
  bank_transfer: '🏦 Chuyển khoản',
  qr_code:       '📱 QR SEPay',
  qr:            '📱 QR',
  installment:   '🏦 Trả góp',
};

export default function CashflowPage() {
  const qc = useQueryClient();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Form nộp tiền
  const [formAmount, setFormAmount] = useState('');
  const [formBankName, setFormBankName] = useState('');
  const [formBankAcc, setFormBankAcc] = useState('');
  const [formBankAccName, setFormBankAccName] = useState('');
  const [formReceiptNo, setFormReceiptNo] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formReceiptImage, setFormReceiptImage] = useState<string>('');
  const { uploading, upload } = useUploadImage({ bucket: 'vehicle-images', folder: 'deposits' });

  // ── Queries
  const { data, isLoading } = useQuery<CashflowToday>({
    queryKey: ['cashflow-today'],
    queryFn:  () => api.get('/accounting/cashflow/today').then(r => r.data),
    refetchInterval: 30_000,
  });

  // Lấy cấu hình bank để auto-fill khi tạo phiếu nộp
  const { data: paySettings } = useQuery<PaymentSettings>({
    queryKey: ['payment-settings'],
    queryFn:  () => api.get('/settings/payment').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  // Lịch sử nộp tiền
  const { data: depositsData } = useQuery<{ data: CashDeposit[] }>({
    queryKey: ['cash-deposits'],
    queryFn:  () => api.get('/cash-deposits', { params: { limit: 30 } }).then(r => r.data),
  });
  const deposits = depositsData?.data ?? [];

  // ── Mutation
  const depositMut = useMutation({
    mutationFn: (body: any) => api.post('/cash-deposits', body).then(r => r.data),
    onSuccess: (newDep: CashDeposit) => {
      toast.success(`✅ Đã nộp ${formatCurrency(newDep.amount)} vào ${newDep.bank_name}`);
      qc.invalidateQueries({ queryKey: ['cashflow-today'] });
      qc.invalidateQueries({ queryKey: ['cash-deposits'] });
      setShowDepositModal(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi nộp tiền'),
  });

  function resetForm() {
    setFormAmount(''); setFormBankName(''); setFormBankAcc('');
    setFormBankAccName(''); setFormReceiptNo(''); setFormNotes('');
    setFormReceiptImage('');
  }

  function openDepositModal() {
    // Auto-fill từ cấu hình
    if (paySettings?.bank_name)         setFormBankName(paySettings.bank_name);
    if (paySettings?.bank_account)      setFormBankAcc(paySettings.bank_account);
    if (paySettings?.bank_account_name) setFormBankAccName(paySettings.bank_account_name);
    setShowDepositModal(true);
  }

  function submitDeposit() {
    const amt = parseInt(formAmount.replace(/\D/g, '') || '0', 10);
    if (!amt || amt <= 0)        { toast.error('Số tiền > 0'); return; }
    if (!formBankName.trim())    { toast.error('Nhập tên ngân hàng'); return; }
    if (!formBankAcc.trim())     { toast.error('Nhập số tài khoản'); return; }
    if (data && amt > data.cash_balance) {
      if (!confirm(`Số tiền nộp (${formatCurrency(amt)}) vượt quỹ tiền mặt hiện có (${formatCurrency(data.cash_balance)}). Tiếp tục?`)) return;
    }
    depositMut.mutate({
      amount:            amt,
      bank_name:         formBankName.trim(),
      bank_account:      formBankAcc.trim(),
      bank_account_name: formBankAccName.trim() || undefined,
      receipt_number:    formReceiptNo.trim() || undefined,
      receipt_image_url: formReceiptImage || undefined,
      notes:             formNotes.trim() || undefined,
    });
  }

  async function handleUploadReceipt(file: File) {
    const url = await upload(file);
    if (url) {
      setFormReceiptImage(url);
      toast.success('Đã upload ảnh biên lai');
    }
  }

  if (isLoading) {
    return (
      <>
        <div className="topbar"><span className="topbar-title">🏦 Tồn quỹ & Doanh thu</span></div>
        <div className="page-content">
          <div className="loading-center"><div className="spinner" style={{ width: 36, height: 36 }} /></div>
        </div>
      </>
    );
  }

  if (!data) return null;

  const t = data.today;
  const overThreshold = data.is_over_threshold;

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🏦 Tồn quỹ & Doanh thu</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowHistoryModal(true)}>
            📋 Lịch sử nộp ({deposits.length})
          </button>
          <button className="btn btn-primary" onClick={openDepositModal}>
            + Nộp tiền vào ngân hàng
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* ── 4 KPI Cards ── */}
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card green">
            <div className="icon" style={{ float: 'right', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>💵</div>
            <div className="label">Thu tiền mặt hôm nay</div>
            <div className="value">{formatCurrency(t.cash_in)}</div>
            <div className="change">vào quỹ tiền mặt</div>
          </div>
          <div className="stat-card blue">
            <div className="icon" style={{ float: 'right', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🏦</div>
            <div className="label">Thu chuyển khoản hôm nay</div>
            <div className="value">{formatCurrency(t.bank_in)}</div>
            <div className="change">SEPay + bank transfer</div>
          </div>
          <div className="stat-card red">
            <div className="icon" style={{ float: 'right', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>💸</div>
            <div className="label">Chi hôm nay</div>
            <div className="value">{formatCurrency(t.total_out)}</div>
            <div className="change">
              TM: {formatCurrency(t.cash_out)} · CK: {formatCurrency(t.bank_out)}
            </div>
          </div>
          <div className={`stat-card ${overThreshold ? 'red' : 'orange'}`}>
            <div className="icon" style={{ float: 'right', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
              {overThreshold ? '⚠️' : '🏧'}
            </div>
            <div className="label">Quỹ tiền mặt hiện tại</div>
            <div className="value">{formatCurrency(data.cash_balance)}</div>
            <div className="change">
              {overThreshold
                ? `⚠️ Vượt ngưỡng ${formatCurrency(data.max_cash_allowed)} — nên nộp về NH`
                : `Ngưỡng cảnh báo: ${formatCurrency(data.max_cash_allowed)}`}
            </div>
          </div>
        </div>

        {overThreshold && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 8, padding: '12px 16px', marginBottom: 16,
            color: '#991b1b', fontSize: 14,
          }}>
            <strong>⚠️ Cảnh báo:</strong> Quỹ tiền mặt vượt ngưỡng cho phép.
            Đề nghị nộp tiền về tài khoản công ty để đảm bảo an toàn.{' '}
            <button
              onClick={openDepositModal}
              style={{ background: 'none', border: 'none', textDecoration: 'underline', color: '#991b1b', fontWeight: 700, cursor: 'pointer' }}
            >Tạo phiếu nộp ngay →</button>
          </div>
        )}

        {/* ── Bảng giao dịch hôm nay ── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📋 Giao dịch hôm nay ({data.transactions_today.length})</span>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Cập nhật: {formatDateTime(data.updated_at)}
            </span>
          </div>
          <div className="table-wrap">
            {data.transactions_today.length === 0 ? (
              <div className="empty-state"><p>Chưa có giao dịch nào hôm nay</p></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Loại</th>
                    <th>Phương thức</th>
                    <th>Mô tả</th>
                    <th style={{ textAlign: 'right' }}>Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.transactions_today]
                    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
                    .map((txn, i) => (
                      <tr key={i}>
                        <td className="text-muted" style={{ fontSize: 12 }}>
                          {formatDateTime(txn.created_at)}
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: txn.type === 'income' ? '#dcfce7' : '#fee2e2',
                            color:      txn.type === 'income' ? '#15803d' : '#991b1b',
                          }}>
                            {txn.type === 'income' ? '↓ Thu' : '↑ Chi'}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: txn.payment_method === 'cash' ? '#fef3c7' : '#dbeafe',
                            color:      txn.payment_method === 'cash' ? '#92400e' : '#1d4ed8',
                          }}>
                            {PAYMENT_METHOD_LABEL[txn.payment_method] ?? txn.payment_method}
                          </span>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {txn.description || <span className="text-muted">—</span>}
                        </td>
                        <td style={{
                          textAlign: 'right',
                          fontWeight: 700,
                          color: txn.type === 'income' ? '#15803d' : '#991b1b',
                        }}>
                          {txn.type === 'income' ? '+' : '−'}{formatCurrency(txn.amount)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modal nộp tiền */}
      {showDepositModal && (
        <div className="modal-overlay" onClick={() => setShowDepositModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">+ Nộp tiền vào tài khoản công ty</span>
              <button className="modal-close" onClick={() => setShowDepositModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{
                background: '#dbeafe', border: '1px solid #93c5fd',
                borderRadius: 6, padding: 10, fontSize: 13, marginBottom: 12, color: '#1e3a8a',
              }}>
                💡 Quỹ tiền mặt hiện tại: <strong>{formatCurrency(data.cash_balance)}</strong>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  Phiếu nộp này sẽ giảm quỹ tiền mặt và ghi nhận chi tiền về tài khoản ngân hàng.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Số tiền nộp <span className="required">*</span></label>
                <input className="form-control" inputMode="numeric" placeholder="0"
                  value={formAmount}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setFormAmount(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                  }}
                  autoFocus />
              </div>

              <div className="form-group">
                <label className="form-label">Ngân hàng <span className="required">*</span></label>
                <input className="form-control"
                  placeholder="Techcombank, VCB..."
                  value={formBankName}
                  onChange={e => setFormBankName(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Số tài khoản <span className="required">*</span></label>
                <input className="form-control"
                  placeholder="0123456789"
                  value={formBankAcc}
                  onChange={e => setFormBankAcc(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Tên chủ tài khoản</label>
                <input className="form-control"
                  placeholder="VINFAST NAM THANG"
                  value={formBankAccName}
                  onChange={e => setFormBankAccName(e.target.value.toUpperCase())} />
              </div>

              <div className="form-group">
                <label className="form-label">Số biên lai (nếu có)</label>
                <input className="form-control"
                  value={formReceiptNo}
                  onChange={e => setFormReceiptNo(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Ảnh biên lai chuyển khoản</label>
                {formReceiptImage ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img
                      src={formReceiptImage}
                      alt="Biên lai"
                      style={{
                        maxWidth: '100%', maxHeight: 280,
                        borderRadius: 8, border: '1px solid #e5e7eb',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setFormReceiptImage('')}
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        background: '#dc2626', color: '#fff', border: 'none',
                        width: 28, height: 28, borderRadius: '50%',
                        cursor: 'pointer', fontSize: 14, fontWeight: 700,
                      }}
                      title="Xóa ảnh"
                    >×</button>
                  </div>
                ) : (
                  <label style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: 20, border: '2px dashed #cbd5e1', borderRadius: 8,
                    cursor: uploading ? 'wait' : 'pointer',
                    background: uploading ? '#f9fafb' : '#fff',
                  }}>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: 'none' }}
                      disabled={uploading}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadReceipt(file);
                      }}
                    />
                    <div style={{ fontSize: 32, marginBottom: 6 }}>📸</div>
                    <div style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                      {uploading ? 'Đang upload...' : 'Chụp / chọn ảnh biên lai'}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      JPG, PNG, WEBP — tối đa 5MB
                    </div>
                  </label>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <textarea className="form-control" rows={2}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDepositModal(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={submitDeposit} disabled={depositMut.isPending}>
                {depositMut.isPending ? 'Đang nộp...' : '✓ Xác nhận nộp tiền'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal lịch sử nộp tiền */}
      {showHistoryModal && (
        <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Lịch sử nộp tiền</span>
              <button className="modal-close" onClick={() => setShowHistoryModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {deposits.length === 0 ? (
                <div className="empty-state"><p>Chưa có phiếu nộp tiền nào</p></div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Mã phiếu</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Ngày</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Ngân hàng</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Số tiền</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Biên lai</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>NV nộp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map(d => (
                      <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <span className="font-mono" style={{ color: '#2563eb' }}>{d.deposit_code}</span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>{formatDate(d.deposit_date)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <strong>{d.bank_name}</strong>
                          <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{d.bank_account}</div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>
                          {formatCurrency(d.amount)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {d.receipt_image_url ? (
                            <a href={d.receipt_image_url} target="_blank" rel="noreferrer"
                              style={{ display: 'inline-block' }}>
                              <img src={d.receipt_image_url} alt="Biên lai"
                                style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid #e5e7eb' }} />
                            </a>
                          ) : <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12, color: '#6b7280' }}>
                          {d.users?.full_name ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowHistoryModal(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
