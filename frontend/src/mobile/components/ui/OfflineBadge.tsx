// Offline badge component — shows when offline or has pending sync
import { useOfflineSync } from '../../hooks/useOfflineSync';

export default function OfflineBadge() {
  const { isOnline, pendingCount, isSyncing, sync } = useOfflineSync();

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className={`m-offline-badge${isOnline ? ' m-offline-syncing' : ''}`}>
      {!isOnline && (
        <span>📡 Đang offline — dữ liệu có thể không mới nhất</span>
      )}
      {isOnline && pendingCount > 0 && (
        <button className="m-offline-sync-btn" onClick={sync} disabled={isSyncing}>
          {isSyncing ? '⏳ Đang đồng bộ...' : `🔄 ${pendingCount} mục chờ đồng bộ`}
        </button>
      )}
    </div>
  );
}
