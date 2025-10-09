import type { BuildProgress, ElementData, Phase, ViewerApi } from './ids.types';
import { idsDb } from './ids.db';
import { computeModelKey } from './ids.hash';

const normalizeToken = (value: string): string => {
  if (!value) return '';
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/["'`]/g, '')
    .replace(/[^a-zA-Z0-9_.:\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const flattenPsets = (psets: Record<string, Record<string, unknown>> | undefined | null): Record<string, unknown> => {
  if (!psets) return {};
  const output: Record<string, unknown> = {};
  for (const [psetName, properties] of Object.entries(psets)) {
    if (!properties || typeof properties !== 'object') continue;
    const normalizedPset = normalizeToken(psetName) || psetName;
    for (const [propertyName, rawValue] of Object.entries(properties)) {
      const normalizedProp = normalizeToken(propertyName) || propertyName;
      const key = `${normalizedPset}.${normalizedProp}`;
      if (!(key in output)) {
        output[key] = formatValue(rawValue);
      }
    }
  }
  return output;
};

let cachedElements: { token: string; elements: ElementData[] } | null = null;

type BuildWorkerRequest =
  | { type: 'build-props'; reset?: boolean; total?: number; elements?: Array<{ globalId: string; ifcClass?: string; data: Record<string, unknown> }>; final?: boolean }
  | { type: 'cancel' };

type BuildWorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; elements: ElementData[] }
  | { type: 'error'; message: string };

export const invalidateIdsElementsCache = () => {
  cachedElements = null;
};

const buildCacheToken = (ids: string[]): string => ids.slice().sort().join('|');

const GLOBAL_ID_KEYS = ['GlobalId', 'GlobalID', 'globalId', 'guid', 'Guid', 'GUID'];

type CollectElementsOptions = {
  onPhase?: (phase: Phase) => void;
  onProgress?: (progress: BuildProgress) => void;
};

const findFirstValueByKeywords = (source: unknown, keywords: string[]): string | undefined => {
  if (!source || typeof source !== 'object') return undefined;
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  const visited = new WeakSet<object>();
  const stack: unknown[] = [source];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current as object)) continue;
    visited.add(current as object);
    if (Array.isArray(current)) {
      for (const entry of current) {
        if (entry && typeof entry === 'object') {
          stack.push(entry);
        }
      }
      continue;
    }
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      const keyLower = key.toLowerCase();
      if (lowered.some((keyword) => keyLower.includes(keyword))) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        } else if (typeof value === 'number' && Number.isFinite(value)) {
          return value.toString();
        } else if (typeof value === 'boolean') {
          return value ? 'true' : 'false';
        } else if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          if (typeof record.value === 'string') {
            const trimmed = record.value.trim();
            if (trimmed) return trimmed;
          }
          if (typeof record.Value === 'string') {
            const trimmed = record.Value.trim();
            if (trimmed) return trimmed;
          }
          if (record.value && typeof record.value === 'object') {
            stack.push(record.value);
          }
          if (record.Value && typeof record.Value === 'object') {
            stack.push(record.Value);
          }
        }
      }
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return undefined;
};

const extractGlobalId = (source: unknown): string | null => {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  for (const key of GLOBAL_ID_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length) {
      return value.trim();
    }
  }
  const nested = findFirstValueByKeywords(source, ['globalid', 'global id', 'guid', 'uniqueid']);
  return nested?.trim() ?? null;
};

const collectElementsDirect = async (
  viewerApi: ViewerApi,
  globalIds: string[],
  options?: CollectElementsOptions
): Promise<ElementData[]> => {
  const elements: ElementData[] = [];
  const total = Math.max(globalIds.length, 1);
  options?.onProgress?.({ done: 0, total });
  for (const globalId of globalIds) {
    try {
      const { ifcClass, psets, attributes } = await viewerApi.getElementProps(globalId);
      const flattened = flattenPsets(psets);
      if (!('GlobalId' in flattened)) {
        flattened.GlobalId = globalId;
      }
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          const normalized = normalizeToken(key) || key;
          const path = `Attributes.${normalized}`;
          if (!(path in flattened)) {
            flattened[path] = formatValue(value);
          }
        }
      }
      if (!flattened.ifcClass) {
        flattened.ifcClass = ifcClass;
      }
      elements.push({ GlobalId: globalId, ifcClass, properties: flattened });
    } catch (error) {
      console.warn(`IDS adapter (direct) failed to load element ${globalId}`, error);
    }
    const done = elements.length;
    options?.onProgress?.({ done, total });
  }
  options?.onProgress?.({ done: elements.length, total });
  return elements;
};

const buildWithWorker = async (
  viewerApi: ViewerApi,
  total: number,
  options?: CollectElementsOptions
): Promise<ElementData[]> => {
  if (typeof viewerApi.iterElements !== 'function') {
    throw new Error('Viewer API does not support iterating elements.');
  }

  const worker = new Worker(new URL('../workers/buildProps.worker.ts', import.meta.url), { type: 'module' });
  const elementsPromise = new Promise<ElementData[]>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<BuildWorkerResponse>) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message || 'Property builder worker failed.'));
        return;
      }
      if (message.type === 'progress') {
        options?.onProgress?.({ done: message.done, total: message.total });
        return;
      }
      if (message.type === 'done') {
        cleanup();
        resolve(message.elements ?? []);
      }
    };
    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error ?? new Error(event.message));
    };
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
  });

  worker.postMessage({ type: 'build-props', reset: true, total } satisfies BuildWorkerRequest);
  options?.onProgress?.({ done: 0, total });

  const seen = new Set<string>();
  try {
    for await (const batch of viewerApi.iterElements({ batchSize: 128 })) {
      if (!Array.isArray(batch) || !batch.length) continue;
      const payload: Array<{ globalId: string; ifcClass?: string; data: Record<string, unknown> }> = [];
      batch.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const rawData = (item as { data?: Record<string, unknown> }).data;
        if (!rawData) return;
        const globalId = extractGlobalId(rawData);
        if (!globalId || seen.has(globalId)) return;
        seen.add(globalId);
        const ifcClassCandidate = typeof rawData.ifcClass === 'string' ? rawData.ifcClass : undefined;
        payload.push({ globalId, ifcClass: ifcClassCandidate, data: rawData });
      });
      if (payload.length) {
        worker.postMessage({ type: 'build-props', elements: payload } satisfies BuildWorkerRequest);
      }
    }
  } catch (error) {
    worker.postMessage({ type: 'cancel' } satisfies BuildWorkerRequest);
    worker.terminate();
    throw error;
  }

  worker.postMessage({ type: 'build-props', final: true } satisfies BuildWorkerRequest);

  try {
    const elements = await elementsPromise;
    options?.onProgress?.({ done: elements.length, total: Math.max(total, elements.length) });
    return elements;
  } finally {
    worker.terminate();
  }
};

const resolvePersistentKey = async (token: string, viewerApi: ViewerApi): Promise<string | null> => {
  try {
    const total = typeof viewerApi.countElements === 'function' ? await viewerApi.countElements() : undefined;
    return await computeModelKey({ modelUrl: token, extra: total != null ? String(total) : undefined });
  } catch (error) {
    console.warn('IDS adapter: failed to compute model key for cache', error);
    return null;
  }
};

export const collectElementsForIds = async (
  viewerApi: ViewerApi,
  options?: CollectElementsOptions
): Promise<ElementData[]> => {
  if (!viewerApi) return [];
  const globalIds = await viewerApi.listGlobalIds();
  if (!globalIds.length) {
    cachedElements = null;
    return [];
  }
  const token = buildCacheToken(globalIds);
  const expectedTotal = Math.max(globalIds.length, 1);
  options?.onPhase?.('BUILDING_PROPERTIES');
  options?.onProgress?.({ done: 0, total: expectedTotal });
  if (cachedElements && cachedElements.token === token) {
    return cachedElements.elements;
  }
  const persistentKey = await resolvePersistentKey(token, viewerApi);
  if (persistentKey) {
    try {
      const stored = await idsDb.get(persistentKey);
      if (stored && stored.length) {
        options?.onProgress?.({ done: stored.length, total: expectedTotal });
        cachedElements = { token, elements: stored };
        return stored;
      }
    } catch (error) {
      console.warn('IDS adapter: failed to read cached elements from IndexedDB', error);
    }
  }

  let elements: ElementData[] = [];
  const total = typeof viewerApi.countElements === 'function' ? await viewerApi.countElements().catch(() => globalIds.length) : globalIds.length;

  if (typeof viewerApi.iterElements === 'function') {
    try {
      elements = await buildWithWorker(viewerApi, total ?? globalIds.length, options);
      if (!elements.length) {
        elements = await collectElementsDirect(viewerApi, globalIds, options);
      }
    } catch (error) {
      console.warn('IDS adapter: property build worker failed, falling back to direct collection', error);
  elements = await collectElementsDirect(viewerApi, globalIds, options);
    }
  } else {
    elements = await collectElementsDirect(viewerApi, globalIds, options);
  }

  if (persistentKey && elements.length) {
    idsDb
      .set(persistentKey, elements)
      .catch((error) => console.warn('IDS adapter: failed to persist elements cache', error));
  }

  cachedElements = { token, elements };
  options?.onProgress?.({ done: Math.min(elements.length, expectedTotal), total: expectedTotal });
  return elements;
};
