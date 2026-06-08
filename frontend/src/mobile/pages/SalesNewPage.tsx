import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { formatCurrency } from '../../utils/helpers';
import type { Customer, VehicleModel, InventoryVehicle, Accessory, Promotion, RegistrationService } from '../../types';
import toast from 'react-hot-toast';

interface CartItem {
  accessory: Accessory;
  quantity: number;
}

export default function SalesNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);

  // Step 1: Customer
  const [searchKH, setSearchKH] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newKH, setNewKH] = useState({ full_name: '', phone: '', address: '' });

  // Step 2: Vehicle
  const [modelId, setModelId] = useState('');
  const [colorChon, setColorChon] = useState('');
  const [vehicle, setVehicle] = useState<InventoryVehicle | null>(null);

  // Step 3: Accessories + Services + Promotions
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedPromos, setSelectedPromos] = useState<Set<string>>(new Set());
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());

  // Step 4: Payment
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'installment'>('cash');
  const [depositAmount, setDepositAmount] = useState('');

  // ─── Queries ─────────────────────────────────────────────────────────────

  const { data: khResult } = useQuery({
    queryKey: ['m-kh-search', searchKH],
    queryFn: () => api.get('/customers', { params: { search: searchKH, limit: 10 } }).then(r => r.data),
    enabled: searchKH.length >= 2,
  });
  const customers: Customer[] = khResult?.data ?? [];

  const { data: modelsResult } = useQuery({
    queryKey: ['m-vehicle-models'],
    queryFn: () => api.get('/vehicles', { params: { limit: 100, is_active: true } }).then(r => r.data),
    enabled: step >= 2,
  });
  const models: VehicleModel[] = modelsResult?.data ?? [];

  const { data: invResult } = useQuery({
    queryKey: ['m-inventory', modelId],
    queryFn: () => api.get('/inventory', { params: { model_id: modelId, status: 'in_stock', limit: 100 } }).then(r => r.data),
    enabled: !!modelId,
  });
  const inventory: InventoryVehicle[] = invResult?.data ?? [];

  const { data: accResult } = useQuery({
    queryKey: ['m-accessories', modelId],
    queryFn: () => api.get('/accessories', { params: { model_id: modelId || undefined, is_active: 'true', limit: 100 } }).then(r => r.data),
    enabled: step >= 3,
  });
  const accessories: Accessory[] = accResult?.data ?? [];

  const { data: promoResult } = useQuery({
    queryKey: ['m-promotions', modelId],
    queryFn: () => api.get('/promotions/active', { params: { model_id: modelId || undefined } }).then(r => r.data),
    enabled: step >= 3,
  });
  const promotions: Promotion[] = (promoResult?.data ?? promoResult ?? []).filter((p: Promotion) => p.is_active);

  const { data: svcResult } = useQuery({
    queryKey: ['m-reg-services'],
    queryFn: () => api.get('/settings/services').then(r => r.data),
    enabled: step >= 3,
  });
  const services: RegistrationService[] = svcResult?.data ?? [];

  const { data: feesResult } = useQuery({
    queryKey: ['m-fees', modelId],
    queryFn: () => api.get('/settings/fees', { params: { model_id: modelId || undefined } }).then(r => r.data),
    enabled: step >= 3,
  });
  const fees: { key: string; label: string; amount: number }[] = feesResult?.data ?? [];

  // ─── Derived ──────────────────────────────────────────────────────────────

  const modelChon = models.find(m => m.id === modelId) ?? null;

  const availableColors = useMemo(() => {
    const set = new Set(inventory.map(v => v.color).filter(Boolean));
    return [...set] as string[];
  }, [inventory]);

  const vehiclesForColor = useMemo(
    () => inventory.filter(v => v.color === colorChon),
    [inventory, colorChon]
  );

  useEffect(() => {
    if (vehiclesForColor.length > 0) setVehicle(vehiclesForColor[0]);
    else setVehicle(null);
  }, [vehiclesForColor]);

  const vehiclePrice = Number(modelChon?.price_sell) || 0;
  const accTotal = cart.reduce((s, i) => s + (Number(i.accessory.price_sell) || 0) * i.quantity, 0);
  const svcTotal = services.filter(s => selectedServices.has(s.id)).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
  const feeTotal = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);

  function calcPromoDiscount(p: Promotion): number {
    const appliesTo = p.applies_to ?? 'vehicle';
    let base = appliesTo === 'vehicle' ? vehiclePrice : appliesTo === 'accessory' ? accTotal : vehiclePrice + accTotal;
    if (p.promo_type === 'percent') {
      const raw = base * (Number(p.discount_percent) || 0) / 100;
      return p.max_discount_cap ? Math.min(raw, Number(p.max_discount_cap) || 0) : raw;
    }
    if (p.promo_type === 'fixed') return Math.min(Number(p.discount_amount) || 0, base);
    return 0;
  }

  const totalDiscount = useMemo(
    () => promotions
      .filter(p => selectedPromos.has(p.id) && (p.promo_type === 'percent' || p.promo_type === 'fixed'))
      .reduce((s, p) => s + calcPromoDiscount(p), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPromos, vehiclePrice, accTotal, promotions]
  );

  const total = Math.max(0, vehiclePrice + accTotal + svcTotal + feeTotal - totalDiscount);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (payload: any) => api.post('/sales', payload).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['m-sales'] });
      qc.invalidateQueries({ queryKey: ['m-dashboard-today'] });
      toast.success('Tạo đơn hàng thành công!');
      const id = data.order?.id ?? data.id;
      navigate(`/m/sales/${id}`, { replace: true });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo đơn hàng'),
  });

  const createKHMut = useMutation({
    mutationFn: (body: any) => api.post('/customers', body).then(r => r.data),
    onSuccess: (data) => {
      setCustomer(data);
      setShowNewForm(false);
      setNewKH({ full_name: '', phone: '', address: '' });
      toast.success('Thêm khách hàng thành công!');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi thêm khách'),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectModel = (m: VehicleModel) => {
    setModelId(m.id);
    setColorChon('');
    setVehicle(null);
    setSelectedPromos(new Set());
    setCart([]);
  };

  const handleAdd = (acc: Accessory) => {
    if ((acc.qty_in_stock ?? 0) <= 0) { toast.error(`"${acc.name}" đã hết hàng`); return; }
    setCart(prev => {
      const ex = prev.find(i => i.accessory.id === acc.id);
      if (ex) {
        if (ex.quantity >= (acc.qty_in_stock ?? 0)) { toast.error(`Chỉ còn ${acc.qty_in_stock} ${acc.unit}`); return prev; }
        return prev.map(i => i.accessory.id === acc.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { accessory: acc, quantity: 1 }];
    });
  };

  const handleDec = (accId: string) => {
    setCart(prev =>
      prev.map(i => i.accessory.id === accId ? { ...i, quantity: i.quantity - 1 } : i)
          .filter(i => i.quantity > 0)
    );
  };

  const handleSubmit = () => {
    if (!customer) { toast.error('Vui lòng chọn khách hàng'); return; }
    if (!modelChon) { toast.error('Vui lòng chọn dòng xe'); return; }
    if (!colorChon) { toast.error('Vui lòng chọn màu xe'); return; }
    if (!vehicle) { toast.error('Không có xe trong kho với màu này'); return; }

    const depNum = depositAmount ? Number(depositAmount.replace(/[^0-9]/g, '')) : 0;

    createMut.mutate({
      customer_id: customer.id,
      payment_method: paymentMethod,
      deposit_amount: depNum,
      discount_amount: Math.abs(totalDiscount),
      items: [{
        vehicle_model_id: modelChon.id,
        inventory_vehicle_id: vehicle.id,
        quantity: 1,
        unit_price: vehiclePrice,
        discount_percent: 0,
        line_total: vehiclePrice,
      }],
      accessories: cart.map(ca => ({
        accessory_id: ca.accessory.id,
        quantity: ca.quantity,
        unit_price: Number(ca.accessory.price_sell) || 0,
      })),
      promotions: promotions
        .filter(p => selectedPromos.has(p.id))
        .map(p => ({
          promotion_id: p.id,
          promo_type: p.promo_type,
          discount_percent: Number(p.discount_percent) || 0,
          discount_amount: calcPromoDiscount(p),
        })),
      services: services
        .filter(s => selectedServices.has(s.id))
        .map(s => ({ service_id: s.id, service_name: s.name, price: Number(s.price) || 0 })),
      fees: fees.map(f => ({ fee_key: f.key, fee_label: f.label, amount: Number(f.amount) || 0 })),
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="m-page m-wizard">

      {/* Progress bar — 4 bước */}
      <div className="m-wizard-progress">
        {(['Khách', 'Xe', 'Sản phẩm', 'Thanh toán'] as const).map((label, i) => {
          const s = i + 1;
          return (
            <div key={s} className={`m-wizard-step${step >= s ? ' active' : ''}`}>
              <div className="m-wizard-dot">{step > s ? '✓' : s}</div>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      {/* ═══ Bước 1: Khách hàng ═══ */}
      {step === 1 && (
        <div className="m-wizard-content">
          {customer ? (
            <div className="m-card m-selected-card">
              <div className="m-selected-info">
                <strong>{customer.full_name}</strong>
                <span>{customer.phone}</span>
              </div>
              <button className="m-btn-sm" onClick={() => setCustomer(null)}>Đổi</button>
            </div>
          ) : (
            <>
              <div className="m-search-bar">
                <input
                  type="search"
                  placeholder="Tìm tên, SĐT khách hàng..."
                  value={searchKH}
                  onChange={e => setSearchKH(e.target.value)}
                  className="m-search-input"
                  autoFocus
                />
              </div>
              {customers.length > 0 && (
                <div className="m-customer-list">
                  {customers.map(c => (
                    <div key={c.id} className="m-customer-item" onClick={() => { setCustomer(c); setSearchKH(''); }}>
                      <div className="m-customer-avatar">{c.full_name?.charAt(0) || '?'}</div>
                      <div className="m-customer-info">
                        <strong>{c.full_name}</strong>
                        <span>{c.phone}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="m-btn-outline" onClick={() => setShowNewForm(v => !v)}>
                + Thêm khách hàng mới
              </button>
              {showNewForm && (
                <div className="m-card" style={{ marginTop: 12 }}>
                  <div className="m-input-group">
                    <label>Tên khách hàng *</label>
                    <input value={newKH.full_name} onChange={e => setNewKH(v => ({ ...v, full_name: e.target.value }))} placeholder="Nguyễn Văn A" />
                  </div>
                  <div className="m-input-group">
                    <label>Số điện thoại *</label>
                    <input type="tel" value={newKH.phone} onChange={e => setNewKH(v => ({ ...v, phone: e.target.value }))} placeholder="0901234567" />
                  </div>
                  <div className="m-input-group">
                    <label>Địa chỉ</label>
                    <input value={newKH.address} onChange={e => setNewKH(v => ({ ...v, address: e.target.value }))} placeholder="Số nhà, đường, phường..." />
                  </div>
                  <button className="m-btn-primary" style={{ marginTop: 12 }}
                    onClick={() => {
                      if (!newKH.full_name || !newKH.phone) { toast.error('Vui lòng nhập tên và SĐT'); return; }
                      createKHMut.mutate(newKH);
                    }}
                    disabled={createKHMut.isPending}>
                    {createKHMut.isPending ? 'Đang lưu...' : 'Lưu khách hàng'}
                  </button>
                </div>
              )}
            </>
          )}
          {customer && (
            <button className="m-btn-primary m-btn-next" onClick={() => setStep(2)}>
              Tiếp theo: Chọn xe →
            </button>
          )}
        </div>
      )}

      {/* ═══ Bước 2: Chọn dòng xe → màu ═══ */}
      {step === 2 && (
        <div className="m-wizard-content">

          {/* Chọn dòng xe */}
          <h3 className="m-section-title">Chọn dòng xe</h3>
          <div className="m-model-list">
            {models.length === 0 ? (
              <p className="m-card-sub">Đang tải...</p>
            ) : models.map(m => (
              <div
                key={m.id}
                className={`m-model-item${modelId === m.id ? ' selected' : ''}`}
                onClick={() => handleSelectModel(m)}
              >
                <div className="m-model-name">{m.brand} {m.model_name}</div>
                <div className="m-model-price">{formatCurrency(Number(m.price_sell) || 0)}</div>
              </div>
            ))}
          </div>

          {/* Chọn màu — hiện ra sau khi chọn model */}
          {modelId && (
            <>
              <h3 className="m-section-title" style={{ marginTop: 20 }}>Chọn màu xe</h3>
              {availableColors.length === 0 ? (
                <div className="m-card" style={{ padding: 16, textAlign: 'center', color: '#dc2626' }}>
                  Hết hàng tất cả màu
                </div>
              ) : (
                <div className="m-color-list">
                  {availableColors.map(color => {
                    const count = inventory.filter(v => v.color === color).length;
                    return (
                      <div
                        key={color}
                        className={`m-color-item${colorChon === color ? ' selected' : ''}`}
                        onClick={() => setColorChon(color)}
                      >
                        <div className="m-color-dot" />
                        <div className="m-color-name">{color}</div>
                        <div className="m-color-count">{count} xe</div>
                        {colorChon === color && vehicle && (
                          <div className="m-color-vin">VIN: ...{vehicle.vin?.slice(-6)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Summary bar */}
          <div className="m-summary-bar">
            <div>
              {modelChon && colorChon && vehicle ? (
                <>
                  <span className="m-summary-label">{modelChon.brand} {modelChon.model_name} · {colorChon}</span>
                  <strong className="m-summary-total" style={{ display: 'block' }}>{formatCurrency(vehiclePrice)}</strong>
                </>
              ) : (
                <span className="m-summary-label">Chưa chọn xe</span>
              )}
            </div>
            <button
              className="m-btn-primary"
              onClick={() => setStep(3)}
              disabled={!modelChon || !colorChon || !vehicle}
            >
              Tiếp →
            </button>
          </div>
        </div>
      )}

      {/* ═══ Bước 3: Phụ kiện + Dịch vụ + Khuyến mãi ═══ */}
      {step === 3 && (
        <div className="m-wizard-content">

          {/* Phụ kiện */}
          <h3 className="m-section-title">Phụ kiện bán kèm</h3>
          {accessories.length === 0 ? (
            <p className="m-card-sub">Không có phụ kiện</p>
          ) : (
            <div className="m-accessory-list">
              {accessories.filter(a => (a.qty_in_stock ?? 0) > 0).map(acc => {
                const inCart = cart.find(i => i.accessory.id === acc.id);
                return (
                  <div key={acc.id} className="m-accessory-item">
                    <div className="m-accessory-info">
                      <strong>{acc.name}</strong>
                      <span>{formatCurrency(Number(acc.price_sell) || 0)}</span>
                    </div>
                    {inCart ? (
                      <div className="m-qty-control">
                        <button onClick={() => handleDec(acc.id)}>−</button>
                        <span>{inCart.quantity}</span>
                        <button onClick={() => handleAdd(acc)}>+</button>
                      </div>
                    ) : (
                      <button className="m-btn-sm" onClick={() => handleAdd(acc)}>+ Thêm</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Dịch vụ đăng ký */}
          {services.length > 0 && (
            <>
              <h3 className="m-section-title" style={{ marginTop: 20 }}>Dịch vụ đăng ký</h3>
              <div className="m-promo-list">
                {services.map(sv => {
                  const checked = selectedServices.has(sv.id);
                  return (
                    <div
                      key={sv.id}
                      className={`m-promo-item${checked ? ' selected' : ''}`}
                      onClick={() => setSelectedServices(prev => {
                        const next = new Set(prev);
                        checked ? next.delete(sv.id) : next.add(sv.id);
                        return next;
                      })}
                    >
                      <div className="m-promo-check">{checked ? '✓' : ''}</div>
                      <div className="m-promo-info">
                        <strong>{sv.name}</strong>
                        {sv.description && <span>{sv.description}</span>}
                      </div>
                      <span className="m-promo-value">+{formatCurrency(Number(sv.price) || 0)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Khuyến mãi */}
          {promotions.length > 0 && (
            <>
              <h3 className="m-section-title" style={{ marginTop: 20 }}>Khuyến mãi</h3>
              <div className="m-promo-list">
                {promotions.map(promo => {
                  const isSelected = selectedPromos.has(promo.id);
                  const discountVal = calcPromoDiscount(promo);
                  return (
                    <div
                      key={promo.id}
                      className={`m-promo-item${isSelected ? ' selected' : ''}`}
                      onClick={() => setSelectedPromos(prev => {
                        const next = new Set(prev);
                        isSelected ? next.delete(promo.id) : next.add(promo.id);
                        return next;
                      })}
                    >
                      <div className="m-promo-check">{isSelected ? '✓' : ''}</div>
                      <div className="m-promo-info">
                        <strong>{promo.name}</strong>
                        <span>
                          {promo.promo_type === 'percent'
                            ? `Giảm ${promo.discount_percent}%${promo.max_discount_cap ? ` (tối đa ${formatCurrency(Number(promo.max_discount_cap) || 0)})` : ''}`
                            : promo.promo_type === 'fixed'
                            ? `Giảm ${formatCurrency(Number(promo.discount_amount) || 0)}`
                            : 'Quà tặng'}
                        </span>
                      </div>
                      {discountVal > 0 && (
                        <span className="m-promo-value" style={{ color: '#dc2626' }}>
                          -{formatCurrency(discountVal)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Summary bar */}
          <div className="m-summary-bar">
            <div>
              <span className="m-summary-label">Tạm tính:</span>
              <strong className="m-summary-total">{formatCurrency(total)}</strong>
              {totalDiscount > 0 && (
                <span className="m-summary-discount"> (-{formatCurrency(totalDiscount)})</span>
              )}
            </div>
            <button className="m-btn-primary" onClick={() => setStep(4)}>
              Tiếp →
            </button>
          </div>
        </div>
      )}

      {/* ═══ Bước 4: Thanh toán & Xác nhận ═══ */}
      {step === 4 && (
        <div className="m-wizard-content">

          {/* Tóm tắt đơn hàng */}
          <div className="m-card">
            <h3 className="m-card-title">Tóm tắt đơn hàng</h3>
            <div className="m-info-row">
              <span>Khách hàng</span>
              <strong>{customer?.full_name}</strong>
            </div>
            <div className="m-info-row">
              <span>Xe</span>
              <strong>{modelChon?.brand} {modelChon?.model_name} · {colorChon}</strong>
            </div>
            <div className="m-info-row">
              <span>Giá xe</span>
              <span>{formatCurrency(vehiclePrice)}</span>
            </div>
            {cart.length > 0 && (
              <div className="m-info-row">
                <span>Phụ kiện ({cart.length} loại)</span>
                <span>{formatCurrency(accTotal)}</span>
              </div>
            )}
            {svcTotal > 0 && (
              <div className="m-info-row">
                <span>Dịch vụ</span>
                <span>+{formatCurrency(svcTotal)}</span>
              </div>
            )}
            {feeTotal > 0 && (
              <div className="m-info-row">
                <span>Phí</span>
                <span>+{formatCurrency(feeTotal)}</span>
              </div>
            )}
            {totalDiscount > 0 && (
              <div className="m-info-row">
                <span>Khuyến mãi</span>
                <span style={{ color: '#16a34a' }}>-{formatCurrency(totalDiscount)}</span>
              </div>
            )}
            <div className="m-divider" />
            <div className="m-info-row m-total-row">
              <span>Tổng cộng</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
          </div>

          {/* Phương thức thanh toán */}
          <div className="m-card">
            <h3 className="m-card-title">Phương thức thanh toán</h3>
            <div className="m-radio-group">
              {[
                { key: 'cash', label: 'Tiền mặt' },
                { key: 'bank_transfer', label: 'Chuyển khoản' },
                { key: 'installment', label: 'Trả góp' },
              ].map(opt => (
                <label key={opt.key} className={`m-radio-item${paymentMethod === opt.key ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="payment"
                    value={opt.key}
                    checked={paymentMethod === opt.key}
                    onChange={() => setPaymentMethod(opt.key as typeof paymentMethod)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Đặt cọc */}
          <div className="m-card">
            <div className="m-input-group">
              <label>Số tiền đặt cọc (nếu có)</label>
              <input
                type="text"
                inputMode="numeric"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
              />
              {depositAmount && (
                <span className="m-card-sub">{formatCurrency(Number(depositAmount))}</span>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            className="m-btn-primary m-btn-submit"
            onClick={handleSubmit}
            disabled={createMut.isPending}
          >
            {createMut.isPending ? 'Đang tạo đơn...' : '✓ Tạo đơn hàng'}
          </button>
        </div>
      )}

      {/* Nút quay lại */}
      {step > 1 && (
        <button className="m-wizard-back" onClick={() => setStep(s => s - 1)}>
          ← Quay lại
        </button>
      )}
    </div>
  );
}
