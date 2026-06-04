import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatCurrency } from '../utils/helpers';
import type { FeeSetting, RegistrationService, VehicleModel, InstallmentProvider } from '../types';
import type { PaymentSettings } from '../types';
import { DEFAULT_PAYMENT_SETTINGS } from '../types';
import { buildSePayQRUrl } from '../types/accounting';
import toast from 'react-hot-toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtInput = (v: number) => v.toLocaleString('vi-VN');
const parseAmt = (s: string) => parseInt(s.replace(/\D/g, '') || '0', 10);

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       '#f8fafc',
  border:   '#e2e8f0',
  card:     '#ffffff',
  primary:  '#2563eb',
  text:     '#111827',
  muted:    '#6b7280',
  danger:   '#dc2626',
  dangerBg: '#fef2f2',
  green:    '#059669',
  greenBg:  '#ecfdf5',
  red:      '#dc2626',
  redBg:    '#fef2f2',
};

// ─── Shared micro-components ─────────────────────────────────────────────────
const Label = ({ children }: { children: React.ReactNode }) => (
  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
    {children}
  </label>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, lineHeight: 1.5 }}>{children}</p>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    style={{
      width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`,
      borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff',
      boxSizing: 'border-box', ...props.style,
    }}
  />
);

const Btn = ({
  variant = 'primary', size = 'md', children, ...rest
}: { variant?: 'primary'|'ghost'|'danger'; size?: 'sm'|'md' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const base: React.CSSProperties = {
    border: 'none', borderRadius: 7, fontWeight: 600, cursor: 'pointer',
    fontSize: size === 'sm' ? 12 : 13,
    padding: size === 'sm' ? '4px 12px' : '7px 16px',
    lineHeight: 1.5,
  };
  const styles = {
    primary: { background: C.primary, color: '#fff' },
    ghost:   { background: '#f1f5f9', color: '#374151' },
    danger:  { background: C.dangerBg, color: C.danger },
  };
  return <button {...rest} style={{ ...base, ...styles[variant], ...rest.style }}>{children}</button>;
};

const StatusBadge = ({ active, onToggle }: { active: boolean; onToggle: () => void }) => (
  <button
    onClick={onToggle}
    style={{
      border: 'none', borderRadius: 999, padding: '3px 10px', fontSize: 11,
      fontWeight: 600, cursor: 'pointer',
      background: active ? C.greenBg : C.redBg,
      color:      active ? C.green   : C.red,
    }}
  >
    {active ? '● Đang dùng' : '○ Tắt'}
  </button>
);

const SectionHeader = ({
  title, action,
}: { title: string; action?: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
    <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h2>
    {action}
  </div>
);

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', ...style }}>
    {children}
  </div>
);

const FormBox = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
    {children}
  </div>
);

// ─── Table shared styles ──────────────────────────────────────────────────────
const TH = ({ children, right, center }: { children?: React.ReactNode; right?: boolean; center?: boolean }) => (
  <th style={{
    padding: '9px 14px', textAlign: right ? 'right' : center ? 'center' : 'left',
    fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
    letterSpacing: '0.05em', background: C.bg, borderBottom: `1px solid ${C.border}`,
  }}>{children}</th>
);
const TD = ({ children, right, center, style }: { children?: React.ReactNode; right?: boolean; center?: boolean; style?: React.CSSProperties }) => (
  <td style={{ padding: '9px 14px', fontSize: 13, textAlign: right ? 'right' : center ? 'center' : 'left', verticalAlign: 'middle', ...style }}>
    {children}
  </td>
);
const EmptyRow = ({ cols, msg = 'Chưa có dữ liệu' }: { cols: number; msg?: string }) => (
  <tr><td colSpan={cols} style={{ textAlign: 'center', padding: 28, color: '#bbb', fontSize: 13 }}>{msg}</td></tr>
);

// ─── Tab nav ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'fees',        icon: '💰', label: 'Phí cố định'       },
  { key: 'services',    icon: '🔧', label: 'Dịch vụ đăng ký'  },
  { key: 'installment', icon: '🏦', label: 'Đơn vị tài chính'  },
  { key: 'payment',     icon: '💳', label: 'Thanh toán & SEPay' },
];

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function SettingsPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('fees');

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: feesData, isLoading: loadingFees } =
    useQuery<{ data: FeeSetting[] }>({
      queryKey: ['fee-settings'],
      queryFn:  () => api.get('/settings/fees?all=true').then(r => r.data),
      staleTime: 30_000,
    });

  const { data: svcData, isLoading: loadingSvc } =
    useQuery<{ data: RegistrationService[] }>({
      queryKey: ['reg-services'],
      queryFn:  () => api.get('/settings/services?all=true').then(r => r.data),
      staleTime: 30_000,
    });

  const { data: payData } = useQuery<PaymentSettings>({
    queryKey: ['payment-settings'],
    queryFn:  () => api.get('/settings/payment').then(r => r.data),
    staleTime: 60_000,
    placeholderData: DEFAULT_PAYMENT_SETTINGS,
  });

  const fees     = feesData?.data ?? [];
  const services = svcData?.data  ?? [];

  // Danh sách mẫu xe để chọn áp dụng phí
  const { data: modelData } = useQuery<{ data: VehicleModel[] }>({
    queryKey: ['vehicle-models-for-fees'],
    queryFn:  () => api.get('/vehicles', { params: { limit: 200, is_active: true } }).then(r => r.data),
    staleTime: 5 * 60_000,
  });
  const dsModel = modelData?.data ?? [];

  // ── Mutations phí ─────────────────────────────────────────────────────────
  const updateFeeMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<FeeSetting> }) =>
      api.put(`/settings/fees/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-settings'] }); toast.success('Đã lưu'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi lưu phí'),
  });
  const createFeeMut = useMutation({
    mutationFn: (body: any) => api.post('/settings/fees', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee-settings'] });
      toast.success('Đã thêm phí');
      setShowAddFee(false); resetFeeForm();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi thêm phí'),
  });
  const deleteFeeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/fees/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-settings'] }); toast.success('Đã xóa'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi xóa'),
  });

  // ── Mutations dịch vụ ─────────────────────────────────────────────────────
  const updateSvcMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<RegistrationService> }) =>
      api.put(`/settings/services/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reg-services'] }); toast.success('Đã lưu'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi lưu dịch vụ'),
  });
  const createSvcMut = useMutation({
    mutationFn: (body: any) => api.post('/settings/services', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reg-services'] });
      toast.success('Đã thêm dịch vụ');
      setShowAddSvc(false); resetSvcForm();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi thêm dịch vụ'),
  });
  const deleteSvcMut = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/services/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reg-services'] }); toast.success('Đã xóa'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi xóa'),
  });

  // ── Đơn vị tài chính ──────────────────────────────────────────────────────
  const { data: ipData, isLoading: loadingIP } =
    useQuery<{ data: InstallmentProvider[] }>({
      queryKey: ['installment-providers'],
      queryFn:  () => api.get('/settings/installment-providers?all=true').then(r => r.data),
      staleTime: 30_000,
    });
  const providers = ipData?.data ?? [];

  const updateIPMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<InstallmentProvider> }) =>
      api.put(`/settings/installment-providers/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['installment-providers'] }); toast.success('Đã lưu'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi lưu'),
  });
  const createIPMut = useMutation({
    mutationFn: (body: any) => api.post('/settings/installment-providers', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installment-providers'] });
      toast.success('Đã thêm đơn vị tài chính');
      setShowAddIP(false); resetIPForm();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi thêm'),
  });
  const deleteIPMut = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/installment-providers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['installment-providers'] }); toast.success('Đã xóa'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi xóa'),
  });

  // Form thêm đơn vị tài chính
  const KY_HAN_OPTIONS = [6, 12, 15, 18, 24, 36, 48];
  const [showAddIP,    setShowAddIP]    = useState(false);
  const [newIPName,    setNewIPName]    = useState('');
  const [newIPRate,    setNewIPRate]    = useState('');
  const [newIPMonths,  setNewIPMonths]  = useState<number[]>([6, 12, 24, 36]);
  const [newIPDef,     setNewIPDef]     = useState(12);
  const [newIPMinDown, setNewIPMinDown] = useState('');
  const [newIPCustom,  setNewIPCustom]  = useState('');
  const resetIPForm = () => {
    setNewIPName(''); setNewIPRate('');
    setNewIPMonths([6, 12, 24, 36]); setNewIPDef(12); setNewIPMinDown('');
    setNewIPCustom('');
  };
  const toggleNewIPMonth = (m: number) =>
    setNewIPMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort((a, b) => a - b));
  const addNewIPCustomMonth = () => {
    const n = parseInt(newIPCustom, 10);
    if (!Number.isFinite(n) || n < 1 || n > 120) return toast.error('Nhập số tháng từ 1 đến 120');
    if (newIPMonths.includes(n))                 return toast.error(`${n} tháng đã có trong danh sách`);
    setNewIPMonths(prev => [...prev, n].sort((a, b) => a - b));
    setNewIPCustom('');
  };

  // Inline-edit đơn vị tài chính
  const [editIPId,      setEditIPId]      = useState<string | null>(null);
  const [editIPName,    setEditIPName]    = useState('');
  const [editIPRate,    setEditIPRate]    = useState('');
  const [editIPMonths,  setEditIPMonths]  = useState<number[]>([]);
  const [editIPMinDown, setEditIPMinDown] = useState('');
  const [editIPCustom,  setEditIPCustom]  = useState('');

  const startEditIP = (p: InstallmentProvider) => {
    setEditIPId(p.id);
    setEditIPName(p.name);
    setEditIPRate(String(p.interest_rate_per_month));
    setEditIPMonths(p.available_months ?? []);
    setEditIPMinDown(String(p.min_down_payment_percent));
    setEditIPCustom('');
  };
  const toggleEditIPMonth = (m: number) =>
    setEditIPMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort((a, b) => a - b));
  const addEditIPCustomMonth = () => {
    const n = parseInt(editIPCustom, 10);
    if (!Number.isFinite(n) || n < 1 || n > 120) return toast.error('Nhập số tháng từ 1 đến 120');
    if (editIPMonths.includes(n))                 return toast.error(`${n} tháng đã có trong danh sách`);
    setEditIPMonths(prev => [...prev, n].sort((a, b) => a - b));
    setEditIPCustom('');
  };
  const saveEditIP = (id: string) => {
    updateIPMut.mutate({ id, body: {
      name: editIPName,
      interest_rate_per_month: Number(editIPRate) || 0,
      available_months: editIPMonths,
      min_down_payment_percent: Number(editIPMinDown) || 0,
    } });
    setEditIPId(null);
  };

  // ── Inline-edit phí ───────────────────────────────────────────────────────
  const [editFeeId,    setEditFeeId]     = useState<string | null>(null);
  const [editFeeLbl,   setEditFeeLbl]    = useState('');
  const [editFeeVal,   setEditFeeVal]    = useState('');
  const [editFeeNote,  setEditFeeNote]   = useState('');
  const [editFeeModel, setEditFeeModel]  = useState('');

  const startEditFee = (f: FeeSetting) => {
    setEditFeeId(f.id);
    setEditFeeLbl(f.label);
    setEditFeeVal(f.amount.toLocaleString('vi-VN'));
    setEditFeeNote(f.note ?? '');
    setEditFeeModel(f.model_id ?? '');
  };
  const saveEditFee = (id: string) => {
    updateFeeMut.mutate({ id, body: {
      label: editFeeLbl,
      amount: parseAmt(editFeeVal),
      note: editFeeNote,
      model_id: editFeeModel || null,
    } as any });
    setEditFeeId(null);
  };

  // ── Inline-edit dịch vụ ───────────────────────────────────────────────────
  const [editSvcId,    setEditSvcId]    = useState<string | null>(null);
  const [editSvcName,  setEditSvcName]  = useState('');
  const [editSvcDesc,  setEditSvcDesc]  = useState('');
  const [editSvcPrice, setEditSvcPrice] = useState('');

  const startEditSvc = (s: RegistrationService) => {
    setEditSvcId(s.id);
    setEditSvcName(s.name);
    setEditSvcDesc(s.description ?? '');
    setEditSvcPrice(s.price.toLocaleString('vi-VN'));
  };
  const saveEditSvc = (id: string) => {
    updateSvcMut.mutate({ id, body: { name: editSvcName, description: editSvcDesc, price: parseAmt(editSvcPrice) } });
    setEditSvcId(null);
  };

  // ── Form thêm phí ─────────────────────────────────────────────────────────
  const [showAddFee,    setShowAddFee]    = useState(false);
  const [newFeeKey,     setNewFeeKey]     = useState('');
  const [newFeeLbl,     setNewFeeLbl]     = useState('');
  const [newFeeAmt,     setNewFeeAmt]     = useState('');
  const [newFeeNote,    setNewFeeNote]    = useState('');
  const [newFeeModel,   setNewFeeModel]   = useState('');
  const resetFeeForm = () => {
    setNewFeeKey(''); setNewFeeLbl(''); setNewFeeAmt('');
    setNewFeeNote(''); setNewFeeModel('');
  };

  // ── Form thêm dịch vụ ─────────────────────────────────────────────────────
  const [showAddSvc, setShowAddSvc] = useState(false);
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcDesc, setNewSvcDesc] = useState('');
  const [newSvcPrice,setNewSvcPrice]= useState('');
  const resetSvcForm = () => { setNewSvcName(''); setNewSvcDesc(''); setNewSvcPrice(''); };

  // ── Payment form state ────────────────────────────────────────────────────
  const [payForm, setPayForm] = useState<PaymentSettings | null>(null);
  const ps = payForm ?? payData ?? DEFAULT_PAYMENT_SETTINGS;
  const setPs = (k: keyof PaymentSettings, v: string) =>
    setPayForm(prev => ({ ...(prev ?? ps), [k]: v }));

  const savePayMut = useMutation({
    mutationFn: (body: Partial<PaymentSettings>) => api.put('/settings/payment', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-settings'] });
      setPayForm(null);
      toast.success('Đã lưu cấu hình thanh toán');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi lưu cấu hình'),
  });

  const previewQr = (ps.bank_code && ps.bank_account)
    ? buildSePayQRUrl({ bank: ps.bank_code, account_number: ps.bank_account, amount: 100000, description: 'TEST', template: 'compact2' })
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${C.border}`, padding: '18px 28px' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>⚙️ Cấu hình hệ thống</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: '3px 0 0' }}>Quản lý phí, dịch vụ và tích hợp thanh toán</p>
      </div>

      <div style={{ display: 'flex', maxWidth: 1050, margin: '0 auto', padding: '24px 20px', gap: 22, alignItems: 'flex-start' }}>

        {/* ── Tab sidebar ─────────────────────────────────────────────── */}
        <nav style={{ width: 200, flexShrink: 0, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 16px', border: 'none', cursor: 'pointer', textAlign: 'left',
                fontSize: 13, fontWeight: activeTab === t.key ? 700 : 400,
                background: activeTab === t.key ? '#eff6ff' : 'transparent',
                color:      activeTab === t.key ? C.primary : C.text,
                borderLeft: activeTab === t.key ? `3px solid ${C.primary}` : '3px solid transparent',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* ── Tab content ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ══ TAB: PHÍ CỐ ĐỊNH ══════════════════════════════════════ */}
          {activeTab === 'fees' && (
            <div>
              <SectionHeader
                title="💰 Phí cố định"
                action={
                  <Btn size="sm" onClick={() => setShowAddFee(v => !v)}>
                    {showAddFee ? '✕ Đóng' : '+ Thêm phí'}
                  </Btn>
                }
              />

              {showAddFee && (
                <FormBox>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <Label>Key nội bộ</Label>
                      <Input placeholder="vd: phi_bien_so_2" value={newFeeKey} onChange={e => setNewFeeKey(e.target.value)} />
                    </div>
                    <div>
                      <Label>Tên hiển thị</Label>
                      <Input placeholder="vd: Phí trước bạ Klara S" value={newFeeLbl} onChange={e => setNewFeeLbl(e.target.value)} />
                    </div>
                    <div>
                      <Label>Số tiền (₫)</Label>
                      <Input placeholder="0" value={newFeeAmt}
                        onChange={e => setNewFeeAmt(fmtInput(parseAmt(e.target.value)))} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <Label>Áp dụng cho mẫu xe</Label>
                      <select
                        value={newFeeModel}
                        onChange={e => setNewFeeModel(e.target.value)}
                        style={{
                          width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`,
                          borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff',
                        }}
                      >
                        <option value="">— Tất cả mẫu xe (phí chung) —</option>
                        {dsModel.map(m => (
                          <option key={m.id} value={m.id}>{m.brand} {m.model_name}</option>
                        ))}
                      </select>
                      <Hint>Để trống → áp dụng tất cả. Chọn mẫu xe → chỉ áp dụng cho dòng xe đó (vd phí trước bạ).</Hint>
                    </div>
                    <div>
                      <Label>Ghi chú</Label>
                      <Input placeholder="Ghi chú thêm..." value={newFeeNote} onChange={e => setNewFeeNote(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" onClick={() => {
                      if (!newFeeKey || !newFeeLbl) return toast.error('Nhập key và tên');
                      createFeeMut.mutate({
                        key: newFeeKey, label: newFeeLbl,
                        amount: parseAmt(newFeeAmt),
                        note: newFeeNote,
                        model_id: newFeeModel || null,
                      });
                    }} disabled={createFeeMut.isPending}>Lưu</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setShowAddFee(false); resetFeeForm(); }}>Hủy</Btn>
                  </div>
                </FormBox>
              )}

              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Tên phí</TH>
                      <TH right>Số tiền</TH>
                      <TH>Áp dụng</TH>
                      <TH>Ghi chú</TH>
                      <TH center>Trạng thái</TH>
                      <TH center>Thao tác</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingFees ? (
                      <EmptyRow cols={6} msg="Đang tải..." />
                    ) : fees.length === 0 ? (
                      <EmptyRow cols={6} msg="Chưa có phí nào" />
                    ) : fees.map((f, i) => (
                      <tr key={f.id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : undefined }}>
                        {editFeeId === f.id ? (
                          <>
                            <TD>
                              <Input value={editFeeLbl} onChange={e => setEditFeeLbl(e.target.value)}
                                style={{ marginBottom: 5 }} placeholder="Tên phí" />
                              <Input value={editFeeNote} onChange={e => setEditFeeNote(e.target.value)}
                                placeholder="Ghi chú" />
                            </TD>
                            <TD right>
                              <Input value={editFeeVal} style={{ textAlign: 'right' }}
                                onChange={e => setEditFeeVal(fmtInput(parseAmt(e.target.value)))} />
                            </TD>
                            <TD>
                              <select
                                value={editFeeModel}
                                onChange={e => setEditFeeModel(e.target.value)}
                                style={{
                                  width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`,
                                  borderRadius: 7, fontSize: 12, outline: 'none', background: '#fff',
                                }}
                              >
                                <option value="">Tất cả mẫu xe</option>
                                {dsModel.map(m => (
                                  <option key={m.id} value={m.id}>{m.brand} {m.model_name}</option>
                                ))}
                              </select>
                            </TD>
                            <TD />
                            <TD center>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Btn size="sm" onClick={() => saveEditFee(f.id)}>Lưu</Btn>
                                <Btn size="sm" variant="ghost" onClick={() => setEditFeeId(null)}>Hủy</Btn>
                              </div>
                            </TD>
                          </>
                        ) : (
                          <>
                            <TD>
                              <div style={{ fontWeight: 600, color: C.text }}>{f.label}</div>
                              <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace', marginTop: 1 }}>{f.key}</div>
                            </TD>
                            <TD right style={{ fontWeight: 700, color: C.primary }}>{formatCurrency(f.amount)}</TD>
                            <TD>
                              {f.model_id ? (
                                <span style={{
                                  background: '#eff6ff', color: C.primary,
                                  padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                                }}>
                                  🛵 {f.vehicle_models?.brand} {f.vehicle_models?.model_name}
                                </span>
                              ) : (
                                <span style={{
                                  background: '#f0fdf4', color: '#15803d',
                                  padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                                }}>
                                  🌐 Tất cả mẫu xe
                                </span>
                              )}
                            </TD>
                            <TD style={{ color: C.muted }}>{f.note || '—'}</TD>
                            <TD center>
                              <StatusBadge active={f.is_active}
                                onToggle={() => updateFeeMut.mutate({ id: f.id, body: { is_active: !f.is_active } })} />
                            </TD>
                            <TD center>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Btn size="sm" variant="ghost" onClick={() => startEditFee(f)}>Sửa</Btn>
                                <Btn size="sm" variant="danger"
                                  onClick={() => { if (confirm(`Xóa "${f.label}"?`)) deleteFeeMut.mutate(f.id); }}>Xóa</Btn>
                              </div>
                            </TD>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                Phí "Tất cả mẫu xe" áp dụng cho mọi đơn. Phí gắn mẫu xe cụ thể chỉ tính khi POS chọn đúng dòng xe đó (vd phí trước bạ riêng từng dòng).
              </p>
            </div>
          )}

          {/* ══ TAB: DỊCH VỤ ═════════════════════════════════════════ */}
          {activeTab === 'services' && (
            <div>
              <SectionHeader
                title="🔧 Dịch vụ đăng ký xe"
                action={
                  <Btn size="sm" onClick={() => setShowAddSvc(v => !v)}>
                    {showAddSvc ? '✕ Đóng' : '+ Thêm dịch vụ'}
                  </Btn>
                }
              />

              {showAddSvc && (
                <FormBox>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <Label>Tên dịch vụ</Label>
                      <Input placeholder="vd: Đăng ký biển số tỉnh" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
                    </div>
                    <div>
                      <Label>Giá dịch vụ (₫)</Label>
                      <Input placeholder="0" value={newSvcPrice}
                        onChange={e => setNewSvcPrice(fmtInput(parseAmt(e.target.value)))} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <Label>Mô tả ngắn</Label>
                    <Input placeholder="Mô tả ngắn về dịch vụ..." value={newSvcDesc} onChange={e => setNewSvcDesc(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" onClick={() => {
                      if (!newSvcName) return toast.error('Nhập tên dịch vụ');
                      createSvcMut.mutate({ name: newSvcName, description: newSvcDesc, price: parseAmt(newSvcPrice) });
                    }} disabled={createSvcMut.isPending}>Lưu</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setShowAddSvc(false); resetSvcForm(); }}>Hủy</Btn>
                  </div>
                </FormBox>
              )}

              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Tên dịch vụ</TH>
                      <TH right>Giá</TH>
                      <TH center>Trạng thái</TH>
                      <TH center>Thao tác</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingSvc ? (
                      <EmptyRow cols={4} msg="Đang tải..." />
                    ) : services.length === 0 ? (
                      <EmptyRow cols={4} msg="Chưa có dịch vụ nào" />
                    ) : services.map((s, i) => (
                      <tr key={s.id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : undefined }}>
                        {editSvcId === s.id ? (
                          <>
                            <TD>
                              <Input value={editSvcName} onChange={e => setEditSvcName(e.target.value)}
                                style={{ marginBottom: 5 }} placeholder="Tên dịch vụ" />
                              <Input value={editSvcDesc} onChange={e => setEditSvcDesc(e.target.value)}
                                placeholder="Mô tả" />
                            </TD>
                            <TD right>
                              <Input value={editSvcPrice} style={{ textAlign: 'right' }}
                                onChange={e => setEditSvcPrice(fmtInput(parseAmt(e.target.value)))} />
                            </TD>
                            <TD />
                            <TD center>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Btn size="sm" onClick={() => saveEditSvc(s.id)}>Lưu</Btn>
                                <Btn size="sm" variant="ghost" onClick={() => setEditSvcId(null)}>Hủy</Btn>
                              </div>
                            </TD>
                          </>
                        ) : (
                          <>
                            <TD>
                              <div style={{ fontWeight: 600, color: C.text }}>{s.name}</div>
                              {s.description && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{s.description}</div>}
                            </TD>
                            <TD right style={{ fontWeight: 700, color: C.primary }}>{formatCurrency(s.price)}</TD>
                            <TD center>
                              <StatusBadge active={s.is_active}
                                onToggle={() => updateSvcMut.mutate({ id: s.id, body: { is_active: !s.is_active } })} />
                            </TD>
                            <TD center>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Btn size="sm" variant="ghost" onClick={() => startEditSvc(s)}>Sửa</Btn>
                                <Btn size="sm" variant="danger"
                                  onClick={() => { if (confirm(`Xóa "${s.name}"?`)) deleteSvcMut.mutate(s.id); }}>Xóa</Btn>
                              </div>
                            </TD>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                Dịch vụ "Đang dùng" hiện trong POS để nhân viên tích chọn khi tạo đơn.
              </p>
            </div>
          )}

          {/* ══ TAB: ĐƠN VỊ TÀI CHÍNH ════════════════════════════════ */}
          {activeTab === 'installment' && (
            <div>
              <SectionHeader
                title="🏦 Đơn vị tài chính (trả góp)"
                action={
                  <Btn size="sm" onClick={() => setShowAddIP(v => !v)}>
                    {showAddIP ? '✕ Đóng' : '+ Thêm đơn vị'}
                  </Btn>
                }
              />

              {showAddIP && (
                <FormBox>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <Label>Tên đơn vị tài chính</Label>
                      <Input placeholder="vd: FE Credit, HD SAISON..." value={newIPName} onChange={e => setNewIPName(e.target.value)} />
                    </div>
                    <div>
                      <Label>Lãi suất (%/tháng)</Label>
                      <Input placeholder="1.5" type="number" step="0.01" value={newIPRate}
                        onChange={e => setNewIPRate(e.target.value)} />
                    </div>
                    <div>
                      <Label>Đưa trước tối thiểu (%)</Label>
                      <Input placeholder="30" type="number" step="1" value={newIPMinDown}
                        onChange={e => setNewIPMinDown(e.target.value)} />
                    </div>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <Label>Các kỳ hạn cho phép</Label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {Array.from(new Set([...KY_HAN_OPTIONS, ...newIPMonths])).sort((a, b) => a - b).map(m => {
                        const on = newIPMonths.includes(m);
                        return (
                          <button
                            key={m} type="button"
                            onClick={() => toggleNewIPMonth(m)}
                            style={{
                              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                              cursor: 'pointer',
                              border: `1.5px solid ${on ? C.primary : C.border}`,
                              background: on ? '#eff6ff' : '#fff',
                              color: on ? C.primary : C.muted,
                            }}
                          >
                            {m} tháng
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                      <Input
                        type="number"
                        min={1}
                        max={120}
                        placeholder="Số tháng tuỳ ý"
                        value={newIPCustom}
                        onChange={e => setNewIPCustom(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewIPCustomMonth(); } }}
                        style={{ width: 160 }}
                      />
                      <Btn size="sm" variant="ghost" onClick={addNewIPCustomMonth}>+ Thêm</Btn>
                    </div>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <Label>Kỳ hạn mặc định</Label>
                    <select
                      value={newIPDef}
                      onChange={e => setNewIPDef(+e.target.value)}
                      style={{
                        width: 200, padding: '7px 10px', border: `1px solid ${C.border}`,
                        borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff',
                      }}
                    >
                      {newIPMonths.map(m => <option key={m} value={m}>{m} tháng</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" onClick={() => {
                      if (!newIPName.trim()) return toast.error('Nhập tên đơn vị');
                      if (newIPMonths.length === 0) return toast.error('Chọn ít nhất 1 kỳ hạn');
                      createIPMut.mutate({
                        name: newIPName.trim(),
                        interest_rate_per_month: Number(newIPRate) || 0,
                        available_months: newIPMonths,
                        default_months: newIPMonths.includes(newIPDef) ? newIPDef : newIPMonths[0],
                        min_down_payment_percent: Number(newIPMinDown) || 0,
                      });
                    }} disabled={createIPMut.isPending}>Lưu</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setShowAddIP(false); resetIPForm(); }}>Hủy</Btn>
                  </div>
                </FormBox>
              )}

              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Đơn vị</TH>
                      <TH right>Lãi suất /tháng</TH>
                      <TH>Kỳ hạn</TH>
                      <TH right>Đưa trước tối thiểu</TH>
                      <TH center>Trạng thái</TH>
                      <TH center>Thao tác</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingIP ? (
                      <EmptyRow cols={6} msg="Đang tải..." />
                    ) : providers.length === 0 ? (
                      <EmptyRow cols={6} msg="Chưa có đơn vị tài chính nào" />
                    ) : providers.map((p, i) => (
                      <tr key={p.id} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : undefined }}>
                        {editIPId === p.id ? (
                          <>
                            <TD><Input value={editIPName} onChange={e => setEditIPName(e.target.value)} /></TD>
                            <TD right>
                              <Input style={{ textAlign: 'right' }} type="number" step="0.01"
                                value={editIPRate} onChange={e => setEditIPRate(e.target.value)} />
                            </TD>
                            <TD>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {Array.from(new Set([...KY_HAN_OPTIONS, ...editIPMonths])).sort((a, b) => a - b).map(m => {
                                  const on = editIPMonths.includes(m);
                                  return (
                                    <button
                                      key={m} type="button" onClick={() => toggleEditIPMonth(m)}
                                      style={{
                                        padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                                        cursor: 'pointer',
                                        border: `1px solid ${on ? C.primary : C.border}`,
                                        background: on ? '#eff6ff' : '#fff',
                                        color: on ? C.primary : C.muted,
                                      }}
                                    >{m}t</button>
                                  );
                                })}
                              </div>
                              <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
                                <Input
                                  type="number"
                                  min={1}
                                  max={120}
                                  placeholder="Tự nhập"
                                  value={editIPCustom}
                                  onChange={e => setEditIPCustom(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEditIPCustomMonth(); } }}
                                  style={{ width: 90, padding: '4px 6px', fontSize: 11 }}
                                />
                                <Btn size="sm" variant="ghost" onClick={addEditIPCustomMonth}>+</Btn>
                              </div>
                            </TD>
                            <TD right>
                              <Input style={{ textAlign: 'right' }} type="number"
                                value={editIPMinDown} onChange={e => setEditIPMinDown(e.target.value)} />
                            </TD>
                            <TD />
                            <TD center>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Btn size="sm" onClick={() => saveEditIP(p.id)}>Lưu</Btn>
                                <Btn size="sm" variant="ghost" onClick={() => setEditIPId(null)}>Hủy</Btn>
                              </div>
                            </TD>
                          </>
                        ) : (
                          <>
                            <TD>
                              <div style={{ fontWeight: 600, color: C.text }}>{p.name}</div>
                              {p.note && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{p.note}</div>}
                            </TD>
                            <TD right style={{ fontWeight: 700, color: C.primary }}>{p.interest_rate_per_month}%</TD>
                            <TD>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {(p.available_months ?? []).map(m => (
                                  <span key={m} style={{
                                    background: '#f1f5f9', color: C.text,
                                    padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                                  }}>{m}t</span>
                                ))}
                              </div>
                            </TD>
                            <TD right>{p.min_down_payment_percent}%</TD>
                            <TD center>
                              <StatusBadge active={p.is_active}
                                onToggle={() => updateIPMut.mutate({ id: p.id, body: { is_active: !p.is_active } })} />
                            </TD>
                            <TD center>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <Btn size="sm" variant="ghost" onClick={() => startEditIP(p)}>Sửa</Btn>
                                <Btn size="sm" variant="danger"
                                  onClick={() => { if (confirm(`Xóa "${p.name}"?`)) deleteIPMut.mutate(p.id); }}>Xóa</Btn>
                              </div>
                            </TD>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                Sale ở POS chỉ chọn đơn vị + kỳ hạn → lãi suất tự fill từ cấu hình ở đây.
              </p>
            </div>
          )}

          {/* ══ TAB: THANH TOÁN ══════════════════════════════════════ */}
          {activeTab === 'payment' && (
            <div>
              <SectionHeader title="💳 Thanh toán & SEPay" />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 190px', gap: 20, alignItems: 'start' }}>

                {/* Form cấu hình */}
                <Card style={{ overflow: 'visible' }}>
                  <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                      Thông tin ngân hàng
                    </p>
                  </div>
                  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label>Mã ngân hàng SEPay <span style={{ color: '#ef4444' }}>*</span></Label>
                        <Input placeholder="TCB / VCB / MB / ACB..."
                          value={ps.bank_code}
                          onChange={e => setPs('bank_code', e.target.value.toUpperCase())} />
                        <Hint>Tra mã tại <a href="https://qr.sepay.vn/banks.json" target="_blank" rel="noreferrer" style={{ color: C.primary }}>qr.sepay.vn/banks.json</a></Hint>
                      </div>
                      <div>
                        <Label>Tên ngân hàng</Label>
                        <Input placeholder="Techcombank"
                          value={ps.bank_name}
                          onChange={e => setPs('bank_name', e.target.value)} />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label>Số tài khoản <span style={{ color: '#ef4444' }}>*</span></Label>
                        <Input placeholder="0123456789"
                          value={ps.bank_account}
                          onChange={e => setPs('bank_account', e.target.value)} />
                      </div>
                      <div>
                        <Label>Tên chủ tài khoản</Label>
                        <Input placeholder="NGUYEN VAN A"
                          value={ps.bank_account_name}
                          onChange={e => setPs('bank_account_name', e.target.value.toUpperCase())} />
                      </div>
                    </div>

                    <div style={{ background: C.bg, borderRadius: 8, padding: '10px 14px', border: `1px solid ${C.border}` }}>
                      <Label>API Key SEPay</Label>
                      <Input type="password" placeholder="••••••••••••••••"
                        value={ps.sepay_api_key}
                        onChange={e => setPs('sepay_api_key', e.target.value)} />
                      <Hint>Dùng để xác thực webhook — chỉ admin thay đổi được.</Hint>
                    </div>

                    <div>
                      <Label>Ngưỡng cảnh báo tồn quỹ tiền mặt (₫)</Label>
                      <Input placeholder="50000000"
                        value={ps.max_cash_allowed}
                        onChange={e => setPs('max_cash_allowed', e.target.value.replace(/\D/g, ''))} />
                      <Hint>Vượt mức này sẽ hiện cảnh báo đỏ trên màn hình thu ngân.</Hint>
                    </div>

                    {/* ── Tích điểm khách hàng ───────────────────── */}
                    <div style={{
                      background: '#fef3c7', border: '1px solid #fcd34d',
                      borderRadius: 8, padding: '12px 14px',
                    }}>
                      <Label>🏆 Tích điểm khách hàng</Label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <input
                          type="checkbox"
                          id="loyalty_enabled"
                          checked={ps.loyalty_enabled !== 'false'}
                          onChange={e => setPs('loyalty_enabled', e.target.checked ? 'true' : 'false')}
                        />
                        <label htmlFor="loyalty_enabled" style={{ fontSize: 13, color: '#92400e', cursor: 'pointer' }}>
                          Bật tích điểm khi KH chi tiêu (đơn hàng + phiếu DV)
                        </label>
                      </div>
                      <Label>Số tiền (₫) ứng với 1 điểm</Label>
                      <Input
                        placeholder="10000"
                        value={ps.loyalty_amount_per_point}
                        onChange={e => setPs('loyalty_amount_per_point', e.target.value.replace(/\D/g, ''))}
                      />
                      <Hint>
                        Mặc định 10.000đ = 1 điểm. Vd: KH chi 500.000đ → +50 điểm.
                        {' '}Đặt 1.000 để tỷ lệ 1k = 1 điểm.
                      </Hint>
                    </div>

                    <div>
                      <Btn onClick={() => savePayMut.mutate(ps)} disabled={savePayMut.isPending}>
                        {savePayMut.isPending ? 'Đang lưu...' : '💾 Lưu cấu hình'}
                      </Btn>
                    </div>
                  </div>
                </Card>

                {/* QR preview */}
                <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, textAlign: 'center' }}>
                  <p style={{ fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Preview QR
                  </p>
                  <div style={{
                    border: `2px dashed ${C.border}`, borderRadius: 10, padding: 10,
                    background: C.bg, minHeight: 160,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {previewQr ? (
                      <img src={previewQr} alt="QR preview" width={150} height={150} style={{ borderRadius: 6 }} />
                    ) : (
                      <p style={{ fontSize: 11, color: '#d1d5db', margin: 0, lineHeight: 1.8 }}>
                        Điền mã ngân hàng<br />và số tài khoản<br />để xem preview
                      </p>
                    )}
                  </div>
                  {ps.bank_name && ps.bank_account && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted, lineHeight: 1.8 }}>
                      <div style={{ fontWeight: 700, color: C.text }}>{ps.bank_name}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{ps.bank_account}</div>
                      {ps.bank_account_name && <div>{ps.bank_account_name}</div>}
                      <div style={{ marginTop: 4, color: '#9ca3af' }}>100,000 ₫ · TEST</div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
