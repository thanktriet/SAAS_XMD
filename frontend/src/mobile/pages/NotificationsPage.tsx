import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { usePushNotification } from '../hooks/usePushNotification';
import toast from 'react-hot-toast';

interface Notification {
  id: number;
  title: string;
  body: string;
  type: string;
  reference_type?: string;
  reference_id?: number;
  is_read: boolean;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function getNotifIcon(type: string): string {
  switch (type) {
    case 'new_order': return '🛒';
    case 'payment_received': return '💰';
    case 'order_pending_reminder': return '⏰';
    case 'cash_advance_approved': return '✅';
    case 'cash_advance_rejected': return '❌';
    default: return '🔔';
  }
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isSupported, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotification();

  // Notifications list
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['m-notifications'],
    queryFn: ({ pageParam = 1 }) =>
      api.get('/notifications', { params: { page: pageParam, limit: 20 } }).then(r => r.data),
    getNextPageParam: (lastPage: any, pages: any[]) => {
      const loaded = pages.reduce((s, p) => s + p.data.length, 0);
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    initialPageParam: 1,
  });

  // Mark all as read
  const markAllMut = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['m-notifications'] });
      toast.success('Đã đánh dấu tất cả là đã đọc');
    },
  });

  // Mark single as read
  const markReadMut = useMutation({
    mutationFn: (id: number) => api.put(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['m-notifications'] }),
  });

  const notifications: Notification[] = data?.pages.flatMap((p: any) => p.data) ?? [];
  const unreadCount = data?.pages[0]?.unread ?? 0;

  const handleNotifClick = (notif: Notification) => {
    if (!notif.is_read) {
      markReadMut.mutate(notif.id);
    }
    // Navigate to referenced item
    if (notif.reference_type === 'sales_order' && notif.reference_id) {
      navigate(`/m/sales/${notif.reference_id}`);
    }
  };

  const handlePushToggle = async () => {
    if (isSubscribed) {
      const ok = await unsubscribe();
      if (ok) toast.success('Đã tắt thông báo đẩy');
    } else {
      const ok = await subscribe();
      if (ok) toast.success('Đã bật thông báo đẩy');
      else toast.error('Không thể bật thông báo. Kiểm tra quyền trình duyệt.');
    }
  };

  return (
    <div className="m-page">
      {/* Push toggle */}
      {isSupported && (
        <div className="m-card m-push-toggle">
          <div className="m-push-toggle-info">
            <strong>Thông báo đẩy</strong>
            <span>{isSubscribed ? 'Đang bật' : 'Đang tắt'}</span>
          </div>
          <button
            className={`m-toggle-btn${isSubscribed ? ' active' : ''}`}
            onClick={handlePushToggle}
            disabled={pushLoading}
            aria-label={isSubscribed ? 'Tắt thông báo' : 'Bật thông báo'}
          >
            <span className="m-toggle-knob" />
          </button>
        </div>
      )}

      {/* Header actions */}
      {unreadCount > 0 && (
        <div className="m-notif-header">
          <span className="m-list-count">{unreadCount} chưa đọc</span>
          <button
            className="m-btn-sm"
            onClick={() => markAllMut.mutate()}
            disabled={markAllMut.isPending}
          >
            ✓ Đọc tất cả
          </button>
        </div>
      )}

      {/* Notification list */}
      {isLoading ? (
        <div className="m-page-loader">
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : notifications.length === 0 ? (
        <div className="m-placeholder">
          <span className="m-placeholder-icon">🔔</span>
          <p>Chưa có thông báo</p>
          <span className="m-placeholder-sub">Thông báo sẽ xuất hiện khi có sự kiện mới</span>
        </div>
      ) : (
        <div className="m-notif-list">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`m-notif-item${!notif.is_read ? ' unread' : ''}`}
              onClick={() => handleNotifClick(notif)}
            >
              <div className="m-notif-icon">{getNotifIcon(notif.type)}</div>
              <div className="m-notif-content">
                <strong className="m-notif-title">{notif.title}</strong>
                {notif.body && <p className="m-notif-body">{notif.body}</p>}
                <span className="m-notif-time">{timeAgo(notif.created_at)}</span>
              </div>
              {!notif.is_read && <div className="m-notif-dot" />}
            </div>
          ))}

          {hasNextPage && (
            <button
              className="m-btn-outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Đang tải...' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
