import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import toast from 'react-hot-toast';
import type { Customer } from '../../types';

interface FormData {
  full_name: string;
  phone: string;
  email: string;
  customer_type: string;
  gender: string;
  source: string;
  date_of_birth: string;
  id_number: string;
  id_issued_date: string;
  id_issued_place: string;
  address: string;
  district: string;
  city: string;
  company_name: string;
  tax_code: string;
  representative_name: string;
  representative_title: string;
  invoice_address: string;
  invoice_district: string;
  invoice_city: string;
  show_invoice_address: boolean;
  notes: string;
}

const INITIAL: FormData = {
  full_name: '',
  phone: '',
  email: '',
  customer_type: 'individual',
  gender: '',
  source: '',
  date_of_birth: '',
  id_number: '',
  id_issued_date: '',
  id_issued_place: '',
  address: '',
  district: '',
  city: '',
  company_name: '',
  tax_code: '',
  representative_name: '',
  representative_title: '',
  invoice_address: '',
  invoice_district: '',
  invoice_city: '',
  show_invoice_address: false,
  notes: '',
};

export default function CustomerFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  // Load existing customer for edit
  const { data: existing } = useQuery<Customer>({
    queryKey: ['m-customer-detail', id],
    queryFn: () => api.get(`/customers/${id}`).then(r => r.data),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        full_name: existing.full_name || '',
        phone: existing.phone || '',
        email: existing.email || '',
        customer_type: existing.customer_type || 'individual',
        gender: existing.gender || '',
        source: existing.source || '',
        date_of_birth: existing.date_of_birth?.slice(0, 10) || '',
        id_number: existing.id_number || '',
        id_issued_date: existing.id_issued_date?.slice(0, 10) || '',
        id_issued_place: existing.id_issued_place || '',
        address: existing.address || '',
        district: existing.district || '',
        city: existing.city || '',
        company_name: existing.company_name || '',
        tax_code: existing.tax_code || '',
        representative_name: existing.representative_name || '',
        representative_title: existing.representative_title || '',
        invoice_address: existing.invoice_address || '',
        invoice_district: existing.invoice_district || '',
        invoice_city: existing.invoice_city || '',
        show_invoice_address: !!(existing.invoice_address),
        notes: existing.notes || '',
      });
    }
  }, [existing]);

  const saveMut = useMutation({
    mutationFn: (data: Partial<FormData>) => {
      const payload = { ...data };
      delete (payload as any).show_invoice_address;
      if (!payload.show_invoice_address) {
        // already deleted above
      }
      if (isEdit) {
        return api.put(`/customers/${id}`, payload).then(r => r.data);
      }
      return api.post('/customers', payload).then(r => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['m-customers'] });
      qc.invalidateQueries({ queryKey: ['m-customer-detail', id] });
      toast.success(isEdit ? 'Đã cập nhật khách hàng' : 'Đã tạo khách hàng mới');
      navigate(isEdit ? `/m/customers/${id}` : `/m/customers/${data.id || data.data?.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi lưu khách hàng'),
  });

  function set(key: keyof FormData, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (!form.full_name.trim()) errs.full_name = 'Bắt buộc';
    if (!form.phone.trim()) errs.phone = 'Bắt buộc';
    if (form.phone && !/^[0-9]{9,11}$/.test(form.phone.replace(/\s/g, ''))) {
      errs.phone = 'SĐT không hợp lệ';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Email không hợp lệ';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    const { show_invoice_address, ...payload } = form;
    if (!show_invoice_address) {
      payload.invoice_address = '';
      payload.invoice_district = '';
      payload.invoice_city = '';
    }
    saveMut.mutate(payload);
  }

  return (
    <div className="m-page m-form-page">
      {/* Section 1: Thông tin cơ bản */}
      <div className="m-card">
        <h3 className="m-form-section-title">Thông tin cơ bản</h3>

        <div className="m-form-row">
          <label>Họ tên *</label>
          <input
            type="text"
            value={form.full_name}
            onChange={e => set('full_name', e.target.value)}
            placeholder="Nguyễn Văn A"
          />
          {errors.full_name && <span className="m-form-error">{errors.full_name}</span>}
        </div>

        <div className="m-form-row">
          <label>Số điện thoại *</label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="0901234567"
          />
          {errors.phone && <span className="m-form-error">{errors.phone}</span>}
        </div>

        <div className="m-form-row">
          <label>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="email@example.com"
          />
          {errors.email && <span className="m-form-error">{errors.email}</span>}
        </div>

        <div className="m-form-row">
          <label>Loại khách hàng</label>
          <select value={form.customer_type} onChange={e => set('customer_type', e.target.value)}>
            <option value="individual">Cá nhân</option>
            <option value="business">Doanh nghiệp</option>
          </select>
        </div>
      </div>

      {/* Section 2: Thông tin cá nhân */}
      <div className="m-card">
        <h3 className="m-form-section-title">Thông tin cá nhân</h3>

        <div className="m-form-row">
          <label>Giới tính</label>
          <select value={form.gender} onChange={e => set('gender', e.target.value)}>
            <option value="">— Chọn —</option>
            <option value="male">Nam</option>
            <option value="female">Nữ</option>
            <option value="other">Khác</option>
          </select>
        </div>

        <div className="m-form-row">
          <label>Nguồn khách hàng</label>
          <input
            type="text"
            value={form.source}
            onChange={e => set('source', e.target.value)}
            placeholder="Facebook, giới thiệu, ..."
          />
        </div>

        <div className="m-form-row">
          <label>Ngày sinh</label>
          <input
            type="date"
            value={form.date_of_birth}
            onChange={e => set('date_of_birth', e.target.value)}
          />
        </div>

        <div className="m-form-row">
          <label>CMND/CCCD</label>
          <input
            type="text"
            value={form.id_number}
            onChange={e => set('id_number', e.target.value)}
            placeholder="Số CMND/CCCD"
          />
        </div>

        <div className="m-form-row">
          <label>Ngày cấp</label>
          <input
            type="date"
            value={form.id_issued_date}
            onChange={e => set('id_issued_date', e.target.value)}
          />
        </div>

        <div className="m-form-row">
          <label>Nơi cấp</label>
          <input
            type="text"
            value={form.id_issued_place}
            onChange={e => set('id_issued_place', e.target.value)}
            placeholder="CA TP.HCM"
          />
        </div>
      </div>

      {/* Section 3: Địa chỉ */}
      <div className="m-card">
        <h3 className="m-form-section-title">Địa chỉ</h3>

        <div className="m-form-row">
          <label>Địa chỉ</label>
          <input
            type="text"
            value={form.address}
            onChange={e => set('address', e.target.value)}
            placeholder="Số nhà, tên đường..."
          />
        </div>

        <div className="m-form-row">
          <label>Quận/Huyện</label>
          <input
            type="text"
            value={form.district}
            onChange={e => set('district', e.target.value)}
            placeholder="Quận 1"
          />
        </div>

        <div className="m-form-row">
          <label>Tỉnh/TP</label>
          <input
            type="text"
            value={form.city}
            onChange={e => set('city', e.target.value)}
            placeholder="TP.HCM"
          />
        </div>
      </div>

      {/* Section 4: Thông tin doanh nghiệp (conditional) */}
      {form.customer_type === 'business' && (
        <div className="m-card">
          <h3 className="m-form-section-title">Thông tin doanh nghiệp</h3>

          <div className="m-form-row">
            <label>Tên công ty</label>
            <input
              type="text"
              value={form.company_name}
              onChange={e => set('company_name', e.target.value)}
              placeholder="Công ty TNHH..."
            />
          </div>

          <div className="m-form-row">
            <label>Mã số thuế</label>
            <input
              type="text"
              value={form.tax_code}
              onChange={e => set('tax_code', e.target.value)}
              placeholder="0123456789"
            />
          </div>

          <div className="m-form-row">
            <label>Người đại diện</label>
            <input
              type="text"
              value={form.representative_name}
              onChange={e => set('representative_name', e.target.value)}
            />
          </div>

          <div className="m-form-row">
            <label>Chức vụ</label>
            <input
              type="text"
              value={form.representative_title}
              onChange={e => set('representative_title', e.target.value)}
              placeholder="Giám đốc"
            />
          </div>
        </div>
      )}

      {/* Section 5: Địa chỉ hóa đơn */}
      <div className="m-card">
        <div className="m-form-toggle-row">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
            Địa chỉ hoá đơn riêng
          </span>
          <button
            className={`m-toggle-btn${form.show_invoice_address ? ' active' : ''}`}
            onClick={() => set('show_invoice_address', !form.show_invoice_address)}
            type="button"
          >
            <span className="m-toggle-knob" />
          </button>
        </div>

        {form.show_invoice_address && (
          <>
            <div className="m-form-row">
              <label>Địa chỉ HĐ</label>
              <input
                type="text"
                value={form.invoice_address}
                onChange={e => set('invoice_address', e.target.value)}
                placeholder="Số nhà, tên đường..."
              />
            </div>

            <div className="m-form-row">
              <label>Quận/Huyện</label>
              <input
                type="text"
                value={form.invoice_district}
                onChange={e => set('invoice_district', e.target.value)}
              />
            </div>

            <div className="m-form-row">
              <label>Tỉnh/TP</label>
              <input
                type="text"
                value={form.invoice_city}
                onChange={e => set('invoice_city', e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {/* Section 6: Ghi chú */}
      <div className="m-card">
        <h3 className="m-form-section-title">Ghi chú</h3>
        <div className="m-form-row">
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Ghi chú thêm..."
          />
        </div>
      </div>

      {/* Submit bar */}
      <div className="m-form-submit-bar">
        <button
          className="m-btn-primary"
          style={{ width: '100%' }}
          onClick={handleSubmit}
          disabled={saveMut.isPending}
        >
          {saveMut.isPending ? 'Đang lưu...' : isEdit ? '💾 Cập nhật khách hàng' : '✅ Tạo khách hàng'}
        </button>
      </div>
    </div>
  );
}
