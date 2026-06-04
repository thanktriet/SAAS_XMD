// Trang Phiếu chi tiền mặt — ứng tiền dịch vụ đăng ký
// Workflow: pending → approved → completed → reconciled
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatCurrency, formatDate } from '../utils/helpers';
import { useAuthStore } from '../store/authStore';
import { useUploadImage } from '../hooks/useUploadImage';
import toast from 'react-hot-toast';

interface CashAdvance {
  id:                     string;
  advance_code:           string;
  purpose:                string;
  amount_requested:       number;
  amount_actual:          number | null;
  sales_order_id:         string | null;
  status:                 'pending' | 'approved' | 'rejected' | 'completed' | 'reconciled' | 'cancelled';
  receipt_number:         string | null;
  receipt_date:           string | null;
  reject_reason:          string | null;
  approved_at:            string | null;
  completed_at:           string | null;
  reconciled_at:          string | null;
  notes:                  string | null;
  created_at:             string;
  requester?:             { full_name: string } | null;
  approver?:              { full_name: string } | null;
  reconciler?:            { full_name: string } | null;
  sales_orders?:          { order_number: string; customers?: { full_name: string } } | null;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  pending:    { label: '⏳ Chờ duyệt',     bg: '#fef3c7', color: '#92400e' },
  approved:   { label: '✓ Đã duyệt',       bg: '#dbeafe', color: '#1d4ed8' },
  rejected:   { label: '❌ Từ chối',        bg: '#fee2e2', color: '#991b1b' },
  completed:  { label: '📋 Đã có biên lai', bg: '#fce7f3', color: '#9d174d' },
  reconciled: { label: '✅ Đã đối chiếu',   bg: '#dcfce7', color: '#15803d' },
  cancelled:  { label: '🚫 Đã hủy',         bg: '#f3f4f6', color: '#6b7280' },
};

export default function CashAdvancesPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const role = user?.role ?? '';
  const canApprove    = ['admin', 'manager'].includes(role);
  const canReconcile  = ['admin', 'manager', 'accountant'].includes(role);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<CashAdvance | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'complete' | 'reconcile' | null>(null);
  const [viewAdvance, setViewAdvance] = useState<CashAdvance | null>(null);

  // Form tạo
  const [formPurpose, setFormPurpose] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Form complete
  const [completeAmount, setCompleteAmount] = useState('');
  const [completeReceiptNo, setCompleteReceiptNo] = useState('');
  const [completeReceiptDate, setCompleteReceiptDate] = useState('');
  const [completeNotes, setCompleteNotes] = useState('');
  const [completeReceiptImage, setCompleteReceiptImage] = useState('');
  const { uploading: imgUploading, upload: uploadImg } = useUploadImage({
    bucket: 'vehicle-images',
    folder: 'advances',
  });

  // Form reject
  const [rejectReason, setRejectReason] = useState('');

  // Queries
  const { data, isLoading } = useQuery<{ data: CashAdvance[]; total: number }>({
    queryKey: ['cash-advances', statusFilter, search],
    queryFn: () => api.get('/cash-advances', {
      params: { status: statusFilter || undefined, search: search || undefined },
    }).then(r => r.data),
    refetchInterval: 15_000,
  });
  const advances = data?.data ?? [];

  // Mutations
  const createMut = useMutation({
    mutationFn: (body: any) => api.post('/cash-advances', body).then(r => r.data),
    onSuccess: () => {
      toast.success('✅ Đã tạo phiếu chi');
      qc.invalidateQueries({ queryKey: ['cash-advances'] });
      setShowNewModal(false);
      setFormPurpose(''); setFormAmount(''); setFormNotes('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo phiếu'),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/cash-advances/${id}/approve`).then(r => r.data),
    onSuccess: () => {
      toast.success('✓ Đã duyệt phiếu');
      qc.invalidateQueries({ queryKey: ['cash-advances'] });
      setSelectedAdvance(null); setActionType(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi duyệt'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/cash-advances/${id}/reject`, { reject_reason: reason }).then(r => r.data),
    onSuccess: () => {
      toast.success('Đã từ chối');
      qc.invalidateQueries({ queryKey: ['cash-advances'] });
      setSelectedAdvance(null); setActionType(null); setRejectReason('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi từ chối'),
  });

  const completeMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.patch(`/cash-advances/${id}/complete`, body).then(r => r.data),
    onSuccess: () => {
      toast.success('✅ Đã ghi nhận biên lai');
      qc.invalidateQueries({ queryKey: ['cash-advances'] });
      setSelectedAdvance(null); setActionType(null);
      setCompleteAmount(''); setCompleteReceiptNo(''); setCompleteReceiptDate(''); setCompleteNotes('');
      setCompleteReceiptImage('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi hoàn tất'),
  });

  const reconcileMut = useMutation({
    mutationFn: (id: string) => api.patch(`/cash-advances/${id}/reconcile`).then(r => r.data),
    onSuccess: () => {
      toast.success('✅ Đã đối chiếu — ghi nhận chi tiền mặt');
      qc.invalidateQueries({ queryKey: ['cash-advances'] });
      setSelectedAdvance(null); setActionType(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi đối chiếu'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/cash-advances/${id}/cancel`).then(r => r.data),
    onSuccess: () => {
      toast.success('Đã hủy phiếu');
      qc.invalidateQueries({ queryKey: ['cash-advances'] });
      setSelectedAdvance(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi hủy'),
  });

  function submitCreate() {
    if (!formPurpose.trim()) { toast.error('Nhập mục đích chi'); return; }
    const amt = parseInt(formAmount.replace(/\D/g, '') || '0', 10);
    if (!amt || amt <= 0) { toast.error('Số tiền > 0'); return; }
    createMut.mutate({
      purpose: formPurpose.trim(),
      amount_requested: amt,
      notes: formNotes.trim() || undefined,
    });
  }

  function openComplete(a: CashAdvance) {
    setSelectedAdvance(a);
    setActionType('complete');
    setCompleteAmount(a.amount_requested.toLocaleString('vi-VN'));
    setCompleteReceiptNo('');
    setCompleteReceiptDate(new Date().toISOString().split('T')[0]);
    setCompleteNotes('');
    setCompleteReceiptImage('');
  }

  function submitComplete() {
    if (!selectedAdvance) return;
    const amt = parseInt(completeAmount.replace(/\D/g, '') || '0', 10);
    if (!amt || amt <= 0) { toast.error('Số tiền thực chi > 0'); return; }
    if (!completeReceiptImage) { toast.error('Phải upload ảnh scan biên lai'); return; }

    completeMut.mutate({
      id: selectedAdvance.id,
      body: {
        amount_actual:     amt,
        receipt_number:    completeReceiptNo.trim() || undefined,
        receipt_date:      completeReceiptDate || undefined,
        receipt_image_url: completeReceiptImage,
        notes:             completeNotes.trim() || undefined,
      },
    });
  }

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💵 Phiếu chi tiền mặt</span>
        <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
          + Tạo phiếu chi
        </button>
      </div>

      <div className="page-content">
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              className="form-control"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="Tìm theo mã phiếu / mục đích / số biên lai"
              value={search} onChange={e => setSearch(e.target.value)}
            />
            <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">Tất cả trạng thái</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Phiếu chi ({advances.length})</span>
          </div>
          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : advances.length === 0 ? (
              <div className="empty-state"><p>Chưa có phiếu chi nào</p></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Mã phiếu</th>
                    <th>Mục đích</th>
                    <th style={{ textAlign: 'right' }}>Yêu cầu</th>
                    <th style={{ textAlign: 'right' }}>Thực chi</th>
                    <th>Trạng thái</th>
                    <th className="hide-mobile">NV tạo</th>
                    <th className="hide-mobile">Ngày</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map(a => {
                    const st = STATUS_CONFIG[a.status];
                    const diff = a.amount_actual != null ? a.amount_actual - a.amount_requested : null;
                    return (
                      <tr key={a.id}>
                        <td><span className="font-mono text-primary">{a.advance_code}</span></td>
                        <td style={{ maxWidth: 280 }}>
                          <div style={{ fontWeight: 600 }}>{a.purpose}</div>
                          {a.sales_orders?.order_number && (
                            <div style={{ fontSize: 11, color: '#6b7280' }}>
                              Đơn: {a.sales_orders.order_number}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="fw-600">
                          {formatCurrency(a.amount_requested)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="fw-600">
                          {a.amount_actual != null ? (
                            <>
                              {formatCurrency(a.amount_actual)}
                              {diff != null && diff !== 0 && (
                                <div style={{
                                  fontSize: 11,
                                  color: diff > 0 ? '#dc2626' : '#15803d',
                                }}>
                                  {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                                </div>
                              )}
                            </>
                          ) : '—'}
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                            fontSize: 11, fontWeight: 600,
                            background: st.bg, color: st.color,
                          }}>{st.label}</span>
                        </td>
                        <td className="text-muted hide-mobile" style={{ fontSize: 12 }}>
                          {a.requester?.full_name ?? '—'}
                        </td>
                        <td className="text-muted hide-mobile" style={{ fontSize: 12 }}>
                          {formatDate(a.created_at)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm btn-secondary"
                              onClick={() => setViewAdvance(a)} title="Xem chi tiết">
                              👁 Xem
                            </button>
                            {a.status === 'pending' && canApprove && (
                              <>
                                <button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff' }}
                                  onClick={() => approveMut.mutate(a.id)} disabled={approveMut.isPending}>
                                  ✓ Duyệt
                                </button>
                                <button className="btn btn-sm btn-danger"
                                  onClick={() => { setSelectedAdvance(a); setActionType('reject'); setRejectReason(''); }}>
                                  ✗ Từ chối
                                </button>
                              </>
                            )}
                            {a.status === 'approved' && (
                              <button className="btn btn-sm" style={{ background: '#9d174d', color: '#fff' }}
                                onClick={() => openComplete(a)}>
                                📋 Biên lai
                              </button>
                            )}
                            {a.status === 'completed' && canReconcile && (
                              <button className="btn btn-sm" style={{ background: '#15803d', color: '#fff' }}
                                onClick={() => {
                                  if (confirm(`Đối chiếu ${a.advance_code}? Sẽ ghi finance ${formatCurrency(a.amount_actual ?? 0)}`)) {
                                    reconcileMut.mutate(a.id);
                                  }
                                }}
                                disabled={reconcileMut.isPending}>
                                ✅ Đối chiếu
                              </button>
                            )}
                            {!['completed', 'reconciled', 'cancelled', 'rejected'].includes(a.status) && (
                              <button className="btn btn-sm btn-secondary"
                                onClick={() => {
                                  if (confirm(`Hủy phiếu ${a.advance_code}?`)) cancelMut.mutate(a.id);
                                }}>
                                Hủy
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modal tạo phiếu */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">+ Tạo phiếu chi mới</span>
              <button className="modal-close" onClick={() => setShowNewModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Mục đích chi <span className="required">*</span></label>
                <input className="form-control"
                  placeholder="VD: Đăng ký biển số xe DH202600001"
                  value={formPurpose} onChange={e => setFormPurpose(e.target.value)}
                  autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Số tiền yêu cầu ứng <span className="required">*</span></label>
                <input className="form-control"
                  inputMode="numeric" placeholder="0"
                  value={formAmount}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setFormAmount(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                  }} />
              </div>
              <div className="form-group">
                <label className="form-label">Ghi chú</label>
                <textarea className="form-control" rows={2}
                  value={formNotes} onChange={e => setFormNotes(e.target.value)} />
              </div>
              <div style={{
                background: '#fef3c7', border: '1px solid #fcd34d',
                borderRadius: 6, padding: 10, fontSize: 12, color: '#92400e',
              }}>
                ℹ️ Phiếu cần được manager/admin duyệt trước khi nhận tiền. Sau khi đi làm xong → mang biên lai về để kế toán đối chiếu.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>Hủy</button>
              <button className="btn btn-primary" onClick={submitCreate} disabled={createMut.isPending}>
                {createMut.isPending ? 'Đang tạo...' : '✓ Gửi yêu cầu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nhập biên lai */}
      {actionType === 'complete' && selectedAdvance && (
        <div className="modal-overlay" onClick={() => setActionType(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Nhập biên lai — {selectedAdvance.advance_code}</span>
              <button className="modal-close" onClick={() => setActionType(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{
                background: '#dbeafe', border: '1px solid #93c5fd',
                borderRadius: 6, padding: 10, fontSize: 13, marginBottom: 12,
              }}>
                <strong>{selectedAdvance.purpose}</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Đã ứng: {formatCurrency(selectedAdvance.amount_requested)}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Số tiền thực chi <span className="required">*</span></label>
                <input className="form-control" inputMode="numeric"
                  value={completeAmount}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g, '');
                    setCompleteAmount(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                  }} />
                <small style={{ fontSize: 11, color: '#6b7280' }}>
                  Có thể bằng / nhỏ hơn / lớn hơn số đã ứng. Chênh lệch sẽ hiện ở danh sách.
                </small>
              </div>
              <div className="form-group">
                <label className="form-label">Ảnh scan biên lai <span className="required">*</span></label>
                {completeReceiptImage ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={completeReceiptImage} alt="Biên lai"
                      style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                    <button
                      type="button"
                      onClick={() => setCompleteReceiptImage('')}
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
                    cursor: imgUploading ? 'wait' : 'pointer',
                    background: imgUploading ? '#f9fafb' : '#fff',
                  }}>
                    <input type="file" accept="image/*" capture="environment"
                      style={{ display: 'none' }} disabled={imgUploading}
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const url = await uploadImg(file);
                        if (url) setCompleteReceiptImage(url);
                        e.target.value = '';
                      }} />
                    <div style={{ fontSize: 32, marginBottom: 6 }}>📸</div>
                    <div style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                      {imgUploading ? 'Đang upload...' : 'Chụp / chọn ảnh biên lai'}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      JPG, PNG — tối đa 5MB
                    </div>
                  </label>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Số biên lai <span style={{ color: '#9ca3af', fontSize: 11 }}>(tùy chọn)</span></label>
                <input className="form-control"
                  placeholder="Số biên lai từ cơ quan đăng ký (nếu có)"
                  value={completeReceiptNo}
                  onChange={e => setCompleteReceiptNo(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Ngày biên lai <span style={{ color: '#9ca3af', fontSize: 11 }}>(tùy chọn)</span></label>
                <input className="form-control" type="date"
                  value={completeReceiptDate}
                  onChange={e => setCompleteReceiptDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Ghi chú thêm</label>
                <textarea className="form-control" rows={2}
                  value={completeNotes}
                  onChange={e => setCompleteNotes(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActionType(null)}>Hủy</button>
              <button className="btn btn-primary" onClick={submitComplete} disabled={completeMut.isPending}>
                {completeMut.isPending ? 'Đang lưu...' : '✓ Hoàn tất'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal từ chối */}
      {actionType === 'reject' && selectedAdvance && (
        <div className="modal-overlay" onClick={() => setActionType(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">❌ Từ chối phiếu — {selectedAdvance.advance_code}</span>
              <button className="modal-close" onClick={() => setActionType(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Lý do từ chối <span className="required">*</span></label>
                <textarea className="form-control" rows={3}
                  placeholder="Vd: Không đúng quy trình, thiếu thông tin..."
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActionType(null)}>Hủy</button>
              <button className="btn btn-danger"
                onClick={() => {
                  if (!rejectReason.trim()) { toast.error('Nhập lý do'); return; }
                  rejectMut.mutate({ id: selectedAdvance.id, reason: rejectReason.trim() });
                }}
                disabled={rejectMut.isPending}>
                {rejectMut.isPending ? 'Đang xử lý...' : '✓ Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Modal Xem chi tiết ════ */}
      {viewAdvance && (
        <div className="modal-overlay" onClick={() => setViewAdvance(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                💵 Phiếu chi <span className="font-mono text-primary">{viewAdvance.advance_code}</span>
              </span>
              <button className="modal-close" onClick={() => setViewAdvance(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10, columnGap: 12, fontSize: 14 }}>
                <div className="text-muted">Trạng thái:</div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: 99,
                    fontSize: 12, fontWeight: 600,
                    background: STATUS_CONFIG[viewAdvance.status].bg,
                    color:      STATUS_CONFIG[viewAdvance.status].color,
                  }}>{STATUS_CONFIG[viewAdvance.status].label}</span>
                </div>

                <div className="text-muted">Mục đích:</div>
                <div className="fw-600">{viewAdvance.purpose}</div>

                {viewAdvance.sales_orders?.order_number && (<>
                  <div className="text-muted">Đơn hàng:</div>
                  <div>
                    <span className="font-mono">{viewAdvance.sales_orders.order_number}</span>
                    {viewAdvance.sales_orders.customers?.full_name && (
                      <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        — {viewAdvance.sales_orders.customers.full_name}
                      </span>
                    )}
                  </div>
                </>)}

                <div className="text-muted">Số tiền yêu cầu:</div>
                <div className="fw-600">{formatCurrency(viewAdvance.amount_requested)}</div>

                {viewAdvance.amount_actual != null && (<>
                  <div className="text-muted">Thực chi:</div>
                  <div className="fw-600">
                    {formatCurrency(viewAdvance.amount_actual)}
                    {(() => {
                      const diff = viewAdvance.amount_actual! - viewAdvance.amount_requested;
                      if (diff === 0) return null;
                      return (
                        <span style={{ marginLeft: 8, fontSize: 12, color: diff > 0 ? '#dc2626' : '#15803d' }}>
                          ({diff > 0 ? '+' : ''}{formatCurrency(diff)} so với yêu cầu)
                        </span>
                      );
                    })()}
                  </div>
                </>)}

                {viewAdvance.receipt_number && (<>
                  <div className="text-muted">Số biên lai:</div>
                  <div className="font-mono">{viewAdvance.receipt_number}</div>
                </>)}

                {viewAdvance.receipt_date && (<>
                  <div className="text-muted">Ngày biên lai:</div>
                  <div>{formatDate(viewAdvance.receipt_date)}</div>
                </>)}

                {viewAdvance.reject_reason && (<>
                  <div className="text-muted">Lý do từ chối:</div>
                  <div style={{ color: '#991b1b' }}>{viewAdvance.reject_reason}</div>
                </>)}

                <div className="text-muted">Người tạo:</div>
                <div>{viewAdvance.requester?.full_name ?? '—'}</div>

                <div className="text-muted">Tạo lúc:</div>
                <div>{formatDate(viewAdvance.created_at)}</div>

                {viewAdvance.approved_at && (<>
                  <div className="text-muted">Duyệt:</div>
                  <div>
                    {formatDate(viewAdvance.approved_at)}
                    {viewAdvance.approver?.full_name && (
                      <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        bởi {viewAdvance.approver.full_name}
                      </span>
                    )}
                  </div>
                </>)}

                {viewAdvance.completed_at && (<>
                  <div className="text-muted">Có biên lai:</div>
                  <div>{formatDate(viewAdvance.completed_at)}</div>
                </>)}

                {viewAdvance.reconciled_at && (<>
                  <div className="text-muted">Đối chiếu:</div>
                  <div>
                    {formatDate(viewAdvance.reconciled_at)}
                    {viewAdvance.reconciler?.full_name && (
                      <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
                        bởi {viewAdvance.reconciler.full_name}
                      </span>
                    )}
                  </div>
                </>)}

                {viewAdvance.notes && (<>
                  <div className="text-muted">Ghi chú:</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{viewAdvance.notes}</div>
                </>)}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setViewAdvance(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
