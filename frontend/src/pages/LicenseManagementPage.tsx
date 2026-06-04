import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

interface BranchLicense {
  id: string;
  code: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  is_active: boolean;
  license_start?: string;
  license_end?: string;
  license_plan: string;
  max_users: number;
  current_users: number;
  is_expired: boolean;
  days_remaining: number | null;
  created_at: string;
}

interface LicenseLog {
  id: string;
  branch_id: string;
  action: string;
  previous_end?: string;
  new_end?: string;
  performed_by: string;
  reason?: string;
  created_at: string;
}

const PLAN_LABELS: Record<string, string> = {
  basic: 'Cơ bản',
  pro: 'Nâng cao',
  enterprise: 'Doanh nghiệp',
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  activate: { label: 'Kích hoạt', color: '#16a34a' },
  extend: { label: 'Gia hạn', color: '#2563eb' },
  suspend: { label: 'Tạm dừng', color: '#d97706' },
  revoke: { label: 'Thu hồi', color: '#dc2626' },
  plan_change: { label: 'Đổi gói', color: '#7c3aed' },
};

function StatusBadge({ branch }: { branch: BranchLicense }) {
  if (!branch.is_active) {
    return <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>Tạm dừng</span>;
  }
  if (branch.is_expired) {
    return <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>Hết hạn</span>;
  }
  if (branch.days_remaining !== null && branch.days_remaining <= 7) {
    return <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>Sắp hết hạn</span>;
  }
  return <span style={{ padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>Hoạt động</span>;
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
        {children}
      </div>
    </div>
  );
}

export default function LicenseManagementPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [extendModal, setExtendModal] = useState<BranchLicense | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [extendReason, setExtendReason] = useState('');
  const [suspendModal, setSuspendModal] = useState<BranchLicense | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [showLogs, setShowLogs] = useState<string | null>(null);

  // Fetch branches
  const { data, isLoading } = useQuery({
    queryKey: ['license-branches'],
    queryFn: async () => {
      const res = await api.get('/license/branches');
      return res.data as { data: BranchLicense[]; total: number };
    },
  });

  // Fetch logs
  const { data: logsData } = useQuery({
    queryKey: ['license-logs', showLogs],
    queryFn: async () => {
      const res = await api.get('/license/logs', { params: { branch_id: showLogs, limit: 20 } });
      return res.data as { data: LicenseLog[] };
    },
    enabled: !!showLogs,
  });

  // Gia hạn
  const extendMutation = useMutation({
    mutationFn: ({ id, days, reason }: { id: string; days: number; reason: string }) =>
      api.post(`/license/branches/${id}/extend`, { days, reason }),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['license-branches'] });
      setExtendModal(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi gia hạn'),
  });

  // Tạm dừng
  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/license/branches/${id}/suspend`, { reason }),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['license-branches'] });
      setSuspendModal(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi tạm dừng'),
  });

  // Kích hoạt lại
  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/license/branches/${id}/activate`, { reason: 'Admin kích hoạt lại' }),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['license-branches'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi'),
  });

  if (user?.role !== 'admin') {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Chỉ admin mới có quyền quản lý license.</div>;
  }

  const branches = data?.data || [];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>🔑 Quản lý License</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Gia hạn, tạm dừng hoặc thu hồi quyền sử dụng của từng chi nhánh</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Tổng chi nhánh', value: branches.length, color: '#6b7280', bg: '#f9fafb' },
          { label: 'Đang hoạt động', value: branches.filter(b => b.is_active && !b.is_expired).length, color: '#16a34a', bg: '#f0fdf4' },
          { label: 'Hết hạn', value: branches.filter(b => b.is_expired).length, color: '#d97706', bg: '#fffbeb' },
          { label: 'Tạm dừng', value: branches.filter(b => !b.is_active).length, color: '#dc2626', bg: '#fef2f2' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32, margin: '0 auto' }} /></div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Chi nhánh</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Trạng thái</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Gói</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Users</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Còn lại</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Hết hạn</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {branches.map(branch => (
                <tr key={branch.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 600, color: '#111827' }}>{branch.name}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace' }}>{branch.code}</div>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                    <StatusBadge branch={branch} />
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: 13 }}>
                    {PLAN_LABELS[branch.license_plan] || branch.license_plan}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: 13 }}>
                    {branch.current_users}/{branch.max_users}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                    {branch.days_remaining !== null ? (
                      <span style={{ fontWeight: 600, color: branch.days_remaining <= 7 ? '#d97706' : branch.days_remaining <= 0 ? '#dc2626' : '#111827' }}>
                        {branch.days_remaining > 0 ? `${branch.days_remaining} ngày` : 'Đã hết'}
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>Vĩnh viễn</span>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
                    {branch.license_end ? new Date(branch.license_end).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => { setExtendModal(branch); setExtendDays(30); setExtendReason(''); }}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#2563eb', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                      >
                        + Gia hạn
                      </button>
                      {branch.is_active ? (
                        <button
                          onClick={() => { setSuspendModal(branch); setSuspendReason(''); }}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #fed7aa', background: '#fff7ed', color: '#d97706', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                        >
                          ⏸ Dừng
                        </button>
                      ) : (
                        <button
                          onClick={() => activateMutation.mutate(branch.id)}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                        >
                          ▶ Mở lại
                        </button>
                      )}
                      <button
                        onClick={() => setShowLogs(branch.id)}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#6b7280', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                      >
                        📋
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Chưa có chi nhánh nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Gia hạn */}
      {extendModal && (
        <Modal onClose={() => setExtendModal(null)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#111827' }}>Gia hạn license</h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>Chi nhánh: <strong>{extendModal.name}</strong> ({extendModal.code})</p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Số ngày gia hạn</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[30, 60, 90, 180, 365].map(d => (
                <button
                  key={d}
                  onClick={() => setExtendDays(d)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: extendDays === d ? '2px solid #2563eb' : '1.5px solid #e5e7eb',
                    background: extendDays === d ? '#eff6ff' : '#fff', color: extendDays === d ? '#2563eb' : '#374151',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {d} ngày
                </button>
              ))}
            </div>
            <input
              type="number"
              value={extendDays}
              onChange={e => setExtendDays(Number(e.target.value))}
              min={1}
              style={{ marginTop: 10, width: 120, padding: '8px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Lý do (tùy chọn)</label>
            <input
              value={extendReason}
              onChange={e => setExtendReason(e.target.value)}
              placeholder="VD: Khách hàng đã thanh toán tháng 6"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button onClick={() => setExtendModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e5e7eb', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Hủy</button>
            <button
              onClick={() => extendMutation.mutate({ id: extendModal.id, days: extendDays, reason: extendReason })}
              disabled={extendMutation.isPending}
              style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: extendMutation.isPending ? 0.6 : 1 }}
            >
              {extendMutation.isPending ? 'Đang xử lý...' : `Gia hạn ${extendDays} ngày`}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal: Tạm dừng */}
      {suspendModal && (
        <Modal onClose={() => setSuspendModal(null)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#dc2626' }}>⚠️ Tạm dừng chi nhánh</h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Chi nhánh: <strong>{suspendModal.name}</strong></p>
          <div style={{ background: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#991b1b' }}>
            <strong>Lưu ý:</strong> Tất cả nhân viên của chi nhánh này sẽ bị đăng xuất ngay lập tức và không thể đăng nhập lại cho đến khi bạn kích hoạt lại.
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Lý do tạm dừng</label>
            <input
              value={suspendReason}
              onChange={e => setSuspendReason(e.target.value)}
              placeholder="VD: Chưa thanh toán phí tháng 6"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button onClick={() => setSuspendModal(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e5e7eb', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Hủy</button>
            <button
              onClick={() => suspendMutation.mutate({ id: suspendModal.id, reason: suspendReason })}
              disabled={suspendMutation.isPending}
              style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: suspendMutation.isPending ? 0.6 : 1 }}
            >
              {suspendMutation.isPending ? 'Đang xử lý...' : 'Xác nhận tạm dừng'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal: Lịch sử */}
      {showLogs && (
        <Modal onClose={() => setShowLogs(null)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 20px', color: '#111827' }}>📋 Lịch sử thao tác</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(logsData?.data || []).map(log => {
              const actionInfo = ACTION_LABELS[log.action] || { label: log.action, color: '#6b7280' };
              return (
                <div key={log.id} style={{ padding: '10px 14px', borderRadius: 8, background: '#f9fafb', border: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: actionInfo.color }}>{actionInfo.label}</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{new Date(log.created_at).toLocaleString('vi-VN')}</span>
                  </div>
                  {log.reason && <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>{log.reason}</p>}
                  {log.new_end && <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>→ Hạn mới: {new Date(log.new_end).toLocaleDateString('vi-VN')}</p>}
                </div>
              );
            })}
            {(!logsData?.data || logsData.data.length === 0) && (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: 20 }}>Chưa có lịch sử</p>
            )}
          </div>
          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button onClick={() => setShowLogs(null)} style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e5e7eb', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Đóng</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
