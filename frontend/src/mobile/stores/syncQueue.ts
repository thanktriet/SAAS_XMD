// Sync queue — replay pending mutations when back online
import api from '../../services/api';
import { getPendingSyncItems, removeSyncItem, markSyncItemFailed } from './offlineStore';

let isSyncing = false;

export async function replayQueue(onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: number }> {
  if (isSyncing) return { ok: 0, failed: 0 };
  isSyncing = true;

  const items = await getPendingSyncItems();
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      switch (item.method) {
        case 'POST':
          await api.post(item.url, item.body);
          break;
        case 'PUT':
          await api.put(item.url, item.body);
          break;
        case 'PATCH':
          await api.patch(item.url, item.body);
          break;
        case 'DELETE':
          await api.delete(item.url);
          break;
      }
      await removeSyncItem(item.id);
      ok++;
    } catch {
      await markSyncItemFailed(item.id);
      failed++;
    }
    onProgress?.(i + 1, items.length);
  }

  isSyncing = false;
  return { ok, failed };
}
