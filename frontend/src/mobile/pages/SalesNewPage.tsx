import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { formatCurrency } from '../../utils/helpers';
import type { Customer, InventoryVehicle, Accessory, Promotion } from '../../types';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface CartAccessoryItem {
  accessory: Accessory;
  quantity: number;
}

// ─── Wizard Steps ────────────────────────────────────────────────────────────
export default function SalesNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);

  // Step 1: Customer
  const [searchKH, setSearchKH] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ full_name: '', phone: '', address: '' });

  // Step 2: Vehicle + Accessories + Promotions
  const [vehicle, setVehicle] = useState<InventoryVehicle | null>(null);
  const [cartAccessories, setCartAccessories] = useState<CartAccessoryItem[]>([]);
  const [selectedPromos, setSelectedPromos] = useState<Set<string>>(new Set());

  // Step 3: Payment
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'installment'>('cash');
  const [depositAmount, setDepositAmount] = useState('');

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data: customersResult } = useQuery({
    queryKey: ['m-customers-search', searchKH],
    queryFn: () => api.get('/customers', { params: { search: searchKH, limit: 10 } }).then(r => r.data),
    enabled: searchKH.length >= 2,
  });
  const customers: Customer[] = customersResult?.data ?? [];

  const { data: inventoryResult } = useQuery({
    queryKey: ['m-inventory'],
    queryFn: () => api.get('/inventory', { params: { status: 'in_stock', limit: 100 } }).then(r => r.data),
    enabled: step >= 2,
  });
  const vehicles: InventoryVehicle[] = inventoryResult?.data ?? [];

  const { data: accessoriesResult } = useQuery({
    queryKey: ['m-accessories'],
    queryFn: () => api.get('/accessories', { params: { limit: 100 } }).then(r => r.data),
    enabled: step >= 2,
  });
  const accessories: Accessory[] = accessoriesResult?.data ?? [];

  // Promotions (active, optionally filtered by model)
  const modelId = vehicle?.vehicle_model_id;
  const { data: promotionsResult } = useQuery({
    queryKey: ['m-promotions', modelId],
    queryFn: () => api.get('/promotions/active', { params: { model_id: modelId || undefined } }).then(r => r.data),
    enabled: step >= 2,
  });
  const promotions: Promotion[] = (promotionsResult?.data ?? promotionsResult ?? []).filter(
    (p: Promotion) => p.is_active && (p.promo_type === 'percent' || p.promo_type === 'fixed' || p.promo_type === 'gift')
  );

  // ─── Create order mutation ──────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (payload: any) => api.post('/sales', payload).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['m-sales'] });
      qc.invalidateQueries({ queryKey: ['m-dashboard-today'] });
      toast.success('Tạo đơn hàng thành công!');
      navigate(`/m/sales/${data.id || data.order?.id}`, { replace: true });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo đơn hàng'),
  });

  // ─── Create new customer ────────────────────────────────────────────────────
  const createCustomerMut = useMutation({
    mutationFn: (payload: any) => api.post('/customers', payload).then(r => r.data),
    onSuccess: (data) => {
      setCustomer(data);
      setShowNewForm(false);
      setNewCustomer({ full_name: '', phone: '', address: '' });
      toast.success('Thêm khách hàng mới!');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi thêm khách'),
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleSelectCustomer = (c: Customer) => {
    setCustomer(c);
    setSearchKH('');
    setStep(2);
  };

  const handleCreateCustomer = () => {
    if (!newCustomer.full_name || !newCustomer.phone) {
      toast.error('Vui lòng nhập tên và SĐT');
      return;
    }
    createCustomerMut.mutate(newCustomer);
  };

  const handleSelectVehicle = (v: InventoryVehicle) => {
    setVehicle(v === vehicle ? null : v);
    // Reset promos when vehicle changes
    setSelectedPromos(new Set());
  };

  const handleAddAccessory = (acc: Accessory) => {
    setCartAccessories(prev => {
      const existing = prev.find(i => i.accessory.id === acc.id);
      if (existing) {
        return prev.map(i => i.accessory.id === acc.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { accessory: acc, quantity: 1 }];
    });
  };

  const handleRemoveAccessory = (accId: string) => {
    setCartAccessories(prev => prev.filter(i => i.accessory.id !== accId));
  };

  const handleTogglePromo = (promoId: string) => {
    setSelectedPromos(prev => {
      const next = new Set(prev);
      if (next.has(promoId)) next.delete(promoId);
      else next.add(promoId);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!customer || !vehicle) {
      toast.error('Vui lòng chọn khách hàng và xe');
      return;
    }

    const payload = {
      customer_id: customer.id,
      payment_method: paymentMethod,
      deposit_amount: depositAmount ? Number(depositAmount.replace(/[,.]/g, '')) : 0,
      discount_amount: Math.abs(totalDiscount),
      items: [{
        inventory_vehicle_id: vehicle.id,
        quantity: 1,
      }],
      accessories: cartAccessories.map(ca => ({
        accessory_id: ca.accessory.id,
        quantity: ca.quantity,
        unit_price: ca.accessory.price_sell,
      })),
      promotions: promotions
        .filter(p => selectedPromos.has(p.id))
        .map(p => ({
          promotion_id: p.id,
          promo_type: p.promo_type,
          discount_percent: p.discount_percent || 0,
          discount_amount: calcPromoDiscount(p),
        })),
    };

    createMut.mutate(payload);
  };

  // ─── Computed ───────────────────────────────────────────────────────────────
  const vehiclePrice = Number(vehicle?.vehicle_models?.price_sell) || 0;
  const accTotal = cartAccessories.reduce((s, i) => s + (Number(i.accessory.price_sell) || 0) * i.quantity, 0);

  // Calculate discount for a single promotion
  function calcPromoDiscount(promo: Promotion): number {
    const appliesTo = promo.applies_to ?? 'vehicle';
    let base = 0;
    if (appliesTo === 'vehicle') base = vehiclePrice;
    else if (appliesTo === 'accessory') base = accTotal;
    else base = vehiclePrice + accTotal;

    if (promo.promo_type === 'percent') {
      const raw = base * (Number(promo.discount_percent) || 0) / 100;
      return promo.max_discount_cap ? Math.min(raw, promo.max_discount_cap) : raw;
    }
    if (promo.promo_type === 'fixed') {
      return Math.min(Number(promo.discount_amount) || 0, base);
    }
    return 0;
  }

  const totalDiscount = useMemo(() => {
    return promotions
      .filter(p => selectedPromos.has(p.id) && (p.promo_type === 'percent' || p.promo_type === 'fixed'))
      .reduce((s, p) => s + calcPromoDiscount(p), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPromos, vehiclePrice, accTotal, promotions]);

  const total = Math.max(0, vehiclePrice + accTotal - totalDiscount);

  return (
    <div className="m-page m-wizard">
      {/* Progress bar */}
      <div className="m-wizard-progress">
        {[1, 2, 3].map(s => (
          <div key={s} className={`m-wizard-step${step >= s ? ' active' : ''}`}>
            <div className="m-wizard-dot">{step > s ? '✓' : s}</div>
            <span>{s === 1 ? 'Khách hàng' : s === 2 ? 'Sản phẩm' : 'Thanh toán'}</span>
          </div>
        ))}
      </div>

      {/* ═══ Step 1: Chọn khách hàng ═══ */}
      {step === 1 && (
        <div className="m-wizard-content">
          {customer ? (
            <div className="m-card m-selected-card">
              <div className="m-selected-info">
                <strong>{customer.full_name}</strong>
                <span>{customer.phone}</span>
              </div>
              <button className="m-btn-sm" onClick={() => { setCustomer(null); }}>Đổi</button>
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

              {/* Customer results */}
              {customers.length > 0 && (
                <div className="m-customer-list">
                  {customers.map(c => (
                    <div
                      key={c.id}
                      className="m-customer-item"
                      onClick={() => handleSelectCustomer(c)}
                    >
                      <div className="m-customer-avatar">
                        {c.full_name?.charAt(0) || '?'}
                      </div>
                      <div className="m-customer-info">
                        <strong>{c.full_name}</strong>
                        <span>{c.phone}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button className="m-btn-outline" onClick={() => setShowNewForm(v => !v)}>
                ➕ Thêm khách hàng mới
              </button>

              {showNewForm && (
                <div className="m-card" style={{ marginTop: 12 }}>
                  <div className="m-input-group">
                    <label>Tên khách hàng *</label>
                    <input
                      value={newCustomer.full_name}
                      onChange={e => setNewCustomer(v => ({ ...v, full_name: e.target.value }))}
                      placeholder="Nguyễn Văn A"
                    />
                  </div>
                  <div className="m-input-group">
                    <label>Số điện thoại *</label>
                    <input
                      type="tel"
                      value={newCustomer.phone}
                      onChange={e => setNewCustomer(v => ({ ...v, phone: e.target.value }))}
                      placeholder="0901234567"
                    />
                  </div>
                  <div className="m-input-group">
                    <label>Địa chỉ</label>
                    <input
                      value={newCustomer.address}
                      onChange={e => setNewCustomer(v => ({ ...v, address: e.target.value }))}
                      placeholder="Số nhà, đường, phường..."
                    />
                  </div>
                  <button
                    className="m-btn-primary"
                    onClick={handleCreateCustomer}
                    disabled={createCustomerMut.isPending}
                    style={{ marginTop: 12 }}
                  >
                    {createCustomerMut.isPending ? 'Đang lưu...' : 'Lưu khách hàng'}
                  </button>
                </div>
              )}
            </>
          )}

          {customer && (
            <button className="m-btn-primary m-btn-next" onClick={() => setStep(2)}>
              Tiếp tục: Chọn xe →
            </button>
          )}
        </div>
      )}

      {/* ═══ Step 2: Chọn xe + phụ kiện + khuyến mãi ═══ */}
      {step === 2 && (
        <div className="m-wizard-content">
          <h3 className="m-section-title">Chọn xe</h3>
          <div className="m-vehicle-grid">
            {vehicles.map(v => (
              <div
                key={v.id}
                className={`m-vehicle-card${vehicle?.id === v.id ? ' selected' : ''}`}
                onClick={() => handleSelectVehicle(v)}
              >
                <div className="m-vehicle-name">
                  {v.vehicle_models?.brand} {v.vehicle_models?.model_name}
                </div>
                <div className="m-vehicle-color">{v.color || '—'}</div>
                <div className="m-vehicle-price">
                  {formatCurrency(Number(v.vehicle_models?.price_sell) || 0)}
                </div>
                {v.vin && <div className="m-vehicle-vin">VIN: ...{v.vin.slice(-6)}</div>}
              </div>
            ))}
            {vehicles.length === 0 && (
              <p className="m-card-sub">Không có xe tồn kho</p>
            )}
          </div>

          {/* Accessories */}
          <h3 className="m-section-title" style={{ marginTop: 20 }}>Phụ kiện</h3>
          <div className="m-accessory-list">
            {accessories.filter(a => a.qty_in_stock > 0).slice(0, 20).map(acc => {
              const inCart = cartAccessories.find(i => i.accessory.id === acc.id);
              return (
                <div key={acc.id} className="m-accessory-item">
                  <div className="m-accessory-info">
                    <strong>{acc.name}</strong>
                    <span>{formatCurrency(acc.price_sell)}</span>
                  </div>
                  {inCart ? (
                    <div className="m-qty-control">
                      <button onClick={() => {
                        if (inCart.quantity <= 1) handleRemoveAccessory(acc.id);
                        else setCartAccessories(prev => prev.map(i =>
                          i.accessory.id === acc.id ? { ...i, quantity: i.quantity - 1 } : i
                        ));
                      }}>−</button>
                      <span>{inCart.quantity}</span>
                      <button onClick={() => handleAddAccessory(acc)}>+</button>
                    </div>
                  ) : (
                    <button className="m-btn-sm" onClick={() => handleAddAccessory(acc)}>
                      + Thêm
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Promotions / Khuyến mãi */}
          {promotions.length > 0 && (
            <>
              <h3 className="m-section-title" style={{ marginTop: 20 }}>🎉 Khuyến mãi</h3>
              <div className="m-promo-list">
                {promotions.map(promo => {
                  const isSelected = selectedPromos.has(promo.id);
                  const discountVal = calcPromoDiscount(promo);
                  return (
                    <div
                      key={promo.id}
                      className={`m-promo-item${isSelected ? ' selected' : ''}`}
                      onClick={() => handleTogglePromo(promo.id)}
                    >
                      <div className="m-promo-check">
                        {isSelected ? '✓' : ''}
                      </div>
                      <div className="m-promo-info">
                        <strong>{promo.name}</strong>
                        <span>
                          {promo.promo_type === 'percent'
                            ? `Giảm ${promo.discount_percent}%${promo.max_discount_cap ? ` (tối đa ${formatCurrency(promo.max_discount_cap)})` : ''}`
                            : promo.promo_type === 'fixed'
                            ? `Giảm ${formatCurrency(Number(promo.discount_amount) || 0)}`
                            : '🎁 Quà tặng'}
                        </span>
                      </div>
                      {discountVal > 0 && (
                        <span className="m-promo-value">-{formatCurrency(discountVal)}</span>
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
                <span className="m-summary-discount">(-{formatCurrency(totalDiscount)})</span>
              )}
            </div>
            <button
              className="m-btn-primary"
              onClick={() => setStep(3)}
              disabled={!vehicle}
            >
              Tiếp →
            </button>
          </div>
        </div>
      )}

      {/* ═══ Step 3: Xác nhận & thanh toán ═══ */}
      {step === 3 && (
        <div className="m-wizard-content">
          {/* Summary */}
          <div className="m-card">
            <h3 className="m-card-title">Tóm tắt đơn hàng</h3>
            <div className="m-info-row">
              <span>Khách hàng</span>
              <strong>{customer?.full_name}</strong>
            </div>
            <div className="m-info-row">
              <span>Xe</span>
              <strong>
                {vehicle?.vehicle_models?.brand} {vehicle?.vehicle_models?.model_name}
              </strong>
            </div>
            <div className="m-info-row">
              <span>Giá xe</span>
              <span>{formatCurrency(vehiclePrice)}</span>
            </div>
            {cartAccessories.length > 0 && (
              <div className="m-info-row">
                <span>Phụ kiện ({cartAccessories.length})</span>
                <span>{formatCurrency(accTotal)}</span>
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

          {/* Payment method */}
          <div className="m-card">
            <h3 className="m-card-title">Phương thức thanh toán</h3>
            <div className="m-radio-group">
              {[
                { key: 'cash', label: '💵 Tiền mặt' },
                { key: 'bank_transfer', label: '🏦 Chuyển khoản' },
                { key: 'installment', label: '📋 Trả góp' },
              ].map(opt => (
                <label key={opt.key} className={`m-radio-item${paymentMethod === opt.key ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="payment"
                    value={opt.key}
                    checked={paymentMethod === opt.key}
                    onChange={() => setPaymentMethod(opt.key as any)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Deposit */}
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

      {/* Back button for steps 2,3 */}
      {step > 1 && (
        <button className="m-wizard-back" onClick={() => setStep(s => s - 1)}>
          ← Quay lại
        </button>
      )}
    </div>
  );
}
