// Hook: offline sync — caches API responses and replays queue when online
import { useEffect, useRef, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { getSyncQueueCount } from '../stores/offlineStore';
import { replayQueue } from '../stores/syncQueue';
import toast from 'react-hot-toast';

export function useOfflineSync() {
  const isOnline = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const hasTriedSync = useRef(false);

  // Update pending count
  useEffect(() => {
    getSyncQueueCount().then(setPendingCount);
  }, [isOnline]);

  // Auto-replay when coming back online
  useEffect(() => {
    if (isOnline && !hasTriedSync.current) {
      hasTriedSync.current = true;
      sync();
    }
    if (!isOnline) {
      hasTriedSync.current = false;
    }
  }, [isOnline]);

  async function sync() {
    const count = await getSyncQueueCount();
    if (count === 0) return;

    setIsSyncing(true);
    toast.loading('Đang đồng bộ...', { id: 'sync' });

    const { ok, failed } = await replayQueue();

    setIsSyncing(false);
    setPendingCount(failed);

    if (ok > 0 && failed === 0) {
      toast.success(`Đồng bộ thành công ${ok} mục`, { id: 'sync' });
    } else if (failed > 0) {
      toast.error(`Đồng bộ: ${ok} thành công, ${failed} lỗi`, { id: 'sync' });
    } else {
      toast.dismiss('sync');
    }
  }

  return { isOnline, pendingCount, isSyncing, sync };
}
