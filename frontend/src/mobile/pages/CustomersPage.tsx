import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { cacheCustomers, searchCachedCustomers, type CachedCustomer } from '../stores/offlineStore';
import type { Customer, PaginatedResponse } from '../../types';

const LIMIT = 20;
const FILTER_OPTIONS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'individual', label: 'Cá nhân' },
  { key: 'business', label: 'Doanh nghiệp' },
];

export default function CustomersPage() {
  const navigate = useNavigate();
  const isOnline = useNetworkStatus();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [offlineResults, setOfflineResults] = useState<CachedCustomer[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Online: fetch from API
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<PaginatedResponse<Customer>>({
    queryKey: ['m-customers', debouncedSearch, filter],
    queryFn: ({ pageParam = 1 }) =>
      api.get('/customers', {
        params: {
          search: debouncedSearch || undefined,
          customer_type: filter !== 'all' ? filter : undefined,
          page: pageParam,
          limit: LIMIT,
        },
      }).then(r => {
        // Cache results for offline use
        const customers = r.data?.data ?? [];
        cacheCustomers(customers.map((c: Customer) => ({
          id: c.id,
          full_name: c.full_name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          updated_at: c.updated_at || new Date().toISOString(),
        })));
        return r.data;
      }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((s, p) => s + p.data.length, 0);
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    initialPageParam: 1,
    enabled: isOnline,
  });

  // Offline: search from cache
  useEffect(() => {
    if (!isOnline) {
      searchCachedCustomers(debouncedSearch).then(setOfflineResults);
    }
  }, [isOnline, debouncedSearch]);

  // Infinite scroll
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

  const customers = isOnline
    ? (data?.pages.flatMap(p => p.data) ?? [])
    : offlineResults;
  const total = isOnline ? (data?.pages[0]?.total ?? 0) : offlineResults.length;

  return (
    <div className="m-page">
      {/* Search */}
      <div className="m-search-bar">
        <input
          type="search"
          placeholder="Tìm tên, SĐT khách hàng..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="m-search-input"
        />
      </div>

      {/* Filter chips */}
      <div className="m-filter-chips">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`m-chip${filter === opt.key ? ' m-chip-active' : ''}`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <p className="m-list-count">
        {total} khách hàng
        {!isOnline && ' (offline)'}
      </p>

      {/* List */}
      {isLoading && isOnline ? (
        <div className="m-page-loader">
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : customers.length === 0 ? (
        <div className="m-placeholder">
          <span className="m-placeholder-icon">👥</span>
          <p>Không tìm thấy khách hàng</p>
        </div>
      ) : (
        <div className="m-customer-list">
          {customers.map((c: any, idx: number) => (
            <div
              key={c.id}
              className="m-customer-item"
              onClick={() => navigate(`/m/customers/${c.id}`)}
              ref={idx === customers.length - 1 ? lastItemRef : undefined}
            >
              <div className="m-customer-avatar">
                {c.full_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="m-customer-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong>{c.full_name}</strong>
                  {c.customer_type && (
                    <span className={`m-customer-type-badge${c.customer_type === 'business' ? ' business' : ''}`}>
                      {c.customer_type === 'business' ? 'DN' : 'CN'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{c.phone}</span>
                  {c.loyalty_points > 0 && (
                    <span className="m-customer-points">⭐ {c.loyalty_points}</span>
                  )}
                </div>
              </div>
              <span className="m-customer-arrow">›</span>
            </div>
          ))}

          {isFetchingNextPage && (
            <div className="m-loading-more">
              <div className="spinner" style={{ width: 20, height: 20 }} />
            </div>
          )}
        </div>
      )}

      {/* FAB — Tạo khách hàng mới */}
      <button
        className="m-fab"
        onClick={() => navigate('/m/customers/new')}
        aria-label="Tạo khách hàng mới"
        style={{ bottom: 'calc(var(--m-nav-height) + var(--m-safe-bottom) + 16px)' }}
      >
        <span className="m-fab-icon">＋</span>
        <span className="m-fab-label">Thêm KH</span>
      </button>
    </div>
  );
}
