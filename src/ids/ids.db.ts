import type { ElementData } from './ids.types';

const DB_NAME = 'fragments-ids';
const STORE_NAME = 'elements-v5'; // v5: added value character normalization (dashes, quotes, spaces)
const METADATA_STORE = 'cache-metadata-v1'; // Store for cache metadata (timestamps, element counts, etc.)
const DB_VERSION = 6; // Bump version to add metadata store

type DbConnection = IDBDatabase;

interface CacheMetadata {
  modelKey: string;
  timestamp: number;
  elementCount: number;
  version: string; // Cache version for future compatibility
}

const openStore = (): Promise<DbConnection> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onupgradeneeded = () => {
      const db = request.result;
      // Delete old stores on version upgrade
      const oldStores = ['elements-v1', 'elements-v2', 'elements-v3', 'elements-v4'];
      oldStores.forEach((storeName) => {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
      });
      // Create current store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      // Create metadata store if it doesn't exist
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
};

export const idsDb = {
  async get(modelKey: string): Promise<ElementData[] | null> {
    const db = await openStore();
    return new Promise<ElementData[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(modelKey);
      request.onsuccess = () => resolve((request.result as ElementData[]) ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
    });
  },
  async set(modelKey: string, elements: ElementData[]): Promise<void> {
    const db = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const metaStore = tx.objectStore(METADATA_STORE);
      
      // Store elements
      const request = store.put(elements, modelKey);
      
      // Store metadata
      const metadata: CacheMetadata = {
        modelKey,
        timestamp: Date.now(),
        elementCount: elements.length,
        version: '1.0',
      };
      metaStore.put(metadata, modelKey);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('IndexedDB set failed'));
    });
    console.log(`💾 Cached ${elements.length} elements to IndexedDB for key: ${modelKey.substring(0, 16)}...`);
  },
  async getMetadata(modelKey: string): Promise<CacheMetadata | null> {
    const db = await openStore();
    return new Promise<CacheMetadata | null>((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const store = tx.objectStore(METADATA_STORE);
      const request = store.get(modelKey);
      request.onsuccess = () => resolve((request.result as CacheMetadata) ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB metadata get failed'));
    });
  },
  async remove(modelKey: string): Promise<void> {
    const db = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const metaStore = tx.objectStore(METADATA_STORE);
      
      store.delete(modelKey);
      metaStore.delete(modelKey);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  },
  async keys(): Promise<string[]> {
    const db = await openStore();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve((request.result as string[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB keys failed'));
    });
  },
  async getAllMetadata(): Promise<CacheMetadata[]> {
    const db = await openStore();
    return new Promise<CacheMetadata[]>((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readonly');
      const store = tx.objectStore(METADATA_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as CacheMetadata[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB getAllMetadata failed'));
    });
  },
  async clearOldCache(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    // Default: 30 days
    const db = await openStore();
    const allMetadata = await this.getAllMetadata();
    const now = Date.now();
    const keysToDelete = allMetadata
      .filter((meta) => now - meta.timestamp > maxAgeMs)
      .map((meta) => meta.modelKey);
    
    if (keysToDelete.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const metaStore = tx.objectStore(METADATA_STORE);
        
        keysToDelete.forEach((key) => {
          store.delete(key);
          metaStore.delete(key);
        });
        
        tx.oncomplete = () => {
          console.log(`🧹 Cleaned up ${keysToDelete.length} old cache entries from IndexedDB`);
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB cleanup failed'));
      });
    }
  },
};
