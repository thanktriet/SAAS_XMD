import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { cacheCustomers, searchCachedCustomers, type CachedCustomer } from '../stores/offlineStore';
import type { Customer, PaginatedResponse } from '../../types';

const LIMIT = 20;

export default function CustomersPage() {
  const navigate = useNavigate();
  const isOnline = useNetworkStatus();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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
    queryKey: ['m-customers', debouncedSearch],
    queryFn: ({ pageParam = 1 }) =>
      api.get('/customers', {
        params: {
          search: debouncedSearch || undefined,
          page: pageParam,
          limit: LIMIT,
        },
      }).then(r => {
        // Cache results for offline use
        const customers = r.data?.data ?? [];
        cacheCustomers(customers.map(c => ({
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
          {customers.map((c, idx) => (
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
                <strong>{c.full_name}</strong>
                <span>{c.phone}</span>
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
    </div>
  );
}
