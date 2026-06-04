import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Branch {
  id: string;
  branch_code: string;
  branch_name: string;
  branch_type: string;
  address?: string;
  phone?: string;
  email?: string;
  is_active: boolean;
  created_at: string;
}

interface BranchBranding {
  branch_id: string;
  store_name: string;
  subtitle?: string;
  logo_url?: string;
  color_primary: string;
  color_primary_dark: string;
  color_primary_light: string;
  color_accent: string;
  hotline?: string;
  support_email?: string;
  website_url?: string;
  receipt_footer?: string;
}

const BRANCH_TYPE_LABEL: Record<string, string> = {
  headquarters: 'Trụ sở chính',
  showroom: 'Showroom',
  warehouse: 'Kho hàng',
  service_center: 'Trung tâm DV',
};

const BRANCH_TYPE_COLOR: Record<string, string> = {
  headquarters: '#7c3aed',
  showroom: '#2563eb',
  warehouse: '#d97706',
  service_center: '#059669',
};

// ─── Reusable Input ──────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 600,
        color: '#6b7280', marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', required }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      style={{
        width: '100%', padding: '10px 14px', fontSize: 14,
        border: '1.5px solid #e5e7eb', borderRadius: 10,
        outline: 'none', background: '#fff', color: '#111827',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onFocus={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.boxShadow = '0 0 0 4px rgba(37,99,235,0.1)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none'; }}
    />
  );
}

// ─── Color Picker ────────────────────────────────────────────────────────────
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ width: 40, height: 40, borderRadius: 8, border: '1.5px solid #e5e7eb', cursor: 'pointer', padding: 2 }}
        />
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: 'monospace',
            border: '1.5px solid #e5e7eb', borderRadius: 8, outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#2563eb'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
        />
      </div>
    </Field>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────
function BadgeLoai({ type }: { type: string }) {
  const label = BRANCH_TYPE_LABEL[type] ?? type;
  const color = BRANCH_TYPE_COLOR[type] ?? '#6b7280';
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      background: color + '18', color, border: `1px solid ${color}33`,
    }}>
      {label}
    </span>
  );
}

// ─── Modal Overlay ───────────────────────────────────────────────────────────
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16, backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto',
          padding: 28, animation: 'slideUp 0.2s ease',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function BranchesPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editBranding, setEditBranding] = useState<string | null>(null);
  const [brandingData, setBrandingData] = useState<Partial<BranchBranding>>({});
  const [newBranch, setNewBranch] = useState({
    branch_code: '', branch_name: '', branch_type: 'showroom', address: '', phone: '', email: '',
  });

  const { data: branches, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await api.get('/branding/branches');
      return (res.data.data || []) as Branch[];
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof newBranch) => api.post('/branding/branches', body),
    onSuccess: () => {
      toast.success('Tạo chi nhánh thành công');
      qc.invalidateQueries({ queryKey: ['branches'] });
      setShowCreate(false);
      setNewBranch({ branch_code: '', branch_name: '', branch_type: 'showroom', address: '', phone: '', email: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi tạo chi nhánh'),
  });

  const openBranding = useCallback(async (branchId: string) => {
    try {
      const res = await api.get('/branding', { params: { branch_id: branchId } });
      setBrandingData(res.data || { branch_id: branchId });
    } catch {
      setBrandingData({ branch_id: branchId, store_name: '', color_primary: '#2563eb', color_primary_dark: '#1d4ed8', color_primary_light: '#eff6ff', color_accent: '#16a34a' });
    }
    setEditBranding(branchId);
  }, []);

  const saveBranding = async () => {
    if (!editBranding) return;
    try {
      await api.put('/branding', { ...brandingData, branch_id: editBranding });
      toast.success('Đã lưu cấu hình thương hiệu');
      setEditBranding(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Lỗi lưu');
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Bạn không có quyền truy cập.</div>;
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>🏪 Chi nhánh</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Quản lý chi nhánh & cấu hình thương hiệu riêng</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
            transition: 'transform 0.1s',
          }}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.96)')}
          onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          + Tạo chi nhánh
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32, margin: '0 auto' }} /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(branches || []).map(branch => (
            <div key={branch.id} style={{
              background: '#fff', borderRadius: 14, padding: '18px 22px',
              border: '1px solid #f0f0f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              transition: 'box-shadow 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)')}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{branch.branch_name}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 6,
                    background: '#f3f4f6', color: '#6b7280', fontFamily: 'monospace',
                  }}>{branch.branch_code}</span>
                  <BadgeLoai type={branch.branch_type} />
                </div>
                {branch.address && <p style={{ fontSize: 13, color: '#9ca3af', margin: '6px 0 0' }}>📍 {branch.address}</p>}
                {branch.phone && <p style={{ fontSize: 13, color: '#9ca3af', margin: '2px 0 0' }}>📞 {branch.phone}</p>}
              </div>
              <button
                onClick={() => openBranding(branch.id)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1.5px solid #e5e7eb', background: '#fafafa',
                  fontSize: 13, fontWeight: 500, color: '#374151',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#374151'; }}
              >
                🎨 Thương hiệu
              </button>
            </div>
          ))}
          {(!branches || branches.length === 0) && (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
              <p style={{ fontSize: 40, margin: 0 }}>🏢</p>
              <p style={{ marginTop: 8 }}>Chưa có chi nhánh nào</p>
            </div>
          )}
        </div>
      )}

      {/* Modal: Tạo chi nhánh */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 20px', color: '#111827' }}>Tạo chi nhánh mới</h2>
          <form onSubmit={e => { e.preventDefault(); createMutation.mutate(newBranch); }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Mã chi nhánh" required>
                <TextInput value={newBranch.branch_code} onChange={v => setNewBranch(p => ({ ...p, branch_code: v }))} placeholder="HCM-001" required />
              </Field>
              <Field label="Tên chi nhánh" required>
                <TextInput value={newBranch.branch_name} onChange={v => setNewBranch(p => ({ ...p, branch_name: v }))} placeholder="Chi nhánh TP.HCM" required />
              </Field>
            </div>
            <Field label="Loại chi nhánh">
              <select
                value={newBranch.branch_type}
                onChange={e => setNewBranch(p => ({ ...p, branch_type: e.target.value }))}
                style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '1.5px solid #e5e7eb', borderRadius: 10, outline: 'none', background: '#fff' }}
              >
                <option value="showroom">Showroom</option>
                <option value="headquarters">Trụ sở chính</option>
                <option value="warehouse">Kho hàng</option>
                <option value="service_center">Trung tâm dịch vụ</option>
              </select>
            </Field>
            <Field label="Địa chỉ">
              <TextInput value={newBranch.address} onChange={v => setNewBranch(p => ({ ...p, address: v }))} placeholder="123 Nguyễn Huệ, Q1, TP.HCM" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Số điện thoại">
                <TextInput value={newBranch.phone} onChange={v => setNewBranch(p => ({ ...p, phone: v }))} placeholder="028 xxxx xxxx" />
              </Field>
              <Field label="Email">
                <TextInput value={newBranch.email} onChange={v => setNewBranch(p => ({ ...p, email: v }))} placeholder="chinhanh@..." type="email" />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowCreate(false)} style={{
                padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e5e7eb',
                background: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}>Hủy</button>
              <button type="submit" disabled={createMutation.isPending} style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', opacity: createMutation.isPending ? 0.6 : 1,
              }}>
                {createMutation.isPending ? 'Đang tạo...' : 'Tạo chi nhánh'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Cấu hình thương hiệu */}
      {editBranding && (
        <Modal onClose={() => setEditBranding(null)}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: '#111827' }}>🎨 Cấu hình thương hiệu</h2>
          <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 20px' }}>Tùy chỉnh giao diện cho chi nhánh này</p>

          <Field label="Tên cửa hàng hiển thị" required>
            <TextInput value={brandingData.store_name || ''} onChange={v => setBrandingData(p => ({ ...p, store_name: v }))} placeholder="VD: XMĐ Quận 1" required />
          </Field>
          <Field label="Phụ đề">
            <TextInput value={brandingData.subtitle || ''} onChange={v => setBrandingData(p => ({ ...p, subtitle: v }))} placeholder="Hệ Thống Bán Hàng Xe Máy Điện" />
          </Field>
          <Field label="Logo URL">
            <TextInput value={brandingData.logo_url || ''} onChange={v => setBrandingData(p => ({ ...p, logo_url: v }))} placeholder="/uploads/logo.png hoặc https://..." />
          </Field>

          <div style={{ background: '#f9fafb', borderRadius: 12, padding: 16, margin: '16px 0' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', margin: '0 0 12px', textTransform: 'uppercase' }}>Bảng màu</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ColorField label="Màu chính" value={brandingData.color_primary || '#2563eb'} onChange={v => setBrandingData(p => ({ ...p, color_primary: v }))} />
              <ColorField label="Màu đậm" value={brandingData.color_primary_dark || '#1d4ed8'} onChange={v => setBrandingData(p => ({ ...p, color_primary_dark: v }))} />
              <ColorField label="Màu nhạt" value={brandingData.color_primary_light || '#eff6ff'} onChange={v => setBrandingData(p => ({ ...p, color_primary_light: v }))} />
              <ColorField label="Màu nhấn" value={brandingData.color_accent || '#16a34a'} onChange={v => setBrandingData(p => ({ ...p, color_accent: v }))} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Hotline">
              <TextInput value={brandingData.hotline || ''} onChange={v => setBrandingData(p => ({ ...p, hotline: v }))} placeholder="1900 xxxx" />
            </Field>
            <Field label="Email hỗ trợ">
              <TextInput value={brandingData.support_email || ''} onChange={v => setBrandingData(p => ({ ...p, support_email: v }))} placeholder="support@..." type="email" />
            </Field>
          </div>
          <Field label="Website">
            <TextInput value={brandingData.website_url || ''} onChange={v => setBrandingData(p => ({ ...p, website_url: v }))} placeholder="https://..." />
          </Field>
          <Field label="Footer hóa đơn">
            <textarea
              value={brandingData.receipt_footer || ''}
              onChange={e => setBrandingData(p => ({ ...p, receipt_footer: e.target.value }))}
              placeholder="Cảm ơn quý khách đã mua hàng..."
              rows={2}
              style={{
                width: '100%', padding: '10px 14px', fontSize: 14,
                border: '1.5px solid #e5e7eb', borderRadius: 10,
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#2563eb'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
            />
          </Field>

          {/* Preview */}
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 12,
            border: `2px solid ${brandingData.color_primary || '#2563eb'}20`,
            background: `${brandingData.color_primary_light || '#eff6ff'}40`,
          }}>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 8px', textTransform: 'uppercase', fontWeight: 600 }}>Preview sidebar</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {brandingData.logo_url && <img src={brandingData.logo_url} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />}
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: brandingData.color_primary || '#2563eb' }}>
                  {brandingData.store_name || 'Tên cửa hàng'}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>{brandingData.subtitle || 'Hệ Thống Bán Hàng Xe Máy Điện'}</p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditBranding(null)} style={{
              padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e5e7eb',
              background: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer',
            }}>Đóng</button>
            <button onClick={saveBranding} style={{
              padding: '10px 24px', borderRadius: 10, border: 'none',
              background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>💾 Lưu thương hiệu</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
