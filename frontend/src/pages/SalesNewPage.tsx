// Trang tạo đơn bán hàng mới — giao diện POS hoàn chỉnh
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

// ─── Type nội bộ POS: Promotion + trạng thái tick riêng ──────────────────────
type PromoInPOS = import('../types').Promotion & { _checked: boolean };
import { formatCurrency, getInitials } from '../utils/helpers';
import { mauToHex } from '../utils/colors';
import { useAuthStore } from '../store/authStore';
import type { Customer, VehicleModel, InventoryVehicle, Accessory, CartAccessory, FeeSetting, RegistrationService, InstallmentProvider } from '../types';
import BatterySerialInput from '../components/BatterySerialInput';
import toast from 'react-hot-toast';
import './SalesNewPage.css';

// ─── Types nội bộ ────────────────────────────────────────────────────────────

interface FormTraGop {
  provider_id: string;   // ID đơn vị tài chính đã chọn
  so_thang:    number;
  dua_truoc:   string;   // số tiền đưa trước (định dạng "1,000,000")
}

interface FormKhachMoi {
  full_name: string;
  phone: string;
  id_card: string;
  address: string;
}

// ─── Hằng số ─────────────────────────────────────────────────────────────────
const KHUYEN_MAI_MAC_DINH: PromoInPOS[] = [];

const NGAY_HIEN_TAI = new Date().toISOString().split('T')[0];

// Labels cho danh mục phụ kiện
const ACCESSORY_CATEGORY: Record<string, { label: string; icon: string }> = {
  battery: { label: 'Pin xe',    icon: '🔋' },
  safety:  { label: 'Bảo hộ',    icon: '' },
  luggage: { label: 'Hành lý',   icon: '' },
  comfort: { label: 'Tiện nghi', icon: '' },
  weather: { label: 'Thời tiết', icon: '' },
  decor:   { label: 'Trang trí', icon: '' },
  other:   { label: 'Khác',      icon: '' },
};

// ─── Component chính ─────────────────────────────────────────────────────────
export default function SalesNewPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const { user }  = useAuthStore();
  const [searchParams] = useSearchParams();
  const editOrderId = searchParams.get('edit');
  const isEditMode  = !!editOrderId;

  // Mã đơn do backend tự sinh khi lưu — không hiển thị mã tạm nữa

  // ── Bước 1: Khách hàng ───────────────────────────────────────────────────
  const [searchKH, setSearchKH]               = useState('');
  const [showKHDrop, setShowKHDrop]           = useState(false);
  const [khachHang, setKhachHang]             = useState<Customer | null>(null);
  const [showModalKH, setShowModalKH]         = useState(false);
  const [formKhachMoi, setFormKhachMoi]       = useState<FormKhachMoi>({
    full_name: '', phone: '', id_card: '', address: '',
  });

  // ── Bước 2: Xe ───────────────────────────────────────────────────────────
  const [searchXe, setSearchXe]               = useState('');
  const [modelId, setModelId]                 = useState('');
  const [mauChon, setMauChon]                 = useState('');
  const [phienBanChon, setPhienBanChon]       = useState('');    // ten của variant
  const [vehicleChon, setVehicleChon]         = useState<InventoryVehicle | null>(null);
  const [, setShowVINDrop]                     = useState(false);

  // ── Bước 3: Thanh toán ───────────────────────────────────────────────────
  const [hinhThuc, setHinhThuc]               = useState<'tra_thang' | 'tra_gop'>('tra_thang');
  const [phuongThuc, setPhuongThuc]           = useState<'cash' | 'bank_transfer' | 'qr' | 'installment'>('cash');
  const [traGop, setTraGop]                   = useState<FormTraGop>({ provider_id: '', so_thang: 12, dua_truoc: '' });
  const [datCoc, setDatCoc]                   = useState('');
  const [tienKhach]                           = useState('');

  // ── Chế độ đặt cọc trước (xe chưa có hàng) ───────────────────────────────
  const [modeDatCoc, setModeDatCoc]           = useState(false);
  const [mauYeuCau, setMauYeuCau]             = useState('');

  // ── Bước 4: Khuyến mãi ───────────────────────────────────────────────────
  const [khuyenMai, setKhuyenMai]             = useState<PromoInPOS[]>(KHUYEN_MAI_MAC_DINH);

  // ── Bước 2b: Phụ kiện bán kèm ─────────────────────────────────────────────
  const [gioPhKien, setGioPhKien]             = useState<CartAccessory[]>([]);
  const [filterCatPK, setFilterCatPK]         = useState<string>('');

  // ── Dịch vụ đăng ký (tick chọn) ──────────────────────────────────────────
  const [dichVuChon, setDichVuChon]           = useState<Set<string>>(new Set());

  // ── Bước 5: Ghi chú & giao hàng ─────────────────────────────────────────
  const [ghiChu, setGhiChu]                   = useState('');
  const [ngayGiao, setNgayGiao]               = useState('');
  const [diaChiGiao, setDiaChiGiao]           = useState('');
  const [fileHoSo, setFileHoSo]               = useState<File[]>([]);

  // Tự điền địa chỉ giao khi chọn KH
  useEffect(() => {
    if (khachHang?.address && !diaChiGiao) setDiaChiGiao(khachHang.address);
  }, [khachHang]);

  // ─── Queries ─────────────────────────────────────────────────────────────

  // Tìm kiếm khách hàng — CHỈ theo SĐT chính xác (POS):
  //   - Sales thuộc bất kỳ ai cũng tra được nếu nhập đủ SĐT
  //   - Tìm khi đã nhập ≥ 9 chữ số (SĐT VN tối thiểu 9 số)
  const { data: dsKH, isFetching: fetchingKH } = useQuery<{ data: Customer[] }>({
    queryKey: ['kh-search', searchKH],
    queryFn: () => api.get('/customers', {
      params: { phone_exact: searchKH.trim(), limit: 5 },
    }).then(r => r.data),
    enabled: /^\d{9,}$/.test(searchKH.trim()),
    staleTime: 5000,
  });

  // Danh sách mẫu xe (active)
  const { data: dsModel, isLoading: loadingModel } = useQuery<{ data: VehicleModel[] }>({
    queryKey: ['vehicle-models-pos'],
    queryFn: () => api.get('/vehicles', { params: { limit: 100, is_active: true } }).then(r => r.data),
  });

  // Tất cả xe tồn kho của model đang chọn
  const { data: dsVehicleAll, isLoading: loadingVehicle } = useQuery<{ data: InventoryVehicle[] }>({
    queryKey: ['inventory-model', modelId],
    queryFn: () => api.get('/inventory', { params: { model_id: modelId, status: 'in_stock', limit: 200 } }).then(r => r.data),
    enabled: !!modelId,
  });

  // ── Cảnh báo VIN bị chiếm bởi đơn khác ───────────────────────────────────
  // Xe đang hiển thị (ưu tiên xe đã chọn, fallback xe đầu tiên trong danh sách màu)
  const vehicleHienTai = vehicleChon ?? (mauChon ? (dsVehicleAll?.data ?? []).find(v => v.color === mauChon) ?? null : null);
  type VehicleConflict = {
    id: string;
    order_number: string;
    status: string;
    deposit_amount: number;
    created_at: string;
    customers?: { full_name?: string; phone?: string } | null;
    users?:     { full_name?: string } | null;
  };
  const { data: conflictData } = useQuery<{ data: VehicleConflict[] }>({
    queryKey: ['vehicle-conflict', vehicleHienTai?.id, editOrderId],
    queryFn: () => api.get('/sales/check-vehicle-conflict', {
      params: {
        vehicle_id:       vehicleHienTai!.id,
        exclude_order_id: editOrderId || undefined,
      },
    }).then(r => r.data),
    enabled:  !!vehicleHienTai?.id && !modeDatCoc,
    staleTime: 5_000,
  });
  const dsXungDot     = conflictData?.data ?? [];
  const coXungDot     = dsXungDot.length > 0;
  const laAdminManager = user?.role === 'admin' || user?.role === 'manager';

  // Danh sách phụ kiện tương thích với model đang chọn (hoặc tất cả nếu chưa chọn)
  const { data: dsPhKien, isLoading: loadingPK } = useQuery<{ data: Accessory[] }>({
    queryKey: ['accessories', modelId],
    queryFn: () =>
      api.get('/accessories', {
        params: { model_id: modelId || undefined, is_active: 'true' },
      }).then(r => r.data),
    staleTime: 60_000,
  });

  // Khuyến mãi đang hoạt động từ API
  const { data: dsActivePromos } = useQuery<{ data: import('../types').Promotion[] }>({
    queryKey: ['active-promos', modelId],
    queryFn: () =>
      api.get('/promotions/active', {
        params: { model_id: modelId || undefined },
      }).then(r => r.data),
    staleTime: 60_000,
  });

  // Phí cố định từ API (is_active = true) — lọc theo mẫu xe đang chọn
  const { data: feesData } = useQuery<{ data: FeeSetting[] }>({
    queryKey: ['fee-settings-pos', modelId],
    queryFn:  () => api.get('/settings/fees', {
      params: { model_id: modelId || undefined },
    }).then(r => r.data),
    staleTime: 60_000,
  });
  const dsFees = feesData?.data ?? [];
  const tongPhi = dsFees.reduce((s, f) => s + f.amount, 0);

  // Dịch vụ đăng ký từ API
  const { data: svcData } = useQuery<{ data: RegistrationService[] }>({
    queryKey: ['reg-services-pos'],
    queryFn:  () => api.get('/settings/services').then(r => r.data),
    staleTime: 300_000,
  });
  const dsDichVu = svcData?.data ?? [];

  const tongDichVu = dsDichVu
    .filter(s => dichVuChon.has(s.id))
    .reduce((s, sv) => s + sv.price, 0);

  // Đơn vị tài chính (trả góp) — chỉ load khi cần
  const { data: ipData } = useQuery<{ data: InstallmentProvider[] }>({
    queryKey: ['installment-providers-pos'],
    queryFn:  () => api.get('/settings/installment-providers').then(r => r.data),
    staleTime: 5 * 60_000,
  });
  const dsProviders = ipData?.data ?? [];

  // ── Edit mode: load đơn hàng hiện có ──────────────────────────────────────
  const { data: orderEdit } = useQuery({
    queryKey: ['sales-detail-edit', editOrderId],
    queryFn:  () => api.get(`/sales/${editOrderId}`).then(r => r.data),
    enabled:  isEditMode,
  });

  // Prefill state từ đơn — chạy 1 lần khi orderEdit về
  const [daPrefill, setDaPrefill] = useState(false);
  useEffect(() => {
    if (!orderEdit || daPrefill) return;
    if (orderEdit.status !== 'draft') {
      toast.error(`Đơn đang ở trạng thái "${orderEdit.status}", chỉ sửa được đơn ở trạng thái "Mở"`);
      navigate(`/sales/${orderEdit.id}`);
      return;
    }

    // Khách hàng
    if (orderEdit.customers) {
      setKhachHang(orderEdit.customers as any);
      setSearchKH(orderEdit.customers.full_name);
    }

    // Xe — model + màu + VIN từ item đầu tiên
    const firstItem = orderEdit.sales_order_items?.[0];
    if (firstItem) {
      setModelId(firstItem.vehicle_model_id ?? '');
      if (firstItem.inventory_vehicles?.color) {
        setMauChon(firstItem.inventory_vehicles.color);
      }
      if (firstItem.inventory_vehicles) {
        setVehicleChon(firstItem.inventory_vehicles as any);
      }
    }

    // Phụ kiện
    if (orderEdit.sales_order_accessories?.length) {
      setGioPhKien(
        orderEdit.sales_order_accessories.map((a: any) => ({
          accessory:  a.accessories,
          quantity:   a.quantity,
          unit_price: a.unit_price,
          line_total: a.line_total,
        })),
      );
    }

    // Dịch vụ
    if (orderEdit.sales_order_services?.length) {
      setDichVuChon(new Set(orderEdit.sales_order_services.map((s: any) => s.service_id).filter(Boolean)));
    }

    // Thanh toán
    if (orderEdit.payment_method === 'installment') {
      setHinhThuc('tra_gop');
      setPhuongThuc('installment');
    } else if (orderEdit.payment_method) {
      setPhuongThuc(orderEdit.payment_method as any);
    }
    if (orderEdit.deposit_amount) {
      setDatCoc(orderEdit.deposit_amount.toLocaleString('vi-VN'));
    }

    // Ghi chú & giao xe
    if (orderEdit.notes) setGhiChu(orderEdit.notes);
    if (orderEdit.delivery_date) setNgayGiao(orderEdit.delivery_date);
    if (orderEdit.delivery_address) setDiaChiGiao(orderEdit.delivery_address);

    // Bật mode đặt cọc nếu item chưa có VIN
    if (firstItem && !firstItem.inventory_vehicle_id) {
      setModeDatCoc(true);
      // Trích màu yêu cầu từ note (nếu có)
      const m = orderEdit.notes?.match(/Khách yêu cầu màu:\s*([^.\n]+)/);
      if (m) setMauYeuCau(m[1].trim());
    }

    setDaPrefill(true);
  }, [orderEdit, daPrefill, navigate]);

  // Cập nhật danh sách KM khi model thay đổi, giữ lại trạng thái _checked
  // KM KHÔNG tự tick — admin/sales phải chủ động chọn cho từng đơn
  useEffect(() => {
    const incoming = dsActivePromos?.data ?? [];
    setKhuyenMai(prev => {
      const checkedIds = new Set(prev.filter(k => k._checked).map(k => k.id));
      return incoming.map(p => ({
        ...p,
        _checked: checkedIds.has(p.id),
      }));
    });
  }, [dsActivePromos]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const modelChon = useMemo(
    () => dsModel?.data?.find(m => m.id === modelId) ?? null,
    [dsModel, modelId],
  );

  // Danh sách màu có hàng thực tế
  const dauMauCoHang = useMemo(() => {
    if (!dsVehicleAll?.data) return [];
    const mauSet = new Set(dsVehicleAll.data.map(v => v.color).filter(Boolean));
    return [...mauSet];
  }, [dsVehicleAll]);

  // Xe theo màu đã chọn
  const dsXeTheoMau = useMemo(
    () => (dsVehicleAll?.data ?? []).filter(v => v.color === mauChon),
    [dsVehicleAll, mauChon],
  );

  const soLuongConHang = dsXeTheoMau.length;

  // Lọc model theo search
  const dsModelHienThi = useMemo(
    () => (dsModel?.data ?? []).filter(m => !searchXe || m.model_name.toLowerCase().includes(searchXe.toLowerCase())),
    [dsModel, searchXe],
  );

  // ─── Tính tiền ────────────────────────────────────────────────────────────
  const variantChon  = modelChon?.variants?.find(v => v.ten === phienBanChon);
  const giaNiemYet   = (modelChon?.price_sell ?? 0) + (variantChon?.gia_chen_them ?? 0);

  const tongPhKien = useMemo(
    () => gioPhKien.reduce((sum, item) => {
      // Pin thuê: đại lý không thu tiền pin
      const isBattery = item.accessory.category === 'battery';
      if (isBattery && item.assignment_type === 'rent') return sum;
      return sum + item.line_total;
    }, 0),
    [gioPhKien],
  );

  // Tính số tiền giảm thực tế cho 1 KM theo applies_to + applicable_accessories
  // Trả về số dương (khoản giảm)
  const tinhGiamMotKM = (km: typeof khuyenMai[number]): number => {
    if (km.promo_type !== 'percent' && km.promo_type !== 'fixed') return 0;
    const appliesTo = km.applies_to ?? 'vehicle';

    const baseXe = (appliesTo === 'vehicle' || appliesTo === 'both') ? giaNiemYet : 0;

    let basePhKien = 0;
    if (appliesTo === 'accessory' || appliesTo === 'both') {
      const filter = km.applicable_accessories ?? null;
      basePhKien = gioPhKien.reduce((s, it) => {
        // Pin thuê: đại lý không thu tiền nên không tính vào base giảm
        if (it.accessory.category === 'battery' && it.assignment_type === 'rent') return s;
        // Có filter đích danh: chỉ tính phụ kiện được liệt kê
        if (filter && filter.length && !filter.includes(it.accessory.id)) return s;
        return s + it.line_total;
      }, 0);
    }

    const base = baseXe + basePhKien;
    if (base <= 0) return 0;

    if (km.promo_type === 'percent') {
      const giam = base * km.discount_percent / 100;
      return km.max_discount_cap ? Math.min(giam, km.max_discount_cap) : giam;
    }
    // fixed: không vượt quá base
    return Math.min(km.discount_amount, base);
  };

  const tongGiamGia = useMemo(() => {
    return -khuyenMai
      .filter(k => k._checked && (k.promo_type === 'percent' || k.promo_type === 'fixed'))
      .reduce((s, k) => s + tinhGiamMotKM(k), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khuyenMai, giaNiemYet, gioPhKien]);

  const tongThanhToan = Math.max(0, giaNiemYet + tongGiamGia + tongPhi + tongPhKien + tongDichVu);

  // Số tiền đưa trước cho trả góp (riêng cho mode tra_gop, không trùng với datCoc)
  const duaTruocNum = parseInt((traGop.dua_truoc || '').replace(/\D/g, '') || '0', 10);
  const datCocNum    = parseInt(datCoc.replace(/\D/g, '') || '0', 10);
  // Khi trả góp: số tiền cọc (deposit_amount) chính là đưa trước
  // Khi trả thẳng: dùng datCoc như cũ
  const tienCocFinal = hinhThuc === 'tra_gop' ? duaTruocNum : datCocNum;
  const conLaiNum    = Math.max(0, tongThanhToan - tienCocFinal);
  const tienKhachNum = parseInt(tienKhach.replace(/\D/g, '') || '0', 10);
  void tienKhachNum;

  // Đơn vị tài chính & lãi suất hiện tại
  const providerChon = useMemo(
    () => dsProviders.find(p => p.id === traGop.provider_id) ?? null,
    [dsProviders, traGop.provider_id],
  );
  const laiSuatThang = providerChon?.interest_rate_per_month ?? 0;

  // Số tiền vay = tổng - đưa trước
  const soTienVay = conLaiNum;

  // Trả mỗi tháng (lãi đơn): (vay + vay × lãi% × tháng) / tháng
  const tienTraGopThang = useMemo(() => {
    if (hinhThuc !== 'tra_gop' || traGop.so_thang === 0 || soTienVay === 0) return 0;
    const lai = soTienVay * (laiSuatThang / 100) * traGop.so_thang;
    return Math.round((soTienVay + lai) / traGop.so_thang);
  }, [hinhThuc, traGop.so_thang, laiSuatThang, soTienVay]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Tạo KH mới
  const taoKHMut = useMutation({
    mutationFn: (body: FormKhachMoi) => api.post('/customers', body).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`Đã tạo khách hàng ${data.full_name}`);
      setKhachHang(data);
      setSearchKH(data.full_name);
      setShowModalKH(false);
      setFormKhachMoi({ full_name: '', phone: '', id_card: '', address: '' });
      qc.invalidateQueries({ queryKey: ['kh-search'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo khách hàng'),
  });

  // Tạo / cập nhật đơn hàng
  const taodonMut = useMutation({
    mutationFn: (payload: any) =>
      isEditMode
        ? api.put(`/sales/${editOrderId}`, payload).then(r => r.data)
        : api.post('/sales', payload).then(r => r.data),
    onSuccess: async (data) => {
      const orderId = data.order?.id as string | undefined;

      // Upload hồ sơ đính kèm (nếu có) — chạy sau khi đã có order id
      if (orderId && fileHoSo.length > 0) {
        try {
          const fd = new FormData();
          fileHoSo.forEach(f => fd.append('files', f));
          await api.post(`/sales/${orderId}/attachments`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
          });
        } catch (err: any) {
          toast.error(`Đơn đã tạo nhưng tải file thất bại: ${err?.response?.data?.error || err.message}`);
        }
      }

      toast.success(
        isEditMode
          ? `✅ Đã cập nhật đơn ${data.order?.order_number ?? ''}`
          : `✅ Tạo đơn hàng ${data.order?.order_number ?? ''} thành công!`,
      );
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['sales-detail', editOrderId] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      navigate(`/sales/${orderId}`);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.response?.data?.details?.[0]?.msg || 'Lỗi xử lý đơn hàng';
      toast.error(msg);
    },
  });

  // Cảnh báo nếu SĐT khách mới trùng với KH đã có
  const phoneMoi = formKhachMoi.phone.replace(/\D/g, '');
  const { data: dsTrungSDT } = useQuery<{ data: Customer[] }>({
    queryKey: ['kh-check-trung', phoneMoi],
    queryFn: () => api.get('/customers', {
      params: { phone_exact: phoneMoi, limit: 5 },
    }).then(r => r.data),
    enabled: showModalKH && /^\d{9,}$/.test(phoneMoi),
    staleTime: 5000,
  });
  const danhSachTrung = dsTrungSDT?.data ?? [];

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const mapPaymentMethod = (pt: typeof phuongThuc): string => {
    if (pt === 'qr') return 'bank_transfer';
    if (hinhThuc === 'tra_gop') return 'installment';
    return pt;
  };

  const buildNotes = (): string => {
    const parts: string[] = [];
    if (ghiChu) parts.push(ghiChu);
    if (hinhThuc === 'tra_gop' && providerChon) {
      parts.push(
        `Trả góp ${providerChon.name}: ${traGop.so_thang} tháng × ${formatCurrency(tienTraGopThang)} ` +
        `(lãi ${laiSuatThang}%/tháng, vay ${formatCurrency(soTienVay)}, đưa trước ${formatCurrency(duaTruocNum)})`,
      );
    }
    return parts.join('\n');
  };

  // ─── Handlers ─────────────────────────────────────────────────────────────

  // Thêm phụ kiện vào giỏ (click lần đầu = thêm, click lại = tăng SL)
  // Block khi hết hàng hoặc vượt tồn kho
  const addPhKien = useCallback((pk: Accessory) => {
    if ((pk.qty_in_stock ?? 0) <= 0) {
      toast.error(`"${pk.name}" đã hết hàng`);
      return;
    }
    setGioPhKien(prev => {
      const idx = prev.findIndex(i => i.accessory.id === pk.id);
      if (idx >= 0) {
        const cur = prev[idx];
        const newQty = cur.quantity + 1;
        if (newQty > (pk.qty_in_stock ?? 0)) {
          toast.error(`"${pk.name}" chỉ còn ${pk.qty_in_stock} ${pk.unit}`);
          return prev;
        }
        return prev.map((i, n) => {
          if (n !== idx) return i;
          const isBattery = i.accessory.category === 'battery';
          return {
            ...i,
            quantity: newQty,
            line_total: newQty * i.unit_price,
            serial_numbers: isBattery ? [...(i.serial_numbers ?? []), ''] : i.serial_numbers,
          };
        });
      }
      const isBattery = pk.category === 'battery';
      return [...prev, {
        accessory: pk,
        quantity: 1,
        unit_price: pk.price_sell,
        line_total: pk.price_sell,
        serial_numbers:  isBattery ? [''] : undefined,
        assignment_type: isBattery ? 'purchase' : undefined,
      }];
    });
    toast.success(`Đã thêm: ${pk.name}`, { duration: 1500, icon: '🎁' });
  }, []);

  // Thay đổi số lượng phụ kiện (delta = +1 hoặc -1, SL = 0 → xóa)
  const changeQtyPhKien = useCallback((accessoryId: string, delta: number) => {
    setGioPhKien(prev =>
      prev
        .map(i => {
          if (i.accessory.id !== accessoryId) return i;
          const newQty = Math.max(0, i.quantity + delta);
          // Block tăng vượt tồn kho
          if (delta > 0 && newQty > (i.accessory.qty_in_stock ?? 0)) {
            toast.error(`"${i.accessory.name}" chỉ còn ${i.accessory.qty_in_stock} ${i.accessory.unit}`);
            return i;
          }
          const isBattery = i.accessory.category === 'battery';
          let serials = i.serial_numbers;
          if (isBattery) {
            serials = [...(i.serial_numbers ?? [])];
            while (serials.length < newQty) serials.push('');
            while (serials.length > newQty) serials.pop();
          }
          return { ...i, quantity: newQty, line_total: newQty * i.unit_price, serial_numbers: serials };
        })
        .filter(i => i.quantity > 0)
    );
  }, []);

  // Đặt serial cho 1 phụ kiện pin
  const setPinSerials = useCallback((accessoryId: string, serials: string[]) => {
    setGioPhKien(prev => prev.map(i =>
      i.accessory.id === accessoryId ? { ...i, serial_numbers: serials } : i
    ));
  }, []);
  const setPinAssignmentType = useCallback((accessoryId: string, t: 'purchase' | 'rent') => {
    setGioPhKien(prev => prev.map(i =>
      i.accessory.id === accessoryId ? { ...i, assignment_type: t } : i
    ));
  }, []);

  // Xóa phụ kiện khỏi giỏ
  const removePhKien = useCallback((accessoryId: string) => {
    setGioPhKien(prev => prev.filter(i => i.accessory.id !== accessoryId));
  }, []);

  const chonKhachHang = useCallback((kh: Customer) => {
    setKhachHang(kh);
    setSearchKH(kh.full_name);
    setShowKHDrop(false);
  }, []);

  const chonModel = useCallback((m: VehicleModel) => {
    setModelId(m.id);
    setMauChon('');
    setPhienBanChon('');
    setVehicleChon(null);
  }, []);

  const chonMau = useCallback((mau: string) => {
    setMauChon(mau);
    setVehicleChon(null);
    setShowVINDrop(false);
    // Tự động chọn xe đầu tiên của màu đó
  }, []);

  const chonVehicle = useCallback((v: InventoryVehicle) => {
    setVehicleChon(v);
    setShowVINDrop(false);
  }, []);

  const toggleKM = useCallback((id: string) => {
    setKhuyenMai(prev => prev.map(k => k.id === id ? { ...k, _checked: !k._checked } : k));
  }, []);

  const validate = (): boolean => {
    if (!khachHang)   { toast.error('Vui lòng chọn khách hàng');      return false; }
    if (!modelChon)   { toast.error('Vui lòng chọn mẫu xe');          return false; }
    if (modeDatCoc) {
      if (!mauYeuCau.trim()) { toast.error('Nhập màu khách yêu cầu'); return false; }
      if (datCocNum <= 0)    { toast.error('Nhập số tiền đặt cọc');   return false; }
    } else {
      if (!mauChon)     { toast.error('Vui lòng chọn màu xe');           return false; }
      if (soLuongConHang === 0) { toast.error('Màu này đã hết hàng — bật chế độ "Đặt cọc trước"'); return false; }
      if (!vehicleChon && dsXeTheoMau.length > 0) {
        // Tự chọn xe đầu tiên nếu chưa chọn cụ thể
        setVehicleChon(dsXeTheoMau[0]);
      }
      // Chặn lưu nếu xe đang trùng đơn khác và user không phải admin/manager
      if (coXungDot && !laAdminManager) {
        toast.error(`Xe này đã ở ${dsXungDot.length} đơn khác — chỉ admin / manager mới được lưu. Đổi xe khác hoặc nhờ quản lý.`);
        return false;
      }
    }
    if (hinhThuc === 'tra_gop') {
      if (!traGop.provider_id) { toast.error('Chọn đơn vị tài chính trả góp'); return false; }
      if (!providerChon)        { toast.error('Đơn vị tài chính không hợp lệ'); return false; }
      if (!providerChon.available_months.includes(traGop.so_thang)) {
        toast.error(`Kỳ hạn ${traGop.so_thang} tháng không hỗ trợ tại ${providerChon.name}`); return false;
      }
      // Kiểm tra đưa trước tối thiểu
      if (providerChon.min_down_payment_percent > 0 && tongThanhToan > 0) {
        const minDown = Math.ceil(tongThanhToan * providerChon.min_down_payment_percent / 100);
        if (duaTruocNum < minDown) {
          toast.error(`${providerChon.name} yêu cầu đưa trước tối thiểu ${formatCurrency(minDown)} (${providerChon.min_down_payment_percent}%)`);
          return false;
        }
      }
    }
    // Pin trong giỏ phải có đủ serial
    for (const it of gioPhKien) {
      if (it.accessory.category !== 'battery') continue;
      const filled = (it.serial_numbers ?? []).filter(s => s.trim()).length;
      if (filled !== it.quantity) {
        toast.error(`Pin "${it.accessory.name}": cần ${it.quantity} serial, đã nhập ${filled}`);
        return false;
      }
    }
    return true;
  };

  const buildPayload = () => {
    const xe = modeDatCoc ? null : (vehicleChon ?? dsXeTheoMau[0]);
    const ghiChuParts: string[] = [];
    if (modeDatCoc) {
      ghiChuParts.push(`[ĐẶT CỌC TRƯỚC] Khách yêu cầu màu: ${mauYeuCau.trim()}. Xe chưa về kho — gán VIN khi nhận hàng.`);
    }
    const ghiChuTuDong = ghiChuParts.join('\n');
    const notesCuoi = [ghiChuTuDong, buildNotes()].filter(Boolean).join('\n');

    return {
      customer_id:      khachHang!.id,
      salesperson_id:   user?.id,
      payment_method:   mapPaymentMethod(phuongThuc),
      discount_amount:  Math.abs(tongGiamGia),
      deposit_amount:   tienCocFinal,
      delivery_date:    ngayGiao || undefined,
      delivery_address: diaChiGiao || khachHang?.address || undefined,
      notes:            notesCuoi || undefined,
      items: [{
        vehicle_model_id:     modelChon!.id,
        inventory_vehicle_id: xe?.id,
        quantity:             1,
        unit_price:           giaNiemYet,
        discount_percent:     0,
        line_total:           giaNiemYet,
      }],
      // Phụ kiện đi kèm
      accessories: gioPhKien.map(i => ({
        accessory_id:    i.accessory.id,
        quantity:        i.quantity,
        unit_price:      i.unit_price,
        serial_numbers:  i.accessory.category === 'battery' ? i.serial_numbers : undefined,
        assignment_type: i.accessory.category === 'battery' ? i.assignment_type : undefined,
      })),
      // Khuyến mãi được chọn
      promotions: khuyenMai
        .filter(k => k._checked)
        .map(k => ({
          promotion_id:    k.id,
          promo_name:      k.name,
          promo_type:      k.promo_type,
          discount_amount: tinhGiamMotKM(k),
          gift_item_id:   k.gift_items?.id   ?? null,
          gift_item_name: k.gift_items?.name ?? null,
          gift_quantity:  k.gift_quantity ?? 0,
        })),
      // Phí cố định đang bật
      fees: dsFees.map(f => ({
        fee_key:   f.key,
        fee_label: f.label,
        amount:    f.amount,
      })),
      // Dịch vụ đăng ký đã chọn
      services: dsDichVu
        .filter(s => dichVuChon.has(s.id))
        .map(s => ({
          service_id:   s.id,
          service_name: s.name,
          price:        s.price,
        })),
    };
  };

  const handleLuu = () => {
    if (!validate()) return;
    taodonMut.mutate(buildPayload());
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="pos-wrapper">

      {/* ════ TOPBAR ════ */}
      <div className="pos-topbar">
        <div className="pos-topbar-left">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/sales')}>← Bán Hàng</button>
          <span className="pos-topbar-sep">›</span>
          <span className="pos-topbar-sub">{isEditMode ? `✏️ Sửa đơn ${orderEdit?.order_number ?? ''}` : 'Tạo đơn bán mới'}</span>
        </div>
        <div className="pos-topbar-center">
          <span className="pos-ngay-gio">
            📅 {new Date().toLocaleDateString('vi-VN')} &nbsp;
            {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="pos-topbar-right">
          <div className="pos-user-badge">
            <span className="pos-user-avatar">{getInitials(user?.full_name ?? 'NV')}</span>
            <div>
              <div className="pos-user-name">{user?.full_name ?? 'Nhân viên'}</div>
              <div className="pos-user-role">{user?.role ?? ''}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ════ CONTENT 3 CỘT ════ */}
      <div className="pos-content">

        {/* ══════ CỘT 1: Khách hàng ══════ */}
        <div className="pos-col">

          {/* ── Card 1: Khách hàng ── */}
          <div className="pos-card">
            <div className="pos-card-header">
              <span className="pos-step-badge">1</span>
              <span className="pos-card-title">Thông Tin Khách Hàng</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowModalKH(true)}>+ Thêm mới</button>
            </div>
            <div className="pos-card-body">
              <div className="pos-field">
                <label className="pos-label">Khách hàng <span className="pos-required">*</span></label>
                <div className="pos-input-wrap">
                  <input
                    className={`pos-input${khachHang ? ' pos-input-selected' : ''}`}
                    placeholder="Nhập SĐT khách hàng (≥ 9 số)..."
                    inputMode="numeric"
                    value={searchKH}
                    onChange={e => {
                      // Chỉ giữ chữ số
                      const val = e.target.value.replace(/\D/g, '');
                      setSearchKH(val);
                      setShowKHDrop(true);
                      if (!val) setKhachHang(null);
                    }}
                    onFocus={() => searchKH && setShowKHDrop(true)}
                    onBlur={() => setTimeout(() => setShowKHDrop(false), 180)}
                  />
                  <span className="pos-input-icon">
                    {fetchingKH ? <span className="pos-spin" /> : '🔍'}
                  </span>
                  {showKHDrop && (dsKH?.data?.length ?? 0) > 0 && (
                    <div className="pos-dropdown">
                      {dsKH!.data.map(kh => (
                        <div key={kh.id} className="pos-dropdown-item" onMouseDown={() => chonKhachHang(kh)}>
                          <div className="pos-dropdown-name">{kh.full_name}</div>
                          <div className="pos-dropdown-sub">{kh.phone} · {kh.customer_code}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {khachHang ? (
                <div className="pos-kh-card">
                  <div className="pos-kh-avatar">{getInitials(khachHang.full_name)}</div>
                  <div className="pos-kh-info">
                    <div className="pos-kh-name">{khachHang.full_name}</div>
                    <div className="pos-kh-meta">📞 {khachHang.phone}</div>
                    {khachHang.address && <div className="pos-kh-meta">📍 {khachHang.address}</div>}
                  </div>
                  <button className="pos-kh-clear" onClick={() => { setKhachHang(null); setSearchKH(''); }} title="Xoá chọn">×</button>
                </div>
              ) : (
                <>
                  <div className="pos-field">
                    <label className="pos-label">Số điện thoại</label>
                    <div className="pos-input-wrap"><input className="pos-input" placeholder="0987 123 456" readOnly /><span className="pos-input-icon">📞</span></div>
                  </div>
                  <div className="pos-field">
                    <label className="pos-label">CCCD/CMND</label>
                    <div className="pos-input-wrap"><input className="pos-input" placeholder="079123456789" readOnly /><span className="pos-input-icon">🪪</span></div>
                  </div>
                  <div className="pos-field">
                    <label className="pos-label">Địa chỉ</label>
                    <div className="pos-input-wrap"><input className="pos-input" placeholder="Địa chỉ khách hàng" readOnly /><span className="pos-input-icon">📍</span></div>
                  </div>
                </>
              )}

              <div className={`pos-loyalty-box${khachHang ? ' has-data' : ''}`}>
                <span>🏆</span>
                <span>{khachHang ? `Điểm tích lũy: ${khachHang.loyalty_points} điểm` : 'Chưa chọn khách hàng'}</span>
              </div>
            </div>
          </div>

          {/* ── Card 3: Khuyến mãi ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">3</span>
              <span className="pos-card-title">Khuyến Mãi &amp; Quà Tặng</span>
              {khuyenMai.length > 0 && (
                <span className="badge badge-blue" style={{ fontSize: 11 }}>
                  {khuyenMai.filter(k => k._checked).length}/{khuyenMai.length} đã chọn
                </span>
              )}
            </div>
            <div className="pos-card-body">
              {khuyenMai.length === 0 ? (
                <div className="pos-km-empty">
                  {modelChon ? 'Không có chương trình khuyến mãi phù hợp' : 'Chọn mẫu xe để xem khuyến mãi áp dụng'}
                </div>
              ) : (<>
                <div className="pos-km-header-row">
                  <span style={{ flex: 1 }}>Tên chương trình</span>
                  <span style={{ width: 90 }}>Loại</span>
                  <span style={{ width: 120, textAlign: 'right' }}>Ưu đãi</span>
                </div>
                {khuyenMai.map(km => {
                  const isMoneyPromo = km.promo_type === 'percent' || km.promo_type === 'fixed';
                  const appliesTo    = km.applies_to ?? 'vehicle';
                  const scopeLabel   =
                    appliesTo === 'accessory' ? '🛍️ Phụ kiện' :
                    appliesTo === 'both'      ? '📦 Xe + PK' :
                    null;  // 'vehicle' = ngầm hiểu, không hiển thị gì
                  const accFilter = km.applicable_accessories ?? null;
                  const scopeHint = isMoneyPromo && accFilter && accFilter.length
                    ? ` (${accFilter.length} phụ kiện đích danh)`
                    : '';
                  return (
                  <div key={km.id} className={`pos-km-row${km._checked ? ' checked' : ''}`}>
                    <input type="checkbox" className="pos-km-check" checked={km._checked} onChange={() => toggleKM(km.id)} />
                    <span className="pos-km-ten">
                      {km.name}
                      {km.min_order_amount > 0 && <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>(đơn ≥ {km.min_order_amount.toLocaleString('vi-VN')} ₫)</span>}
                      {scopeLabel && (
                        <span style={{
                          marginLeft: 6, padding: '1px 6px', borderRadius: 4,
                          background: appliesTo === 'accessory' ? '#dcfce7' : '#f3e8ff',
                          color:      appliesTo === 'accessory' ? '#166534' : '#6b21a8',
                          fontSize: 11, fontWeight: 600,
                        }}>
                          {scopeLabel}{scopeHint}
                        </span>
                      )}
                    </span>
                    <span className={`badge pos-km-loai ${km.promo_type === 'percent' ? 'badge-blue' : km.promo_type === 'fixed' ? 'badge-green' : 'badge-purple'}`}>
                      {km.promo_type === 'percent' ? 'Giảm %' : km.promo_type === 'fixed' ? 'Giảm tiền' : km.promo_type === 'gift' ? 'Quà tặng' : 'Combo'}
                    </span>
                    <span className="pos-km-gia text-danger">
                      {km.promo_type === 'percent' ? `-${km.discount_percent}%`
                        : km.promo_type === 'fixed' ? `-${km.discount_amount.toLocaleString('vi-VN')} ₫`
                        : `🎁 ${km.gift_items?.name ?? 'Quà tặng'}`}
                    </span>
                  </div>
                  );
                })}
                {(() => {
                  const dsQua = khuyenMai.filter(k => k._checked && (k.promo_type === 'gift' || k.promo_type === 'combo') && k.gift_items);
                  if (!dsQua.length) return null;
                  return (
                    <div style={{ marginTop: 10, borderTop: '1px dashed #e2e8f0', paddingTop: 8 }}>
                      <div style={{ fontSize: 12, color: '#718096', marginBottom: 6, fontWeight: 600 }}>🎁 Quà tặng kèm theo chương trình:</div>
                      {dsQua.map(km => (
                        <div key={km.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13 }}>
                          <span style={{ color: '#805ad5', fontSize: 16 }}>🎁</span>
                          <span style={{ flex: 1 }}>{km.gift_items!.name}</span>
                          <span style={{ background: '#f3e8ff', color: '#6b21a8', borderRadius: 6, padding: '1px 8px', fontSize: 12 }}>
                            ×{km.gift_quantity} {km.gift_items?.category ? `(${km.gift_items.category})` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>)}
            </div>
          </div>

        </div>

        {/* ══════ CỘT 2 (1fr): Chọn xe + PK + DV + Ghi chú ══════ */}
        <div className="pos-col">

          {/* ── Card 2: Chọn xe ── */}
          <div className="pos-card pos-card-tall">
            <div className="pos-card-header">
              <span className="pos-step-badge">2</span>
              <span className="pos-card-title">Chọn Xe &amp; Phiên Bản</span>
              <div className="pos-input-wrap" style={{ width: 190 }}>
                <input className="pos-input pos-input-sm" placeholder="Tìm kiếm xe..." value={searchXe} onChange={e => setSearchXe(e.target.value)} />
                <span className="pos-input-icon">🔍</span>
              </div>
            </div>
            <div className="pos-xe-layout">
              <div className="pos-xe-list">
                <div className="pos-xe-list-title">Dòng xe</div>
                {loadingModel ? (
                  <div className="pos-xe-skeleton"><div className="pos-skel" /><div className="pos-skel" /><div className="pos-skel" /></div>
                ) : dsModelHienThi.length === 0 ? (
                  <div className="pos-xe-empty">Không tìm thấy</div>
                ) : dsModelHienThi.map(m => (
                  <button key={m.id} className={`pos-xe-item${modelId === m.id ? ' active' : ''}`} onClick={() => chonModel(m)}>
                    <span className="pos-xe-icon">🛵</span>
                    <span className="pos-xe-name">{m.model_name}</span>
                  </button>
                ))}
              </div>

              <div className="pos-xe-detail">
                {!modelChon ? (
                  <div className="pos-xe-placeholder"><span>🏍️</span><span>Chọn dòng xe bên trái</span></div>
                ) : (
                  <>
                    <div className="pos-xe-detail-header">
                      <span className="pos-xe-detail-title">Thông tin xe</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={`badge ${soLuongConHang > 0 ? 'badge-green' : 'badge-red'}`}>
                          {loadingVehicle ? '...' : `Còn hàng: ${soLuongConHang}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setModeDatCoc(v => !v);
                            if (!modeDatCoc) {
                              setMauChon('');
                              setVehicleChon(null);
                            } else {
                              setMauYeuCau('');
                            }
                          }}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                            cursor: 'pointer',
                            border: `1.5px solid ${modeDatCoc ? '#f59e0b' : '#e5e7eb'}`,
                            background: modeDatCoc ? '#fef3c7' : '#fff',
                            color: modeDatCoc ? '#92400e' : '#6b7280',
                          }}
                          title="Đặt cọc trước khi xe chưa về kho"
                        >
                          {modeDatCoc ? '✓ Đặt cọc trước' : '📋 Đặt cọc trước'}
                        </button>
                      </div>
                    </div>
                    <div className="pos-xe-img-wrap">
                      {modelChon.image_url
                        ? <img src={modelChon.image_url} alt={modelChon.model_name} className="pos-xe-img" />
                        : <span className="pos-xe-img-ph">🛵</span>
                      }
                    </div>
                    <div className="pos-xe-detail-name">{modelChon.brand} {modelChon.model_name}</div>
                    <div className="pos-xe-detail-price">{formatCurrency(modelChon.price_sell)}</div>

                    <div className="pos-mau-label">
                      {modeDatCoc ? 'Màu khách yêu cầu' : 'Màu sắc (có sẵn trong kho)'}
                    </div>
                    {modeDatCoc ? (
                      <div className="pos-input-wrap">
                        <input
                          className="pos-input"
                          placeholder="Nhập màu khách yêu cầu (VD: Xanh Sapphire)"
                          value={mauYeuCau}
                          onChange={e => setMauYeuCau(e.target.value)}
                        />
                        <span className="pos-input-icon">🎨</span>
                      </div>
                    ) : loadingVehicle ? (
                      <div className="pos-mau-loading">Đang tải màu sắc...</div>
                    ) : dauMauCoHang.length === 0 ? (
                      <div className="pos-mau-empty">
                        Hết hàng tất cả màu — bật "Đặt cọc trước" để vẫn lập đơn
                      </div>
                    ) : (
                      <div className="pos-mau-row">
                        {dauMauCoHang.map(mau => {
                          const soLuong = (dsVehicleAll?.data ?? []).filter(v => v.color === mau).length;
                          return (
                            <button key={mau} className={`pos-mau-btn${mauChon === mau ? ' active' : ''}`}
                              style={{ '--mau-color': mauToHex(mau) } as any}
                              onClick={() => chonMau(mau)} title={`${mau} (${soLuong} xe)`}>
                              <span className="pos-mau-dot" />
                              {mauChon === mau && <span className="pos-mau-check">✓</span>}
                            </button>
                          );
                        })}
                        <span className="pos-mau-ten">{mauChon || 'Chọn màu'}</span>
                        {mauChon && <span className="pos-mau-count">({dsXeTheoMau.length} xe)</span>}
                      </div>
                    )}

                    {modeDatCoc && (
                      <div style={{
                        marginTop: 10, padding: '10px 12px', background: '#fef3c7',
                        border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e',
                      }}>
                        <strong>📋 Chế độ đặt cọc trước</strong>
                        <div style={{ marginTop: 4, fontSize: 12, marginBottom: 10 }}>
                          Đơn này lập trước khi xe về kho. Khi xe về, mở đơn để gán VIN cụ thể trước khi giao.
                        </div>
                        <label className="pos-label" style={{ color: '#92400e' }}>
                          Số tiền đặt cọc <span className="pos-required">*</span>
                        </label>
                        <div className="pos-input-wrap">
                          <input
                            className="pos-input pos-input-money"
                            placeholder="0"
                            value={datCoc}
                            onChange={e => {
                              const raw = e.target.value.replace(/\D/g, '');
                              setDatCoc(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                            }}
                          />
                          <span className="pos-input-icon">₫</span>
                        </div>
                      </div>
                    )}

                    {(modelChon?.variants?.length ?? 0) > 0 && (
                      <div className="pos-field" style={{ marginTop: 10 }}>
                        <label className="pos-label">Phiên bản</label>
                        <div className="pos-variant-row">
                          <button type="button" className={`pos-variant-btn${phienBanChon === '' ? ' active' : ''}`} onClick={() => setPhienBanChon('')}>
                            <span className="pos-variant-ten">Tiêu chuẩn</span>
                            <span className="pos-variant-gia">{formatCurrency(modelChon!.price_sell)}</span>
                          </button>
                          {modelChon!.variants!.map(v => (
                            <button type="button" key={v.ten} className={`pos-variant-btn${phienBanChon === v.ten ? ' active' : ''}`} onClick={() => setPhienBanChon(v.ten)}>
                              <span className="pos-variant-ten">{v.ten}</span>
                              <span className="pos-variant-gia">{formatCurrency(modelChon!.price_sell + v.gia_chen_them)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!modeDatCoc && mauChon && dsXeTheoMau.length > 0 && (
                      <div className="pos-field" style={{ marginTop: 10 }}>
                        <label className="pos-label">Chọn xe cụ thể (VIN)</label>
                        <div className="pos-input-wrap">
                          <select className="pos-input" value={vehicleChon?.id ?? ''}
                            onChange={e => { const xe = dsXeTheoMau.find(v => v.id === e.target.value); if (xe) chonVehicle(xe); }}>
                            <option value="">— Tự động chọn xe đầu tiên —</option>
                            {dsXeTheoMau.map(v => (
                              <option key={v.id} value={v.id}>{v.vin} {v.engine_number ? `· ${v.engine_number}` : ''}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {!modeDatCoc && (vehicleChon ?? dsXeTheoMau[0]) && (
                      <div className="pos-vin-row">
                        <div className="pos-vin-group">
                          <label className="pos-label">Số khung (VIN)</label>
                          <div className={`pos-vin-box ${coXungDot ? 'pos-vin-conflict-box' : 'pos-vin-ok-box'}`}>
                            <span className="pos-vin-status" style={coXungDot ? { color: '#dc2626' } : undefined}>
                              {coXungDot ? '⚠ Đang ở đơn khác' : '✓ Hợp lệ · Còn hàng'}
                            </span>
                            <span className="pos-vin-val">{(vehicleChon ?? dsXeTheoMau[0])?.vin}</span>
                          </div>
                        </div>
                        <div className="pos-vin-group">
                          <label className="pos-label">Số máy</label>
                          <div className="pos-vin-box">
                            <span className="pos-vin-val pos-vin-gray">{(vehicleChon ?? dsXeTheoMau[0])?.engine_number ?? '—'}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Cảnh báo xung đột — VIN đang nằm trong đơn khác */}
                    {!modeDatCoc && coXungDot && (
                      <div style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        background: '#fef2f2',
                        border: '1.5px solid #fecaca',
                        borderRadius: 8,
                        color: '#991b1b',
                        fontSize: 12.5,
                        lineHeight: 1.55,
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
                          ⚠️ Xe này đã được chọn ở {dsXungDot.length} đơn khác
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {dsXungDot.map(o => (
                            <div key={o.id} style={{
                              background: '#fff',
                              border: '1px solid #fecaca',
                              borderRadius: 6,
                              padding: '6px 10px',
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#7f1d1d' }}>
                                  {o.order_number}
                                </span>
                                <span style={{
                                  fontSize: 11, fontWeight: 600,
                                  padding: '1px 8px', borderRadius: 99,
                                  background: o.status === 'deposit_paid' ? '#fef3c7' : o.status === 'confirmed' ? '#dbeafe' : '#f3f4f6',
                                  color:      o.status === 'deposit_paid' ? '#92400e' : o.status === 'confirmed' ? '#1e40af' : '#374151',
                                }}>
                                  {o.status === 'draft' ? 'Mở' : o.status === 'confirmed' ? 'Đã xác nhận' : 'Đã cọc'}
                                </span>
                              </div>
                              <div style={{ marginTop: 3, color: '#7f1d1d' }}>
                                👤 {o.customers?.full_name ?? '—'}
                                {o.customers?.phone ? ` · ${o.customers.phone}` : ''}
                                {o.users?.full_name ? ` · NV: ${o.users.full_name}` : ''}
                              </div>
                              {(o.deposit_amount ?? 0) > 0 && (
                                <div style={{ color: '#7f1d1d' }}>💰 Đã cọc: {formatCurrency(o.deposit_amount)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                        {!laAdminManager && (
                          <div style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: '1px dashed #fca5a5',
                            fontWeight: 600,
                          }}>
                            🔒 Chỉ admin / manager mới được lưu đơn khi xe đang trùng. Hãy đổi xe khác hoặc nhờ quản lý xác nhận.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Card 4: Phụ Kiện Bán Kèm ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge pos-step-badge-pk">4</span>
              <span className="pos-card-title">Phụ Kiện Bán Kèm</span>
              {gioPhKien.length > 0 && <span className="pos-pk-header-badge">{gioPhKien.length} loại</span>}
            </div>
            <div className="pos-card-body">
              {!modelChon ? (
                <div className="pos-pk-hint">← Chọn dòng xe để xem phụ kiện tương thích</div>
              ) : loadingPK ? (
                <div className="pos-pk-loading"><span className="pos-spin" /> Đang tải phụ kiện...</div>
              ) : (dsPhKien?.data?.length ?? 0) === 0 ? (
                <div className="pos-pk-hint">Không có phụ kiện nào</div>
              ) : (
                <>
                  <div className="pos-pk-cats">
                    <button className={`pos-pk-cat-btn${filterCatPK === '' ? ' active' : ''}`} onClick={() => setFilterCatPK('')}>Tất cả</button>
                    {[...new Set(dsPhKien!.data.map(p => p.category))].map(cat => (
                      <button key={cat} className={`pos-pk-cat-btn${filterCatPK === cat ? ' active' : ''}`}
                        onClick={() => setFilterCatPK(prev => prev === cat ? '' : cat)}>
                        {ACCESSORY_CATEGORY[cat]?.label ?? cat}
                      </button>
                    ))}
                  </div>
                  <div className="pos-pk-grid">
                    {dsPhKien!.data.filter(p => !filterCatPK || p.category === filterCatPK).map(pk => {
                      const inCart = gioPhKien.find(i => i.accessory.id === pk.id);
                      const stock  = pk.qty_in_stock ?? 0;
                      const outOfStock = stock <= 0;
                      return (
                        <button
                          key={pk.id}
                          type="button"
                          className={`pos-pk-item${inCart ? ' pos-pk-item-selected' : ''}`}
                          onClick={() => addPhKien(pk)}
                          disabled={outOfStock}
                          title={outOfStock ? `${pk.name} — đã hết hàng` : (pk.description ?? pk.name)}
                          style={outOfStock ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                        >
                          <div className="pos-pk-img">
                            {pk.image_url ? <img src={pk.image_url} alt={pk.name} /> : <span className="pos-pk-icon-ph">{ACCESSORY_CATEGORY[pk.category]?.icon ?? '📦'}</span>}
                            {inCart && <span className="pos-pk-qty-bubble">{inCart.quantity}</span>}
                            {outOfStock && (
                              <span style={{
                                position: 'absolute', top: 4, right: 4,
                                background: '#dc2626', color: '#fff',
                                padding: '1px 6px', borderRadius: 99,
                                fontSize: 10, fontWeight: 700,
                              }}>HẾT</span>
                            )}
                          </div>
                          <div className="pos-pk-info">
                            <span className="pos-pk-name">{pk.name}</span>
                            <span className="pos-pk-price">{formatCurrency(pk.price_sell)}</span>
                            <span className="pos-pk-unit">/{pk.unit}</span>
                            <span style={{
                              fontSize: 10, marginTop: 2,
                              color: outOfStock ? '#dc2626' : stock <= 5 ? '#d97706' : '#059669',
                              fontWeight: 600,
                            }}>
                              {outOfStock ? '❌ Hết hàng' : `Còn ${stock} ${pk.unit}`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {gioPhKien.length > 0 && (
                    <div className="pos-pk-cart">
                      <div className="pos-pk-cart-header">Đã chọn</div>
                      {gioPhKien.map(item => {
                        const isBattery = item.accessory.category === 'battery';
                        const isRent    = isBattery && item.assignment_type === 'rent';
                        return (
                          <div key={item.accessory.id}>
                            <div className="pos-pk-cart-row">
                              <span className="pos-pk-cart-icon">{ACCESSORY_CATEGORY[item.accessory.category]?.icon ?? '📦'}</span>
                              <span className="pos-pk-cart-name">
                                {item.accessory.name}
                                {isRent && <span style={{ color: '#6d28d9', fontSize: 10, fontWeight: 600 }}> (thuê)</span>}
                              </span>
                              <div className="pos-pk-qty-ctrl">
                                <button onClick={() => changeQtyPhKien(item.accessory.id, -1)}>−</button>
                                <span>{item.quantity}</span>
                                <button onClick={() => changeQtyPhKien(item.accessory.id, +1)}>+</button>
                              </div>
                              <span className="pos-pk-cart-total">
                                {isRent ? '0 ₫' : formatCurrency(item.line_total)}
                              </span>
                              <button className="pos-pk-cart-del" onClick={() => removePhKien(item.accessory.id)}>×</button>
                            </div>
                            {isBattery && (
                              <div style={{ padding: '0 8px 8px' }}>
                                <BatterySerialInput
                                  quantity={item.quantity}
                                  serials={item.serial_numbers ?? []}
                                  assignmentType={item.assignment_type ?? 'purchase'}
                                  onChangeSerials={(s) => setPinSerials(item.accessory.id, s)}
                                  onChangeType={(t) => setPinAssignmentType(item.accessory.id, t)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="pos-pk-cart-sum">
                        <span>Tổng phụ kiện</span>
                        <span>{formatCurrency(tongPhKien)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Card 5: Dịch vụ đăng ký ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">5</span>
              <span className="pos-card-title">Dịch Vụ Đăng Ký</span>
              {dichVuChon.size > 0 && (
                <span className="badge badge-blue" style={{ fontSize: 11 }}>{dichVuChon.size} đã chọn · +{formatCurrency(tongDichVu)}</span>
              )}
            </div>
            <div className="pos-card-body">
              {dsDichVu.length === 0 ? (
                <div className="pos-km-empty">Chưa có dịch vụ nào — thêm tại trang Cấu hình</div>
              ) : dsDichVu.map(sv => {
                const checked = dichVuChon.has(sv.id);
                return (
                  <div key={sv.id} className={`pos-km-row${checked ? ' checked' : ''}`} style={{ cursor: 'pointer' }}
                    onClick={() => setDichVuChon(prev => { const next = new Set(prev); next.has(sv.id) ? next.delete(sv.id) : next.add(sv.id); return next; })}>
                    <input type="checkbox" className="pos-km-check" readOnly checked={checked} />
                    <span className="pos-km-ten">
                      {sv.name}
                      {sv.description && <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>— {sv.description}</span>}
                    </span>
                    <span className="pos-km-gia" style={{ color: '#6366f1', minWidth: 90, textAlign: 'right' }}>+{formatCurrency(sv.price)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Card 6: Ghi chú & Giao hàng ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">6</span>
              <span className="pos-card-title">Ghi Chú &amp; Thông Tin Giao Xe</span>
            </div>
            <div className="pos-ghichu-layout">
              <div>
                <div className="pos-field">
                  <label className="pos-label">Ghi chú đơn hàng</label>
                  <textarea className="pos-input pos-textarea" placeholder="Ghi chú thêm cho đơn hàng..." value={ghiChu} onChange={e => setGhiChu(e.target.value)} rows={3} />
                </div>
                <div className="pos-field">
                  <label className="pos-label">Hồ sơ đính kèm</label>
                  <label className="pos-upload-area">
                    <input type="file" multiple style={{ display: 'none' }} onChange={e => setFileHoSo(prev => [...prev, ...Array.from(e.target.files ?? [])])} />
                    <span>📎</span>
                    <span>{fileHoSo.length > 0 ? `${fileHoSo.length} tệp đã chọn` : 'Click để chọn file'}</span>
                  </label>
                </div>
              </div>
              <div>
                <div className="pos-field">
                  <label className="pos-label">Ngày giao xe dự kiến</label>
                  <input className="pos-input" type="date" value={ngayGiao} min={NGAY_HIEN_TAI} onChange={e => setNgayGiao(e.target.value)} />
                </div>
                <div className="pos-field">
                  <label className="pos-label">Địa chỉ giao xe</label>
                  <textarea className="pos-input pos-textarea" rows={2} placeholder="Địa chỉ giao xe (mặc định địa chỉ KH)" value={diaChiGiao} onChange={e => setDiaChiGiao(e.target.value)} />
                </div>
                <div className="pos-tl-list">
                  <label className="pos-label">Tài liệu xuất kèm</label>
                  {['Hóa đơn bán hàng', 'Hợp đồng mua bán', 'Phiếu bảo hành', 'Biên bản giao xe'].map(tl => (
                    <div key={tl} className="pos-tl-item"><span className="pos-tl-check">✓</span><span>{tl}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ══════ CỘT 3: Thanh toán ══════ */}
        <div className="pos-col pos-col-narrow">

          {/* ── Card 7: Thanh toán & Tổng hợp ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">7</span>
              <span className="pos-card-title">Thanh Toán &amp; Tổng Hợp</span>
            </div>
            <div className="pos-card-body">
              <div className="pos-section-label">Hình thức thanh toán</div>
              <div className="pos-hinhthuc-row">
                <button className={`pos-hinhthuc-btn${hinhThuc === 'tra_thang' ? ' active' : ''}`} onClick={() => { setHinhThuc('tra_thang'); setPhuongThuc('cash'); }}>
                  <span>💵</span> Trả thẳng
                </button>
                <button className={`pos-hinhthuc-btn${hinhThuc === 'tra_gop' ? ' active' : ''}`} onClick={() => { setHinhThuc('tra_gop'); setPhuongThuc('installment'); }}>
                  <span>🏦</span> Trả góp
                </button>
              </div>

              {hinhThuc === 'tra_gop' && (
                <div className="pos-tragop-form">
                  <div className="pos-field">
                    <label className="pos-label">Đơn vị tài chính <span className="pos-required">*</span></label>
                    <select
                      className="pos-input pos-input-sm"
                      value={traGop.provider_id}
                      onChange={e => {
                        const p = dsProviders.find(x => x.id === e.target.value);
                        setTraGop(prev => ({
                          ...prev,
                          provider_id: e.target.value,
                          so_thang: p?.default_months ?? prev.so_thang,
                        }));
                      }}
                    >
                      <option value="">— Chọn đơn vị tài chính —</option>
                      {dsProviders.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.interest_rate_per_month}%/tháng
                        </option>
                      ))}
                    </select>
                    {dsProviders.length === 0 && (
                      <small style={{ color: '#dc2626', fontSize: 11 }}>
                        Chưa cấu hình đơn vị tài chính. Vào Cấu hình → Đơn vị tài chính để thêm.
                      </small>
                    )}
                  </div>

                  <div className="pos-field">
                    <label className="pos-label">Số tiền đưa trước</label>
                    <div className="pos-input-wrap">
                      <input
                        className="pos-input pos-input-sm pos-input-money"
                        placeholder="0"
                        value={traGop.dua_truoc}
                        onChange={e => {
                          const raw = e.target.value.replace(/\D/g, '');
                          setTraGop(p => ({
                            ...p,
                            dua_truoc: raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '',
                          }));
                        }}
                      />
                      <span className="pos-input-icon">₫</span>
                    </div>
                    {providerChon && providerChon.min_down_payment_percent > 0 && tongThanhToan > 0 && (
                      <small style={{ fontSize: 11, color: '#6b7280' }}>
                        Tối thiểu: {formatCurrency(Math.ceil(tongThanhToan * providerChon.min_down_payment_percent / 100))}
                        {' '}({providerChon.min_down_payment_percent}% tổng đơn)
                      </small>
                    )}
                  </div>

                  {providerChon && (
                    <div className="pos-field">
                      <label className="pos-label">Kỳ hạn vay</label>
                      <select
                        className="pos-input pos-input-sm"
                        value={traGop.so_thang}
                        onChange={e => setTraGop(p => ({ ...p, so_thang: +e.target.value }))}
                      >
                        {(providerChon.available_months ?? []).map(n => (
                          <option key={n} value={n}>{n} tháng</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {providerChon && soTienVay > 0 && (
                    <div style={{
                      background: '#f0f9ff', border: '1px solid #bae6fd',
                      borderRadius: 8, padding: '10px 12px', marginTop: 8,
                      display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#0369a1' }}>Số tiền vay:</span>
                        <strong style={{ color: '#0c4a6e' }}>{formatCurrency(soTienVay)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                        <span>Lãi suất {laiSuatThang}%/tháng × {traGop.so_thang} tháng</span>
                        <span>= +{formatCurrency(Math.round(soTienVay * laiSuatThang / 100 * traGop.so_thang))}</span>
                      </div>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        borderTop: '1px solid #bae6fd', paddingTop: 6, marginTop: 2,
                      }}>
                        <span style={{ color: '#0369a1', fontWeight: 600 }}>Trả mỗi tháng:</span>
                        <strong style={{ color: '#dc2626', fontSize: 15 }}>{formatCurrency(tienTraGopThang)}</strong>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pos-price-table">
                {/* ─── Xe ─── */}
                {modelChon ? (
                  <>
                    <div className="pos-price-section-title">🏍️ Xe</div>
                    <div className="pos-price-row">
                      <span>Giá niêm yết {modelChon.model_name}</span>
                      <span>{formatCurrency(modelChon.price_sell ?? 0)}</span>
                    </div>
                    {variantChon && variantChon.gia_chen_them !== 0 && (
                      <div className="pos-price-row pos-price-row-sub">
                        <span>↳ Phiên bản {phienBanChon}</span>
                        <span>{variantChon.gia_chen_them > 0 ? '+' : ''}{formatCurrency(variantChon.gia_chen_them)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pos-price-row" style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                    <span>Chưa chọn xe</span><span>—</span>
                  </div>
                )}

                {/* ─── Phụ kiện ─── */}
                {gioPhKien.length > 0 && (
                  <>
                    <div className="pos-price-section-title">🛒 Phụ kiện ({gioPhKien.length} loại)</div>
                    {gioPhKien.map(item => {
                      const isBattery = item.accessory.category === 'battery';
                      const isRent = isBattery && item.assignment_type === 'rent';
                      return (
                        <div key={item.accessory.id} className="pos-price-row pos-price-row-sub">
                          <span>
                            {item.accessory.name} × {item.quantity}
                            {isBattery && (
                              <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
                                ({isRent ? 'Thuê' : 'Mua'})
                              </span>
                            )}
                          </span>
                          <span style={{ color: isRent ? '#9ca3af' : undefined }}>
                            {isRent ? '—' : formatCurrency(item.line_total)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="pos-price-row pos-price-row-subtotal">
                      <span>Tổng phụ kiện</span>
                      <span>{formatCurrency(tongPhKien)}</span>
                    </div>
                  </>
                )}

                {/* ─── Phí ─── */}
                {dsFees.length > 0 && (
                  <>
                    <div className="pos-price-section-title">💼 Phí</div>
                    {dsFees.map(f => (
                      <div key={f.id} className="pos-price-row pos-price-row-sub">
                        <span>{f.label}</span>
                        <span>{formatCurrency(f.amount)}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* ─── Dịch vụ đăng ký ─── */}
                {dsDichVu.filter(s => dichVuChon.has(s.id)).length > 0 && (
                  <>
                    <div className="pos-price-section-title">📋 Dịch vụ đăng ký</div>
                    {dsDichVu.filter(s => dichVuChon.has(s.id)).map(s => (
                      <div key={s.id} className="pos-price-row pos-price-row-sub" style={{ color: '#6366f1' }}>
                        <span>{s.name}</span>
                        <span>{formatCurrency(s.price)}</span>
                      </div>
                    ))}
                    <div className="pos-price-row pos-price-row-subtotal">
                      <span>Tổng dịch vụ</span>
                      <span>{formatCurrency(tongDichVu)}</span>
                    </div>
                  </>
                )}

                {/* ─── Khuyến mãi giảm giá ─── */}
                {khuyenMai.filter(k => k._checked && (k.promo_type === 'percent' || k.promo_type === 'fixed')).length > 0 && (
                  <>
                    <div className="pos-price-section-title" style={{ color: '#dc2626' }}>🏷️ Khuyến mãi</div>
                    {khuyenMai.filter(k => k._checked && (k.promo_type === 'percent' || k.promo_type === 'fixed')).map(km => {
                      const giam = tinhGiamMotKM(km);
                      const phamVi = km.applies_to === 'accessory' ? 'phụ kiện' : km.applies_to === 'both' ? 'xe + phụ kiện' : 'xe';
                      const cachTinh = km.promo_type === 'percent'
                        ? `${km.discount_percent}% trên ${phamVi}`
                        : `Cố định trên ${phamVi}`;
                      return (
                        <div key={km.id} className="pos-price-row pos-price-row-sub" style={{ color: '#dc2626' }}>
                          <span>
                            {km.name}
                            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>({cachTinh})</span>
                          </span>
                          <span>−{formatCurrency(giam)}</span>
                        </div>
                      );
                    })}
                    <div className="pos-price-row pos-price-row-subtotal" style={{ color: '#dc2626' }}>
                      <span>Tổng giảm</span>
                      <span>{formatCurrency(tongGiamGia)}</span>
                    </div>
                  </>
                )}

                {/* ─── Quà tặng kèm ─── */}
                {khuyenMai.filter(k => k._checked && (k.promo_type === 'gift' || k.promo_type === 'combo') && k.gift_items).length > 0 && (
                  <>
                    <div className="pos-price-section-title" style={{ color: '#7c3aed' }}>🎁 Quà tặng kèm</div>
                    {khuyenMai.filter(k => k._checked && (k.promo_type === 'gift' || k.promo_type === 'combo') && k.gift_items).map(km => (
                      <div key={km.id} className="pos-price-row pos-price-row-sub" style={{ color: '#6b21a8' }}>
                        <span>{km.gift_items!.name} × {km.gift_quantity}</span>
                        <span style={{ fontSize: 12, fontStyle: 'italic' }}>Tặng kèm</span>
                      </div>
                    ))}
                  </>
                )}

                <div className="pos-price-total-row">
                  <span>Tổng thanh toán</span>
                  <span className="pos-price-total">{formatCurrency(tongThanhToan)}</span>
                </div>
              </div>

              {(modelChon || khachHang) && (
                <div className="pos-don-summary">
                  {modelChon && (
                    <div className="pos-don-xe">
                      <span>🏍️</span>
                      <div>
                        <div className="pos-don-xe-name">{modelChon.brand} {modelChon.model_name}</div>
                        {phienBanChon && <div className="pos-don-xe-sub">Phiên bản: {phienBanChon}</div>}
                        {modeDatCoc ? (
                          <>
                            <div className="pos-don-xe-sub" style={{ color: '#92400e', fontWeight: 600 }}>
                              📋 Đặt cọc trước · Màu: {mauYeuCau || '—'}
                            </div>
                            <div className="pos-don-xe-sub" style={{ fontSize: 11, color: '#9ca3af' }}>
                              VIN sẽ gán khi xe về kho
                            </div>
                          </>
                        ) : (
                          <>
                            {mauChon && <div className="pos-don-xe-sub">Màu {mauChon} · Còn: {soLuongConHang} xe</div>}
                            {vehicleChon && <div className="pos-don-xe-vin">VIN: {vehicleChon.vin}</div>}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {khachHang && (
                    <div className="pos-don-kh">
                      <span>👤</span>
                      <div>{khachHang.full_name} · {khachHang.phone}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ════ FOOTER ════ */}
      <div className="pos-footer">
        <button className="btn btn-secondary" onClick={() => navigate('/sales')}>Huỷ đơn</button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {!modeDatCoc && soLuongConHang === 0 && modelChon && mauChon && (
            <span className="pos-warning-text">⚠️ Hết hàng màu {mauChon}</span>
          )}
          {modeDatCoc && (
            <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>
              📋 Đặt cọc trước · {datCocNum > 0 ? formatCurrency(datCocNum) : 'Chưa nhập cọc'}
            </span>
          )}
          <button
            className="btn pos-btn-confirm"
            onClick={handleLuu}
            disabled={taodonMut.isPending || (!modeDatCoc && !!mauChon && soLuongConHang === 0)}
          >
            {taodonMut.isPending
              ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Đang xử lý...</>
              : isEditMode ? '💾 Cập nhật đơn' : modeDatCoc ? '📋 Lập đơn đặt cọc' : '💾 Lưu đơn'}
          </button>
        </div>
      </div>

      {/* ════ MODAL THÊM KHÁCH HÀNG MỚI ════ */}
      {showModalKH && (
        <div className="modal-overlay" onClick={() => setShowModalKH(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">👤 Thêm khách hàng mới</span>
              <button className="modal-close" onClick={() => setShowModalKH(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Họ tên <span className="pos-required">*</span></label>
                  <input
                    className="form-control"
                    placeholder="Nguyễn Văn A"
                    value={formKhachMoi.full_name}
                    onChange={e => setFormKhachMoi(p => ({ ...p, full_name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Số điện thoại <span className="pos-required">*</span></label>
                  <input
                    className="form-control"
                    placeholder="0987 123 456"
                    value={formKhachMoi.phone}
                    onChange={e => setFormKhachMoi(p => ({ ...p, phone: e.target.value }))}
                  />
                  {danhSachTrung.length > 0 && (
                    <div style={{
                      marginTop: 6, padding: '8px 10px',
                      background: '#fef3c7', border: '1px solid #fcd34d',
                      borderRadius: 6, fontSize: 12, color: '#92400e',
                    }}>
                      ⚠️ <strong>SĐT này đã có {danhSachTrung.length} khách hàng:</strong>
                      <div style={{ marginTop: 4 }}>
                        {danhSachTrung.map((kh, i) => (
                          <button
                            key={kh.id}
                            type="button"
                            onClick={() => {
                              chonKhachHang(kh);
                              setShowModalKH(false);
                            }}
                            style={{
                              display: 'block', width: '100%',
                              textAlign: 'left', marginTop: i > 0 ? 4 : 0,
                              padding: '4px 8px', borderRadius: 4,
                              background: '#fff', border: '1px solid #fcd34d',
                              fontSize: 12, color: '#92400e', cursor: 'pointer',
                            }}
                          >
                            👤 {kh.full_name} · {kh.customer_code} → <em>chọn</em>
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, marginTop: 6, color: '#78350f' }}>
                        Vẫn có thể tạo KH mới nếu cần — đây chỉ là cảnh báo trùng.
                      </div>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">CCCD/CMND</label>
                  <input
                    className="form-control"
                    placeholder="079123456789"
                    value={formKhachMoi.id_card}
                    onChange={e => setFormKhachMoi(p => ({ ...p, id_card: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Địa chỉ <span className="pos-required">*</span></label>
                  <input
                    className="form-control"
                    placeholder="123 Đường Lê Lợi, Quận 1, TP.HCM"
                    value={formKhachMoi.address}
                    onChange={e => setFormKhachMoi(p => ({ ...p, address: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModalKH(false)}>Huỷ</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!formKhachMoi.full_name.trim()) { toast.error('Nhập họ tên khách hàng'); return; }
                  if (!formKhachMoi.phone.trim())     { toast.error('Nhập số điện thoại');      return; }
                  if (!formKhachMoi.address.trim())   { toast.error('Nhập địa chỉ (cần để xuất hóa đơn)'); return; }
                  taoKHMut.mutate(formKhachMoi);
                }}
                disabled={taoKHMut.isPending}
              >
                {taoKHMut.isPending ? 'Đang tạo...' : '✓ Tạo khách hàng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper màu → CSS color ───────────────────────────────────────────────────
// Đã chuyển sang utils/colors.ts để đồng nhất với VehiclesPage / InventoryPage
