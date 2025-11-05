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
  partKeys?: string[]; // list of part keys written for this model (per-part storage)
  modelSignature?: string; // Model signature for invalidation detection
  modelFiles?: Array<{ id: string; name: string }>; // Model file metadata
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
  },
  async append(modelKey: string, elements: ElementData[]): Promise<void> {
    if (!elements || !elements.length) return;
    const db = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const metaStore = tx.objectStore(METADATA_STORE);

      // Read existing entry first
      const getReq = store.get(modelKey);
      getReq.onsuccess = () => {
        const existing: ElementData[] = (getReq.result as ElementData[]) ?? [];
        const combined = existing.concat(elements);
        const putReq = store.put(combined, modelKey);
        // Update metadata
        const metadata: CacheMetadata = {
          modelKey,
          timestamp: Date.now(),
          elementCount: combined.length,
          version: '1.0',
        };
        metaStore.put(metadata, modelKey);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error ?? new Error('IndexedDB append put failed'));
      };
      getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB append get failed'));
    });
  },
  // Per-part storage API: write a part under a partKey and update metadata
  async writePart(modelKey: string, partIndex: number, elements: ElementData[]): Promise<void> {
    const partKey = `${modelKey}::part::${String(partIndex).padStart(6, '0')}`;
    const partIndexKey = `${modelKey}::partindex::${String(partIndex).padStart(6, '0')}`;
    const db = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const metaStore = tx.objectStore(METADATA_STORE);
      const request = store.put(elements, partKey);
      request.onsuccess = () => {
        // Update metadata index for the modelKey
        const metaReq = metaStore.get(modelKey);
        metaReq.onsuccess = () => {
          const meta = (metaReq.result as CacheMetadata | undefined) ?? { modelKey, timestamp: Date.now(), elementCount: 0, version: '1.0' };
          meta.timestamp = Date.now();
          meta.elementCount = (meta.elementCount || 0) + elements.length;
          // update partKeys index
          const keys = Array.isArray(meta.partKeys) ? meta.partKeys.slice() : [];
          if (!keys.includes(partKey)) keys.push(partKey);
          meta.partKeys = keys;
          metaStore.put(meta, modelKey);
          // Also store a compact index of GlobalIds for this part for resume support
          try {
            const ids = elements.map((e) => e.GlobalId).filter(Boolean);
            // write index under a separate key
            const idxReq = store.put(ids, partIndexKey);
            idxReq.onsuccess = () => {
              /* index stored */
            };
            idxReq.onerror = () => {
              /* ignore index write failures */
            };
          } catch (e) {
            // ignore
          }
          resolve();
        };
        metaReq.onerror = () => resolve();
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB writePart failed'));
    });
  },
  // Read persisted GlobalIds across all parts for a model (used to skip already-persisted elements)
  async getPersistedIds(modelKey: string): Promise<Set<string>> {
    const partKeys = await this.getPartKeys(modelKey);
    if (!partKeys || !partKeys.length) return new Set<string>();
    const db = await openStore();
    const ids = new Set<string>();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let pending = partKeys.length;
      partKeys.forEach((partKey) => {
        const partIndexKey = partKey.replace('::part::', '::partindex::');
        const req = store.get(partIndexKey);
        req.onsuccess = () => {
          const arr = (req.result as string[] | undefined) ?? [];
          for (const g of arr) if (typeof g === 'string' && g) ids.add(g);
          pending -= 1;
          if (pending === 0) resolve();
        };
        req.onerror = () => {
          pending -= 1;
          if (pending === 0) resolve();
        };
      });
    });
    return ids;
  },
  async getPartKeys(modelKey: string): Promise<string[]> {
    const meta = await this.getMetadata(modelKey);
    return Array.isArray(meta?.partKeys) ? meta!.partKeys! : [];
  },
  async listParts(modelKey: string): Promise<string[]> {
    // Prefer metadata index for part keys to avoid scanning the whole store
    const keys = await this.getPartKeys(modelKey);
    return keys.slice().sort();
  },
  async readAllParts(modelKey: string): Promise<ElementData[]> {
    const db = await openStore();
    const partKeys = await this.getPartKeys(modelKey);
    if (!partKeys.length) return [];
    return new Promise<ElementData[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const results: ElementData[] = [];
      let pending = partKeys.length;
      partKeys.forEach((k) => {
        const req = store.get(k);
        req.onsuccess = () => {
          const v = (req.result as ElementData[] | undefined) ?? [];
          results.push(...v);
          pending -= 1;
          if (pending === 0) resolve(results);
        };
        req.onerror = () => {
          pending -= 1;
          if (pending === 0) resolve(results);
        };
      });
    });
  },
  async removeParts(modelKey: string): Promise<void> {
    const db = await openStore();
    const prefix = `${modelKey}::part::`;
    const keys = await this.keys();
    const partKeys = keys.filter((k) => k.startsWith(prefix));
    if (!partKeys.length) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const metaStore = tx.objectStore(METADATA_STORE);
      partKeys.forEach((k) => store.delete(k));
      metaStore.delete(modelKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB removeParts failed'));
    });
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
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB cleanup failed'));
      });
    }
  },
  // Check if cached data is still valid by comparing signatures
  async isSignatureValid(modelKey: string, currentSignature: string): Promise<boolean> {
    const meta = await this.getMetadata(modelKey);
    if (!meta || !meta.modelSignature) {
      return false; // No metadata or no signature = invalid
    }
    return meta.modelSignature === currentSignature;
  },
  // Update metadata with new signature
  async updateSignature(
    modelKey: string,
    signature: string,
    modelFiles: Array<{ id: string; name: string }>
  ): Promise<void> {
    const db = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(METADATA_STORE, 'readwrite');
      const metaStore = tx.objectStore(METADATA_STORE);
      
      const getReq = metaStore.get(modelKey);
      getReq.onsuccess = () => {
        const meta = (getReq.result as CacheMetadata | undefined) ?? {
          modelKey,
          timestamp: Date.now(),
          elementCount: 0,
          version: '1.0',
        };
        
        meta.modelSignature = signature;
        meta.modelFiles = modelFiles;
        meta.timestamp = Date.now();
        
        const putReq = metaStore.put(meta, modelKey);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error ?? new Error('IndexedDB updateSignature failed'));
      };
      getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB updateSignature get failed'));
    });
  },
};
