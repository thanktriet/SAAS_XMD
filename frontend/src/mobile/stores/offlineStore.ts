// IndexedDB offline cache layer using `idb`
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'xmd-mobile';
const DB_VERSION = 1;

export interface CachedSale {
  id: string;
  order_number: string;
  customer_name: string;
  total_amount: number;
  status: string;
  order_date: string;
  updated_at: string;
}

export interface CachedCustomer {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  address?: string;
  order_count?: number;
  updated_at: string;
}

export interface SyncQueueItem {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: any;
  created_at: string;
  retries: number;
  status: 'pending' | 'failed';
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Sales cache
        if (!db.objectStoreNames.contains('sales')) {
          const salesStore = db.createObjectStore('sales', { keyPath: 'id' });
          salesStore.createIndex('by-status', 'status');
          salesStore.createIndex('by-date', 'order_date');
        }
        // Customers cache
        if (!db.objectStoreNames.contains('customers')) {
          const customerStore = db.createObjectStore('customers', { keyPath: 'id' });
          customerStore.createIndex('by-name', 'full_name');
          customerStore.createIndex('by-phone', 'phone');
        }
        // Sync queue
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncStore.createIndex('by-status', 'status');
          syncStore.createIndex('by-created', 'created_at');
        }
      },
    });
  }
  return dbPromise;
}

// ─── Sales Cache ──────────────────────────────────────────────────────────────

export async function cacheSales(sales: CachedSale[]) {
  const db = await getDB();
  const tx = db.transaction('sales', 'readwrite');
  for (const sale of sales) {
    tx.store.put(sale);
  }
  await tx.done;
}

export async function getCachedSales(status?: string): Promise<CachedSale[]> {
  const db = await getDB();
  if (status) {
    return db.getAllFromIndex('sales', 'by-status', status);
  }
  return db.getAll('sales');
}

export async function getCachedSale(id: string): Promise<CachedSale | undefined> {
  const db = await getDB();
  return db.get('sales', id);
}

// ─── Customers Cache ──────────────────────────────────────────────────────────

export async function cacheCustomers(customers: CachedCustomer[]) {
  const db = await getDB();
  const tx = db.transaction('customers', 'readwrite');
  for (const customer of customers) {
    tx.store.put(customer);
  }
  await tx.done;
}

export async function getCachedCustomers(): Promise<CachedCustomer[]> {
  const db = await getDB();
  return db.getAll('customers');
}

export async function getCachedCustomer(id: string): Promise<CachedCustomer | undefined> {
  const db = await getDB();
  return db.get('customers', id);
}

export async function searchCachedCustomers(query: string): Promise<CachedCustomer[]> {
  const all = await getCachedCustomers();
  const q = query.toLowerCase();
  return all.filter(c =>
    c.full_name.toLowerCase().includes(q) || c.phone.includes(q)
  );
}

// ─── Sync Queue ───────────────────────────────────────────────────────────────

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'created_at' | 'retries' | 'status'>) {
  const db = await getDB();
  const entry: SyncQueueItem = {
    ...item,
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    retries: 0,
    status: 'pending',
  };
  await db.add('syncQueue', entry);
  return entry;
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'pending');
}

export async function markSyncItemFailed(id: string) {
  const db = await getDB();
  const item = await db.get('syncQueue', id);
  if (item) {
    item.retries += 1;
    item.status = item.retries >= 3 ? 'failed' : 'pending';
    await db.put('syncQueue', item);
  }
}

export async function removeSyncItem(id: string) {
  const db = await getDB();
  await db.delete('syncQueue', id);
}

export async function getSyncQueueCount(): Promise<number> {
  const db = await getDB();
  return db.countFromIndex('syncQueue', 'by-status', 'pending');
}

// ─── Clear all caches ─────────────────────────────────────────────────────────

export async function clearAllCaches() {
  const db = await getDB();
  const tx = db.transaction(['sales', 'customers', 'syncQueue'], 'readwrite');
  tx.objectStore('sales').clear();
  tx.objectStore('customers').clear();
  tx.objectStore('syncQueue').clear();
  await tx.done;
}
