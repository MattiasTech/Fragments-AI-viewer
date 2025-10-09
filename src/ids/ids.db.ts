import type { ElementData } from './ids.types';

const DB_NAME = 'fragments-ids';
const STORE_NAME = 'elements-v1';
const DB_VERSION = 1;

type DbConnection = IDBDatabase;

const openStore = (): Promise<DbConnection> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
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
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(elements, modelKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('IndexedDB set failed'));
    });
  },
  async remove(modelKey: string): Promise<void> {
    const db = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(modelKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
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
};
