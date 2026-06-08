import { useState, useCallback, useRef, useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { formatCurrency, formatDate, ORDER_STATUS } from '../../utils/helpers';
import type { SalesOrder, PaginatedResponse } from '../../types';

const STATUS_FILTERS = [
  { key: '', label: 'Tất cả' },
  { key: 'draft', label: 'Mở' },
  { key: 'confirmed', label: 'Đã xác nhận' },
  { key: 'deposit_paid', label: 'Đặt cọc' },
  { key: 'full_paid', label: 'Thanh toán đủ' },
  { key: 'delivered', label: 'Đã giao' },
  { key: 'cancelled', label: 'Hủy' },
];

const LIMIT = 20;

export default function SalesListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';

  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<PaginatedResponse<SalesOrder>>({
    queryKey: ['m-sales', status, debouncedSearch],
    queryFn: ({ pageParam = 1 }) =>
      api.get('/sales', {
        params: {
          status: status || undefined,
          search: debouncedSearch || undefined,
          page: pageParam,
          limit: LIMIT,
        },
      }).then(r => r.data),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((s, p) => s + p.data.length, 0);
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    initialPageParam: 1,
  });

  // Infinite scroll with IntersectionObserver
  const lastItemRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = new IntersectionObserver(entries => {
        if (entries[0]?.isIntersecting && hasNextPage) {
          fetchNextPage();
        }
      });
      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage],
  );

  const orders = data?.pages.flatMap(p => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  const handleStatusChange = (s: string) => {
    setStatus(s);
    if (s) {
      setSearchParams({ status: s });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="m-page">
      {/* Search */}
      <div className="m-search-bar">
        <input
          type="search"
          placeholder="Tìm mã đơn, tên khách..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="m-search-input"
        />
      </div>

      {/* Filter chips */}
      <div className="m-filter-chips">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            className={`m-chip${status === f.key ? ' m-chip-active' : ''}`}
            onClick={() => handleStatusChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Count */}
      <p className="m-list-count">{total} đơn hàng</p>

      {/* List */}
      {isLoading ? (
        <div className="m-page-loader">
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : orders.length === 0 ? (
        <div className="m-placeholder">
          <span className="m-placeholder-icon">📋</span>
          <p>Không có đơn hàng</p>
        </div>
      ) : (
        <div className="m-order-list">
          {orders.map((order, idx) => (
            <div
              key={order.id}
              className="m-order-card"
              onClick={() => navigate(`/m/sales/${order.id}`)}
              ref={idx === orders.length - 1 ? lastItemRef : undefined}
            >
              <div className="m-order-card-top">
                <span className="m-order-number">{order.order_number}</span>
                <span className={`m-badge ${ORDER_STATUS[order.status]?.cls || ''}`}>
                  {ORDER_STATUS[order.status]?.label || order.status}
                </span>
              </div>
              <div className="m-order-card-mid">
                <span className="m-order-customer">
                  👤 {order.customers?.full_name || '—'}
                </span>
                <span className="m-order-date">{formatDate(order.order_date)}</span>
              </div>
              <div className="m-order-card-bot">
                <span className="m-order-amount">{formatCurrency(order.total_amount)}</span>
                {order.payment_method && (
                  <span className="m-order-payment">{
                    order.payment_method === 'cash' ? '💵 Tiền mặt' :
                    order.payment_method === 'bank_transfer' ? '🏦 Chuyển khoản' :
                    order.payment_method === 'installment' ? '📋 Trả góp' : '💳 Hỗn hợp'
                  }</span>
                )}
              </div>
            </div>
          ))}

          {isFetchingNextPage && (
            <div className="m-loading-more">
              <div className="spinner" style={{ width: 20, height: 20 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
