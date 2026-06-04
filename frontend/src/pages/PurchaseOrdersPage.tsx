import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { VehicleModel, SparePart, Accessory } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Supplier {
  id: string;
  supplier_code: string;
  supplier_name: string;
  phone?: string;
  email?: string;
  payment_terms: number;
}

type ItemType = 'vehicle' | 'spare_part' | 'accessory';

interface POItemForm {
  // Xe
  vehicle_model_id?: string;
  color?: string;
  year_manufacture?: number;
  // Phụ tùng
  spare_part_id?: string;
  // Phụ kiện
  accessory_id?: string;
  // Tên hiển thị dự phòng (tự điền khi chọn)
  item_name?: string;
  // Chung
  qty_ordered: number;
  unit_cost: number;
  vat_rate: number;
  notes?: string;
}

interface POItem {
  id?: string;
  po_id?: string;
  item_type: ItemType;
  qty_ordered: number;
  qty_received?: number;
  qty_pending?: number;
  unit_cost: number;
  vat_rate?: number;
  line_total?: number;
  line_total_with_vat?: number;
  color?: string;
  year_manufacture?: number;
  notes?: string;
  vehicle_models?: Pick<VehicleModel, 'id' | 'brand' | 'model_name'>;
  spare_parts?: Pick<SparePart, 'id' | 'code' | 'name' | 'unit'>;
  accessories?: Pick<Accessory, 'id' | 'code' | 'name'>;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  item_type: ItemType;
  order_date: string;
  expected_date?: string;
  actual_date?: string;
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_due_date?: string;
  notes?: string;
  cancel_reason?: string;
  acc_suppliers?: { id: string; supplier_code: string; supplier_name: string; phone?: string };
}

interface VehicleEntry {
  po_item_id: string;
  vin: string;
  engine_number: string;
  color: string;
  year_manufacture: number;
  condition: 'ok' | 'defect' | 'rejected';
}

interface PartEntry {
  po_item_id: string;
  qty_received: number;
  condition: 'ok' | 'defect' | 'rejected';
  item_label: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtSo   = (n: number) => (n ?? 0).toLocaleString('vi-VN');
const fmtNgay = (s?: string) => s ? new Date(s).toLocaleDateString('vi-VN') : '—';
const namHT   = new Date().getFullYear();

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  vehicle:    '🚗 Xe',
  spare_part: '🔧 Phụ tùng',
  accessory:  '🎒 Phụ kiện',
};

const TRANG_THAI: Record<string, { nhan: string; mau: string }> = {
  draft:            { nhan: 'Nháp',              mau: '#9ca3af' },
  submitted:        { nhan: 'Đã gửi NCC',        mau: '#2563eb' },
  approved:         { nhan: 'Đã duyệt',          mau: '#7c3aed' },
  partial_received: { nhan: 'Nhận 1 phần',       mau: '#d97706' },
  fully_received:   { nhan: 'Đã nhận đủ',        mau: '#059669' },
  invoiced:         { nhan: 'Có hóa đơn',        mau: '#0284c7' },
  paid:             { nhan: 'Đã thanh toán',     mau: '#16a34a' },
  rejected:         { nhan: 'Từ chối',           mau: '#dc2626' },
  cancelled:        { nhan: 'Đã hủy',            mau: '#6b7280' },
};

function BadgeTT({ status }: { status: string }) {
  const info = TRANG_THAI[status] ?? { nhan: status, mau: '#6b7280' };
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
      background: info.mau + '20', color: info.mau, border: `1px solid ${info.mau}44`,
    }}>
      {info.nhan}
    </span>
  );
}

function BadgeLoai({ type }: { type: ItemType }) {
  const colors: Record<ItemType, string> = {
    vehicle: '#1e40af', spare_part: '#065f46', accessory: '#7c2d12',
  };
  const c = colors[type] ?? '#6b7280';
  return (
    <span style={{
      padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: c + '15', color: c, border: `1px solid ${c}33`,
    }}>
      {ITEM_TYPE_LABEL[type] ?? type}
    </span>
  );
}

// ─── Tên hàng hóa theo loại ───────────────────────────────────────────────────
function tenHang(it: POItem): string {
  if (it.item_type === 'vehicle' && it.vehicle_models) {
    const m = it.vehicle_models;
    return `${m.brand} ${m.model_name}${it.color ? ` (${it.color})` : ''}`;
  }
  if (it.item_type === 'spare_part' && it.spare_parts) {
    return `[${it.spare_parts.code}] ${it.spare_parts.name}`;
  }
  if (it.item_type === 'accessory' && it.accessories) {
    return `[${it.accessories.code}] ${it.accessories.name}`;
  }
  return '—';
}

// ─── Dòng item trong form tạo đơn xe ────────────────────────────────────────
function DongXe({ item, index, models, onChange, onRemove }: {
  item: POItemForm; index: number; models: VehicleModel[];
  onChange: (i: number, f: keyof POItemForm, v: unknown) => void;
  onRemove: (i: number) => void;
}) {
  const [maSP, setMaSP] = useState('');
  const [dangTraCuu, setDangTraCuu] = useState(false);

  // Tra cứu mã sản phẩm → tự fill mẫu xe + màu + giá
  const traCuuMaSP = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setDangTraCuu(true);
    try {
      const res = await api.get('/vehicles/by-product-code', { params: { code: trimmed } });
      const { vehicle_model_id, vehicle_model, color_name } = res.data;
      onChange(index, 'vehicle_model_id', vehicle_model_id);
      onChange(index, 'color', color_name);
      if (vehicle_model) {
        onChange(index, 'item_name', `${vehicle_model.brand} ${vehicle_model.model_name}`);
        if (vehicle_model.price_cost) onChange(index, 'unit_cost', vehicle_model.price_cost);
      }
      toast.success(`✓ ${vehicle_model?.brand} ${vehicle_model?.model_name} — ${color_name}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Không tìm thấy mã sản phẩm');
    } finally {
      setDangTraCuu(false);
    }
  };

  return (
    <tr>
      <td>
        <input
          className="input"
          style={{ fontSize: 12, padding: '4px 8px', width: 150, fontFamily: 'monospace' }}
          placeholder="VD: ESMD7LHHREQ"
          value={maSP}
          disabled={dangTraCuu}
          onChange={e => setMaSP(e.target.value.toUpperCase())}
          onBlur={e => { if (e.target.value.trim()) traCuuMaSP(e.target.value); }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              traCuuMaSP(maSP);
            }
          }}
          title="Gõ/dán mã rồi Enter (hoặc rời ô) để tự fill mẫu xe + màu"
        />
      </td>
      <td>
        <select className="input" style={{ fontSize: 13, padding: '4px 8px' }}
          value={item.vehicle_model_id ?? ''} required
          onChange={e => {
            const m = models.find(x => x.id === e.target.value);
            onChange(index, 'vehicle_model_id', e.target.value);
            if (m) {
              onChange(index, 'item_name', `${m.brand} ${m.model_name}`);
              onChange(index, 'unit_cost', m.price_cost ?? 0);
            }
          }}
        >
          <option value="">— Chọn mẫu xe —</option>
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.brand} {m.model_name}</option>
          ))}
        </select>
      </td>
      <td>
        <input className="input" style={{ fontSize: 13, padding: '4px 8px', width: 110 }}
          placeholder="Màu" value={item.color ?? ''}
          onChange={e => onChange(index, 'color', e.target.value)}
        />
      </td>
      <td>
        <input className="input" type="number" style={{ fontSize: 13, padding: '4px 8px', width: 55 }}
          min={1} value={item.qty_ordered}
          onChange={e => onChange(index, 'qty_ordered', +e.target.value)}
        />
      </td>
      <td>
        <input className="input" type="number" style={{ fontSize: 13, padding: '4px 8px', width: 130 }}
          min={0} step={1000000} value={item.unit_cost}
          placeholder="Giá chưa VAT/xe"
          onChange={e => onChange(index, 'unit_cost', +e.target.value)}
        />
      </td>
      <td>
        <select className="input" style={{ fontSize: 13, padding: '4px 8px', width: 70 }}
          value={item.vat_rate}
          onChange={e => onChange(index, 'vat_rate', +e.target.value)}
        >
          <option value={0}>0%</option>
          <option value={8}>8%</option>
          <option value={10}>10%</option>
        </select>
      </td>
      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 13 }}>
        {fmtSo(Math.round(item.qty_ordered * item.unit_cost * (1 + item.vat_rate / 100)))}₫
      </td>
      <td>
        <button type="button" onClick={() => onRemove(index)}
          style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </td>
    </tr>
  );
}

// ─── Dòng item phụ tùng / phụ kiện ──────────────────────────────────────────
function DongPhanTu({ item, index, options, label, onChange, onRemove }: {
  item: POItemForm; index: number;
  options: { id: string; code: string; name: string; unit?: string; price_cost?: number; price?: number }[];
  label: string;
  onChange: (i: number, f: keyof POItemForm, v: unknown) => void;
  onRemove: (i: number) => void;
}) {
  const idField = label === 'phụ tùng' ? 'spare_part_id' : 'accessory_id';
  const currentId = (item as any)[idField] ?? '';

  return (
    <tr>
      <td>
        <select className="input" style={{ fontSize: 13, padding: '4px 8px' }}
          value={currentId} required
          onChange={e => {
            const opt = options.find(x => x.id === e.target.value);
            onChange(index, idField as keyof POItemForm, e.target.value);
            if (opt) {
              onChange(index, 'item_name', `[${opt.code}] ${opt.name}`);
              onChange(index, 'unit_cost', opt.price_cost ?? opt.price ?? 0);
            }
          }}
        >
          <option value="">— Chọn {label} —</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>[{o.code}] {o.name}{o.unit ? ` (${o.unit})` : ''}</option>
          ))}
        </select>
      </td>
      <td>
        <input className="input" type="number" style={{ fontSize: 13, padding: '4px 8px', width: 70 }}
          min={1} value={item.qty_ordered}
          onChange={e => onChange(index, 'qty_ordered', +e.target.value)}
        />
      </td>
      <td>
        <input className="input" type="number" style={{ fontSize: 13, padding: '4px 8px', width: 130 }}
          min={0} step={1000} value={item.unit_cost}
          placeholder="Giá chưa VAT/cái"
          onChange={e => onChange(index, 'unit_cost', +e.target.value)}
        />
      </td>
      <td>
        <select className="input" style={{ fontSize: 13, padding: '4px 8px', width: 70 }}
          value={item.vat_rate}
          onChange={e => onChange(index, 'vat_rate', +e.target.value)}
        >
          <option value={0}>0%</option>
          <option value={8}>8%</option>
          <option value={10}>10%</option>
        </select>
      </td>
      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 13 }}>
        {fmtSo(Math.round(item.qty_ordered * item.unit_cost * (1 + item.vat_rate / 100)))}₫
      </td>
      <td>
        <button type="button" onClick={() => onRemove(index)}
          style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </td>
    </tr>
  );
}

// ─── Trang chính ──────────────────────────────────────────────────────────────
export default function PurchaseOrdersPage() {
  const qc = useQueryClient();

  // Bộ lọc danh sách
  const [locStatus, setLocStatus] = useState('');
  const [locLoai, setLocLoai]     = useState('');
  const [timKiem, setTimKiem]     = useState('');

  // Modal tạo đơn
  const [hienModal, setHienModal]   = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [itemType, setItemType]     = useState<ItemType>('vehicle');
  const [ngayDat, setNgayDat]       = useState(new Date().toISOString().slice(0, 10));
  const [ngayNhanDK, setNgayNhan]   = useState('');
  const [vatTerms, setVatTerms]     = useState(30);
  const [payMethod, setPayMethod]   = useState('bank_transfer');
  const [ghiChu, setGhiChu]         = useState('');
  const [items, setItems]           = useState<POItemForm[]>([]);

  // Chi tiết đơn (cột phải)
  const [chiTiet, setChiTiet] = useState<(PurchaseOrder & { items?: POItem[]; receipts?: any[] }) | null>(null);

  // Modal nhận hàng xe
  const [hienNH, setHienNH]         = useState(false);
  const [dsVehicle, setDsVehicle]   = useState<VehicleEntry[]>([]);

  // Modal nhận hàng phụ tùng/phụ kiện
  const [hienNHPart, setHienNHPart] = useState(false);
  const [dsPart, setDsPart]         = useState<PartEntry[]>([]);

  // Modal cập nhật hóa đơn NCC
  const [hienHD, setHienHD] = useState(false);
  const [soHD, setSoHD]     = useState('');
  const [ngayHD, setNgayHD] = useState(new Date().toISOString().slice(0, 10));

  // Modal thanh toán
  const [hienTT, setHienTT]     = useState(false);
  const [soTienTT, setSoTienTT] = useState(0);
  const [ppTT, setPpTT]         = useState('bank_transfer');
  const [refTT, setRefTT]       = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data: suppliersData } = useQuery({
    queryKey: ['po-suppliers'],
    queryFn: async () => (await api.get('/purchase-orders/suppliers')).data as { data: Supplier[] },
  });
  const suppliers = suppliersData?.data ?? [];

  const { data: modelsData } = useQuery({
    queryKey: ['vehicle-models-all'],
    queryFn: async () => (await api.get('/vehicles', { params: { limit: '200', is_active: 'true' } })).data as { data: VehicleModel[] },
  });
  const models = modelsData?.data ?? [];

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: async () => (await api.get('/inventory/spare-parts', { params: { limit: '500' } })).data as { data: SparePart[] },
  });
  const spareParts = sparePartsData?.data ?? [];

  const { data: accessoriesData } = useQuery({
    queryKey: ['accessories-all'],
    queryFn: async () => (await api.get('/accessories', { params: { limit: '500' } })).data as { data: Accessory[] },
  });
  const accessories = accessoriesData?.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', locStatus, locLoai, timKiem],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (locStatus) params.status    = locStatus;
      if (locLoai)   params.item_type = locLoai;
      if (timKiem)   params.search    = timKiem;
      return (await api.get('/purchase-orders', { params })).data as { data: PurchaseOrder[]; total: number };
    },
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const taoNhap = useMutation({
    mutationFn: (body: object) => api.post('/purchase-orders', body),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      dongModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi tạo đơn nhập'),
  });

  const doiTT = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.patch(`/purchase-orders/${id}/status`, body),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      if (chiTiet) loadChiTiet(chiTiet.id);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi chuyển trạng thái'),
  });

  const nhanHangXe = useMutation({
    mutationFn: ({ id, vehicles }: { id: string; vehicles: VehicleEntry[] }) =>
      api.post(`/purchase-orders/${id}/receipts`, {
        receipt_date: new Date().toISOString().slice(0, 10),
        vehicles,
        parts: [],
      }),
    onSuccess: (res) => {
      const receiptId = res.data.data.id;
      return api.patch(`/purchase-orders/receipts/${receiptId}/accept`, {}).then(() => {
        toast.success('Đã nhận hàng và nhập kho xe thành công');
        qc.invalidateQueries({ queryKey: ['purchase-orders'] });
        qc.invalidateQueries({ queryKey: ['inventory'] });
        setHienNH(false);
        if (chiTiet) loadChiTiet(chiTiet.id);
      });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi nhận hàng xe'),
  });

  const nhanHangPart = useMutation({
    mutationFn: ({ id, parts }: { id: string; parts: PartEntry[] }) =>
      api.post(`/purchase-orders/${id}/receipts`, {
        receipt_date: new Date().toISOString().slice(0, 10),
        vehicles: [],
        parts,
      }),
    onSuccess: (res) => {
      const receiptId = res.data.data.id;
      return api.patch(`/purchase-orders/receipts/${receiptId}/accept`, {}).then(() => {
        toast.success('Đã nhận hàng và cập nhật kho phụ tùng/phụ kiện');
        qc.invalidateQueries({ queryKey: ['purchase-orders'] });
        qc.invalidateQueries({ queryKey: ['spare-parts-all'] });
        setHienNHPart(false);
        if (chiTiet) loadChiTiet(chiTiet.id);
      });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi nhận hàng'),
  });

  const capNhatHD = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.patch(`/purchase-orders/${id}/status`, {
        status: 'invoiced',
        supplier_invoice_number: soHD,
        supplier_invoice_date:   ngayHD,
      }),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      if (chiTiet) loadChiTiet(chiTiet.id);
      setHienHD(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi cập nhật hóa đơn'),
  });

  const thanhToan = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.post(`/purchase-orders/${id}/payments`, {
        amount: soTienTT, payment_method: ppTT, bank_reference: refTT || undefined,
      }),
    onSuccess: (res) => {
      toast.success(res.data.message);
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      if (chiTiet) loadChiTiet(chiTiet.id);
      setHienTT(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Lỗi thanh toán'),
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const dongModal = () => {
    setHienModal(false);
    setSupplierId(''); setGhiChu(''); setItems([]);
    setItemType('vehicle');
    setNgayDat(new Date().toISOString().slice(0, 10));
    setNgayNhan(''); setVatTerms(30); setPayMethod('bank_transfer');
  };

  const dongItemMoi = (): POItemForm => ({
    qty_ordered: 1, unit_cost: 0, vat_rate: 10,
    ...(itemType === 'vehicle'    ? { vehicle_model_id: '', color: '', year_manufacture: namHT } : {}),
    ...(itemType === 'spare_part' ? { spare_part_id: '' } : {}),
    ...(itemType === 'accessory'  ? { accessory_id:  '' } : {}),
  });

  const themDong = () => setItems(p => [...p, dongItemMoi()]);

  const suaDong = (i: number, f: keyof POItemForm, v: unknown) =>
    setItems(p => p.map((it, idx) => idx === i ? { ...it, [f]: v } : it));

  const xoaDong = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));

  const tongTien = items.reduce((s, it) =>
    s + Math.round(it.qty_ordered * it.unit_cost * (1 + it.vat_rate / 100)), 0);

  const guiTao = (e: React.FormEvent) => {
    e.preventDefault();
    taoNhap.mutate({
      supplier_id: supplierId,
      item_type:   itemType,
      order_date:  ngayDat,
      expected_date: ngayNhanDK || undefined,
      payment_terms: vatTerms,
      payment_method: payMethod,
      notes: ghiChu || undefined,
      items,
    });
  };

  const loadChiTiet = async (id: string) => {
    const res = await api.get(`/purchase-orders/${id}`);
    setChiTiet({ ...res.data.purchase_order, items: res.data.items, receipts: res.data.receipts });
  };

  const moChiTiet = (po: PurchaseOrder) => {
    setChiTiet(po);
    loadChiTiet(po.id);
  };

  // Mở modal nhận hàng — phân nhánh theo loại đơn
  const moNhanHang = () => {
    if (!chiTiet?.items) return;
    if (chiTiet.item_type === 'vehicle') {
      const entries: VehicleEntry[] = [];
      chiTiet.items.forEach(it => {
        const cn = it.qty_ordered - (it.qty_received ?? 0);
        for (let i = 0; i < cn; i++) {
          entries.push({
            po_item_id: it.id || '',
            vin: '', engine_number: '',
            color: it.color || '',
            year_manufacture: it.year_manufacture || namHT,
            condition: 'ok',
          });
        }
      });
      if (!entries.length) { toast.error('Không còn xe nào cần nhận'); return; }
      setDsVehicle(entries);
      setHienNH(true);
    } else {
      // Phụ tùng hoặc phụ kiện
      const entries: PartEntry[] = chiTiet.items
        .filter(it => (it.qty_ordered - (it.qty_received ?? 0)) > 0)
        .map(it => ({
          po_item_id:   it.id || '',
          qty_received: it.qty_ordered - (it.qty_received ?? 0),
          condition:    'ok',
          item_label:   tenHang(it),
        }));
      if (!entries.length) { toast.error('Không còn hàng nào cần nhận'); return; }
      setDsPart(entries);
      setHienNHPart(true);
    }
  };

  const suaVehicle = (i: number, f: keyof VehicleEntry, v: string | number) =>
    setDsVehicle(p => p.map((x, idx) => idx === i ? { ...x, [f]: v } : x));

  const suaPart = (i: number, f: keyof PartEntry, v: string | number) =>
    setDsPart(p => p.map((x, idx) => idx === i ? { ...x, [f]: v } : x));

  const guiNH = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chiTiet) return;
    const thieu = dsVehicle.filter(v => v.condition !== 'rejected' && !v.vin.trim());
    if (thieu.length) { toast.error(`${thieu.length} xe chưa có số khung (VIN)`); return; }
    nhanHangXe.mutate({ id: chiTiet.id, vehicles: dsVehicle });
  };

  const guiNHPart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chiTiet) return;
    const thieu = dsPart.filter(p => p.qty_received < 1);
    if (thieu.length) { toast.error('Số lượng nhận phải >= 1'); return; }
    nhanHangPart.mutate({ id: chiTiet.id, parts: dsPart });
  };

  const selectedSupplier = suppliers.find(s => s.id === supplierId);

  // ─── Nút hành động theo trạng thái ──────────────────────────────────────────
  const renderActions = () => {
    if (!chiTiet) return null;
    const { id, status } = chiTiet;
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'draft' && (<>
          <button className="btn btn-primary"
            onClick={() => doiTT.mutate({ id, body: { status: 'submitted' } })}
            disabled={doiTT.isPending}>📤 Gửi NCC</button>
          <button className="btn btn-danger"
            onClick={() => { if (confirm('Hủy đơn này?')) doiTT.mutate({ id, body: { status: 'cancelled' } }); }}
            disabled={doiTT.isPending}>Hủy đơn</button>
        </>)}
        {status === 'submitted' && (<>
          <button className="btn btn-success"
            onClick={() => doiTT.mutate({ id, body: { status: 'approved' } })}
            disabled={doiTT.isPending}>✓ Duyệt đơn</button>
          <button className="btn btn-secondary"
            onClick={() => doiTT.mutate({ id, body: { status: 'rejected' } })}
            disabled={doiTT.isPending}>Từ chối</button>
          <button className="btn btn-danger"
            onClick={() => { if (confirm('Hủy đơn này?')) doiTT.mutate({ id, body: { status: 'cancelled' } }); }}
            disabled={doiTT.isPending}>Hủy đơn</button>
        </>)}
        {(status === 'approved' || status === 'partial_received') && (
          <button className="btn btn-success" onClick={moNhanHang}>
            📦 Nhận hàng & nhập kho
          </button>
        )}
        {status === 'fully_received' && (
          <button className="btn btn-primary"
            onClick={() => { setSoHD(''); setNgayHD(new Date().toISOString().slice(0, 10)); setHienHD(true); }}>
            🧾 Cập nhật hóa đơn NCC
          </button>
        )}
        {status === 'invoiced' && (
          <button className="btn btn-success"
            onClick={() => { setSoTienTT(chiTiet.balance_due || 0); setPpTT('bank_transfer'); setRefTT(''); setHienTT(true); }}>
            💳 Thanh toán NCC
          </button>
        )}
      </div>
    );
  };

  const danhSach = data?.data ?? [];

  return (
    <div className="page-container">
      {/* Tiêu đề */}
      <div className="page-header">
        <div>
          <h1 className="page-title">📋 Đơn nhập hàng</h1>
          <p className="page-subtitle">Quản lý đặt mua xe, phụ tùng và phụ kiện từ nhà cung cấp</p>
        </div>
        <button className="btn btn-primary" onClick={() => setHienModal(true)}>+ Tạo đơn nhập</button>
      </div>

      {/* Bộ lọc */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 200 }}
            placeholder="Tìm số PO..." value={timKiem}
            onChange={e => setTimKiem(e.target.value)}
          />
          <select className="input" style={{ width: 170 }}
            value={locLoai} onChange={e => setLocLoai(e.target.value)}
          >
            <option value="">Tất cả loại hàng</option>
            <option value="vehicle">🚗 Xe</option>
            <option value="spare_part">🔧 Phụ tùng</option>
            <option value="accessory">🎒 Phụ kiện</option>
          </select>
          <select className="input" style={{ width: 180 }}
            value={locStatus} onChange={e => setLocStatus(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(TRANG_THAI).map(([k, v]) => (
              <option key={k} value={k}>{v.nhan}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Layout 2 cột */}
      <div style={{ display: 'grid', gridTemplateColumns: chiTiet ? 'clamp(280px, 30%, 380px) 1fr' : '1fr', gap: 16, alignItems: 'flex-start' }}>

        {/* Danh sách */}
        <div className="card">
          {isLoading ? <div className="loading-spinner" /> : danhSach.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              Chưa có đơn nhập hàng
            </div>
          ) : danhSach.map(po => (
            <div key={po.id}
              onClick={() => moChiTiet(po)}
              style={{
                padding: '12px 16px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                background: chiTiet?.id === po.id ? '#eff6ff' : 'white',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#1e40af', fontSize: 15 }}>{po.po_number}</div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{po.acc_suppliers?.supplier_name}</div>
                  <div style={{ marginTop: 3 }}>
                    <BadgeLoai type={po.item_type} />
                  </div>
                </div>
                <BadgeTT status={po.status} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13, color: '#6b7280' }}>
                <span>📅 {fmtNgay(po.order_date)}</span>
                <span style={{ fontWeight: 700, color: '#1f2937' }}>{fmtSo(po.total_amount)}₫</span>
              </div>
              {po.balance_due > 0 && po.status === 'invoiced' && (
                <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>
                  Còn nợ: {fmtSo(po.balance_due)}₫
                </div>
              )}
            </div>
          ))}
          {data && (
            <div style={{ padding: '8px 16px', color: '#9ca3af', fontSize: 12, borderTop: '1px solid #f3f4f6' }}>
              {data.total} đơn nhập hàng
            </div>
          )}
        </div>

        {/* Chi tiết */}
        {chiTiet && (
          <div className="card" style={{ position: 'sticky', top: 16 }}>
            <div style={{ padding: 16, borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#1e40af' }}>{chiTiet.po_number}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <BadgeTT status={chiTiet.status} />
                    <BadgeLoai type={chiTiet.item_type} />
                  </div>
                </div>
                <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af' }}
                  onClick={() => setChiTiet(null)}>✕</button>
              </div>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
                <div><span style={{ color: '#9ca3af' }}>NCC: </span><strong>{chiTiet.acc_suppliers?.supplier_name}</strong></div>
                {chiTiet.acc_suppliers?.phone && <div><span style={{ color: '#9ca3af' }}>SĐT: </span>{chiTiet.acc_suppliers.phone}</div>}
                <div><span style={{ color: '#9ca3af' }}>Ngày đặt: </span>{fmtNgay(chiTiet.order_date)}</div>
                {chiTiet.expected_date && <div><span style={{ color: '#9ca3af' }}>Dự kiến: </span>{fmtNgay(chiTiet.expected_date)}</div>}
                {chiTiet.actual_date   && <div><span style={{ color: '#9ca3af' }}>Nhận thực tế: </span>{fmtNgay(chiTiet.actual_date)}</div>}
              </div>
            </div>

            {/* Items */}
            <div>
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Hàng hóa</th>
                    <th style={{ textAlign: 'right' }}>Đặt</th>
                    <th style={{ textAlign: 'right' }}>Đã nhận</th>
                    <th style={{ textAlign: 'right' }}>Thành tiền (có VAT)</th>
                  </tr>
                </thead>
                <tbody>
                  {(chiTiet.items ?? []).map((it, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{tenHang(it)}</div>
                        {it.item_type === 'vehicle' && it.color && (
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>{it.color}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{it.qty_ordered}</td>
                      <td style={{ textAlign: 'right', color: (it.qty_received ?? 0) >= it.qty_ordered ? '#16a34a' : '#d97706' }}>
                        {it.qty_received ?? 0}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtSo(it.line_total_with_vat ?? 0)}₫</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600, padding: '8px 12px', fontSize: 13 }}>Chưa VAT:</td>
                    <td style={{ textAlign: 'right', padding: '8px 12px', fontSize: 13 }}>{fmtSo(chiTiet.subtotal)}₫</td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600, padding: '4px 12px', fontSize: 13 }}>VAT:</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', fontSize: 13, color: '#6b7280' }}>{fmtSo(chiTiet.vat_amount)}₫</td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px' }}>Tổng cộng:</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, padding: '8px 12px', color: '#1e40af' }}>{fmtSo(chiTiet.total_amount)}₫</td>
                  </tr>
                  {chiTiet.paid_amount > 0 && (<>
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right', padding: '4px 12px', fontSize: 13, color: '#16a34a' }}>Đã thanh toán:</td>
                      <td style={{ textAlign: 'right', fontSize: 13, color: '#16a34a', padding: '4px 12px' }}>{fmtSo(chiTiet.paid_amount)}₫</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600, padding: '4px 12px', color: '#dc2626' }}>Còn nợ:</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', padding: '4px 12px' }}>{fmtSo(chiTiet.balance_due)}₫</td>
                    </tr>
                  </>)}
                </tfoot>
              </table>
            </div>

            {/* Nút hành động */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #f3f4f6' }}>
              {renderActions()}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════ Modal tạo đơn ══════════════════ */}
      {hienModal && (
        <div className="modal-overlay" onClick={dongModal}>
          <div className="modal" style={{ width: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Tạo đơn nhập hàng mới</h3>
              <button className="modal-close" onClick={dongModal}>✕</button>
            </div>
            <form onSubmit={guiTao} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* ── Loại hàng ── */}
                <div>
                  <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Loại hàng nhập *</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['vehicle', 'spare_part', 'accessory'] as ItemType[]).map(t => (
                      <button key={t} type="button"
                        onClick={() => { setItemType(t); setItems([]); }}
                        style={{
                          padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
                          border: `2px solid ${itemType === t ? '#2563eb' : '#e5e7eb'}`,
                          background: itemType === t ? '#eff6ff' : 'white',
                          color: itemType === t ? '#1e40af' : '#374151',
                        }}
                      >
                        {ITEM_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Thông tin NCC + ngày ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group" style={{ gridColumn: '1/3' }}>
                    <label className="form-label">Nhà cung cấp *</label>
                    <select className="input" required value={supplierId}
                      onChange={e => {
                        setSupplierId(e.target.value);
                        const s = suppliers.find(x => x.id === e.target.value);
                        if (s) setVatTerms(s.payment_terms);
                      }}
                    >
                      <option value="">— Chọn nhà cung cấp —</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>[{s.supplier_code}] {s.supplier_name}</option>
                      ))}
                    </select>
                    {selectedSupplier && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                        {selectedSupplier.phone} · Thanh toán {selectedSupplier.payment_terms} ngày
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ngày đặt hàng</label>
                    <input className="input" type="date" value={ngayDat} onChange={e => setNgayDat(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Dự kiến nhận hàng</label>
                    <input className="input" type="date" value={ngayNhanDK} onChange={e => setNgayNhan(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hình thức thanh toán</label>
                    <select className="input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                      <option value="bank_transfer">Chuyển khoản</option>
                      <option value="cash">Tiền mặt</option>
                      <option value="check">Séc</option>
                      <option value="mixed">Hỗn hợp</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Điều khoản (ngày)</label>
                    <input className="input" type="number" min={0} value={vatTerms} onChange={e => setVatTerms(+e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ghi chú</label>
                    <input className="input" value={ghiChu} onChange={e => setGhiChu(e.target.value)} placeholder="Ghi chú thêm" />
                  </div>
                </div>

                {/* ── Danh sách hàng ── */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: 14 }}>
                      Danh sách {itemType === 'vehicle' ? 'xe nhập' : itemType === 'spare_part' ? 'phụ tùng nhập' : 'phụ kiện nhập'}
                    </strong>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={themDong}>+ Thêm dòng</button>
                  </div>
                  {items.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 8 }}>
                      Nhấn "+ Thêm dòng" để thêm hàng vào đơn
                    </div>
                  ) : itemType === 'vehicle' ? (
                    <table className="table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Mã SP</th><th>Mẫu xe *</th><th>Màu</th><th>SL</th>
                          <th>Giá nhập/xe (chưa VAT)</th><th>VAT</th>
                          <th style={{ textAlign: 'right' }}>Thành tiền</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => (
                          <DongXe key={i} item={it} index={i} models={models}
                            onChange={suaDong} onRemove={xoaDong} />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600, padding: '10px 8px' }}>Tổng cộng (có VAT):</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#1e40af', padding: '10px 8px' }}>{fmtSo(tongTien)}₫</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  ) : (
                    <table className="table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>{itemType === 'spare_part' ? 'Phụ tùng' : 'Phụ kiện'} *</th>
                          <th>SL</th><th>Giá nhập/cái (chưa VAT)</th><th>VAT</th>
                          <th style={{ textAlign: 'right' }}>Thành tiền</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => (
                          <DongPhanTu key={i} item={it} index={i}
                            options={itemType === 'spare_part'
                              ? spareParts.map(p => ({ id: p.id, code: p.code, name: p.name, unit: p.unit, price_cost: p.price_cost ?? 0 }))
                              : accessories.map(a => ({ id: a.id, code: a.code, name: a.name, price: a.price ?? 0 }))}
                            label={itemType === 'spare_part' ? 'phụ tùng' : 'phụ kiện'}
                            onChange={suaDong} onRemove={xoaDong}
                          />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600, padding: '10px 8px' }}>Tổng cộng (có VAT):</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#1e40af', padding: '10px 8px' }}>{fmtSo(tongTien)}₫</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={dongModal}>Hủy</button>
                <button type="submit" className="btn btn-primary"
                  disabled={taoNhap.isPending || items.length === 0 || !supplierId}>
                  {taoNhap.isPending ? 'Đang tạo...' : 'Tạo đơn nhập hàng'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════ Modal nhận hàng — XE ══════════════════ */}
      {hienNH && chiTiet && (
        <div className="modal-overlay" onClick={() => setHienNH(false)}>
          <div className="modal" style={{ width: 740, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📦 Nhận xe — {chiTiet.po_number}</h3>
              <button className="modal-close" onClick={() => setHienNH(false)}>✕</button>
            </div>
            <form onSubmit={guiNH} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ overflow: 'auto' }}>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                  Điền số khung (VIN) từng xe. Sau khi xác nhận, xe sẽ tự động vào kho.
                </p>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr><th>#</th><th>Mẫu xe / Màu</th><th>Số khung (VIN) *</th><th>Số máy</th><th>Tình trạng</th></tr>
                  </thead>
                  <tbody>
                    {dsVehicle.map((v, i) => {
                      const itFound = chiTiet.items?.find(it => it.id === v.po_item_id);
                      return (
                        <tr key={i} style={v.condition === 'rejected' ? { opacity: 0.5 } : undefined}>
                          <td style={{ color: '#9ca3af' }}>{i + 1}</td>
                          <td>
                            <div style={{ fontWeight: 500 }}>{itFound ? tenHang(itFound) : '—'}</div>
                            <input className="input" style={{ fontSize: 12, padding: '2px 6px', width: 80, marginTop: 2 }}
                              placeholder="Màu" value={v.color}
                              onChange={e => suaVehicle(i, 'color', e.target.value)}
                            />
                          </td>
                          <td>
                            <input className="input" style={{ fontSize: 13, padding: '4px 8px' }}
                              value={v.vin} required={v.condition !== 'rejected'}
                              onChange={e => suaVehicle(i, 'vin', e.target.value.toUpperCase())}
                              placeholder="VIN123456789"
                            />
                          </td>
                          <td>
                            <input className="input" style={{ fontSize: 13, padding: '4px 8px' }}
                              value={v.engine_number}
                              onChange={e => suaVehicle(i, 'engine_number', e.target.value)}
                              placeholder="Số máy"
                            />
                          </td>
                          <td>
                            <select className="input" style={{ fontSize: 13, padding: '4px 8px', width: 110 }}
                              value={v.condition}
                              onChange={e => suaVehicle(i, 'condition', e.target.value)}
                            >
                              <option value="ok">✓ Đạt</option>
                              <option value="defect">⚠ Có lỗi nhẹ</option>
                              <option value="rejected">✕ Trả NCC</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setHienNH(false)}>Hủy</button>
                <button type="submit" className="btn btn-success" disabled={nhanHangXe.isPending}>
                  {nhanHangXe.isPending ? 'Đang nhập kho...' : `Xác nhận nhận ${dsVehicle.length} xe`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════ Modal nhận hàng — PHỤ TÙNG / PHỤ KIỆN ══════════════════ */}
      {hienNHPart && chiTiet && (
        <div className="modal-overlay" onClick={() => setHienNHPart(false)}>
          <div className="modal" style={{ width: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📦 Nhận {chiTiet.item_type === 'spare_part' ? 'phụ tùng' : 'phụ kiện'} — {chiTiet.po_number}</h3>
              <button className="modal-close" onClick={() => setHienNHPart(false)}>✕</button>
            </div>
            <form onSubmit={guiNHPart} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ overflow: 'auto' }}>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                  Xác nhận số lượng thực nhận từng mặt hàng. Kho phụ tùng sẽ được cập nhật tự động.
                </p>
                <table className="table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr><th>#</th><th>Hàng hóa</th><th>SL nhận</th><th>Tình trạng</th></tr>
                  </thead>
                  <tbody>
                    {dsPart.map((p, i) => (
                      <tr key={i}>
                        <td style={{ color: '#9ca3af' }}>{i + 1}</td>
                        <td style={{ fontWeight: 500 }}>{p.item_label}</td>
                        <td>
                          <input className="input" type="number" style={{ fontSize: 13, padding: '4px 8px', width: 80 }}
                            min={1} value={p.qty_received}
                            onChange={e => suaPart(i, 'qty_received', +e.target.value)}
                          />
                        </td>
                        <td>
                          <select className="input" style={{ fontSize: 13, padding: '4px 8px', width: 120 }}
                            value={p.condition}
                            onChange={e => suaPart(i, 'condition', e.target.value)}
                          >
                            <option value="ok">✓ Đạt</option>
                            <option value="defect">⚠ Có lỗi nhẹ</option>
                            <option value="rejected">✕ Trả NCC</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setHienNHPart(false)}>Hủy</button>
                <button type="submit" className="btn btn-success" disabled={nhanHangPart.isPending}>
                  {nhanHangPart.isPending ? 'Đang cập nhật kho...' : `Xác nhận nhận ${dsPart.length} mặt hàng`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════ Modal cập nhật hóa đơn NCC ══════════════════ */}
      {hienHD && chiTiet && (
        <div className="modal-overlay" onClick={() => setHienHD(false)}>
          <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🧾 Cập nhật hóa đơn NCC</h3>
              <button className="modal-close" onClick={() => setHienHD(false)}>✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); capNhatHD.mutate({ id: chiTiet.id }); }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Số hóa đơn NCC *</label>
                  <input className="input" required value={soHD} onChange={e => setSoHD(e.target.value)} placeholder="HĐ/2026/001" />
                </div>
                <div className="form-group">
                  <label className="form-label">Ngày hóa đơn</label>
                  <input className="input" type="date" value={ngayHD} onChange={e => setNgayHD(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setHienHD(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={capNhatHD.isPending}>
                  {capNhatHD.isPending ? 'Đang lưu...' : 'Xác nhận'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════ Modal thanh toán NCC ══════════════════ */}
      {hienTT && chiTiet && (
        <div className="modal-overlay" onClick={() => setHienTT(false)}>
          <div className="modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💳 Thanh toán NCC — {chiTiet.po_number}</h3>
              <button className="modal-close" onClick={() => setHienTT(false)}>✕</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); thanhToan.mutate({ id: chiTiet.id }); }}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', fontSize: 14 }}>
                  Còn nợ: <strong style={{ color: '#dc2626' }}>{fmtSo(chiTiet.balance_due)}₫</strong>
                </div>
                <div className="form-group">
                  <label className="form-label">Số tiền thanh toán (₫) *</label>
                  <input className="input" type="number" required min={1} max={chiTiet.balance_due}
                    value={soTienTT} onChange={e => setSoTienTT(+e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Hình thức</label>
                  <select className="input" value={ppTT} onChange={e => setPpTT(e.target.value)}>
                    <option value="bank_transfer">Chuyển khoản</option>
                    <option value="cash">Tiền mặt</option>
                    <option value="check">Séc</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Số tham chiếu chuyển khoản</label>
                  <input className="input" value={refTT} onChange={e => setRefTT(e.target.value)} placeholder="Số CK / mã GD" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setHienTT(false)}>Hủy</button>
                <button type="submit" className="btn btn-success" disabled={thanhToan.isPending}>
                  {thanhToan.isPending ? 'Đang ghi nhận...' : 'Xác nhận thanh toán'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
