import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { BuildProgress, ElementData, IdsSpecification, Phase, ViewerApi } from './ids.types';
import { idsDb } from './ids.db';
import { computeModelKey } from './ids.hash';

const xmlOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  processEntities: true,
  htmlEntities: true,
  suppressEmptyNode: true,
  preserveOrder: false,
  format: true,
};

const ensureArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const parseRuleCollection = (raw: unknown): unknown[] => {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (typeof record.__cdata === 'string') {
      try {
        const parsed = JSON.parse(record.__cdata);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (Array.isArray(record.item)) return record.item;
    if (record.item != null) return [record.item];
    if (Array.isArray(record.Rule)) return record.Rule as unknown[];
    if (record.Rule != null) return [record.Rule];
  }
  return Array.isArray(raw) ? (raw as unknown[]) : [];
};

export const parseIds = (xml: string): IdsSpecification[] => {
  if (!xml || typeof xml !== 'string') return [];
  const parser = new XMLParser(xmlOptions);
  let root: any = {};
  try {
    root = parser.parse(xml);
  } catch (error) {
    console.warn('IDS adapter: failed to parse XML, returning empty specification list', error);
    return [];
  }
  // First, try to parse our custom IdsCreator wrapper (legacy)
  const container = root?.IdsCreator ?? root?.idsCreator ?? root?.IDS_CREATOR ?? root?.Ids ?? root;
  const specsSource = container?.Specification ?? container?.specification ?? container?.Specifications ?? container?.specifications ?? null;
  if (specsSource) {
    const specsArray = ensureArray(specsSource);
    if (specsArray.length) {
      return specsArray.map((entry: any, index: number): IdsSpecification => {
        const id = (entry?.['@_id'] as string)?.trim?.() || `spec-${index + 1}`;
        const name = (entry?.Name ?? entry?.name ?? '')?.toString?.() ?? '';
        const description = (entry?.Description ?? entry?.description ?? '')?.toString?.() ?? '';
        const applicability = parseRuleCollection(entry?.Applicability ?? entry?.applicability);
        const requirements = parseRuleCollection(entry?.Requirements ?? entry?.requirements);
        return {
          id,
          name,
          description,
          applicability,
          requirements,
        };
      });
    }
  }

  // Fallback: try to parse standard IDS format (namespace-aware). We'll search for any node named 'specification' ignoring namespace.
  const findSpecifications = (node: any): any[] => {
    if (!node || typeof node !== 'object') return [];
    for (const [key, val] of Object.entries(node)) {
      const lname = String(key).toLowerCase();
      if (lname.endsWith(':specification') || lname === 'specification' || lname === 'ids:specification') {
        return ensureArray(val);
      }
    }
    // recurse
    for (const val of Object.values(node)) {
      if (val && typeof val === 'object') {
        const found = findSpecifications(val);
        if (found && found.length) return found;
      }
    }
    return [];
  };

  const specNodes = findSpecifications(root);
  if (!specNodes.length) return [];

  const readText = (node: any): string | null => {
    if (!node) return null;
    if (typeof node === 'string') return node;
    if (typeof node === 'object') {
      // common shapes: { 'ids:simpleValue': 'X' } or { simpleValue: 'X' } or { '#text': 'X' }
      for (const k of Object.keys(node)) {
        const lk = k.toLowerCase();
        if (lk.includes('simplevalue') || lk === '#text' || lk === 'value') {
          const v = node[k];
          if (typeof v === 'string') return v;
          if (typeof v === 'object' && (v?.value || v?.Value)) return String(v.value ?? v.Value);
        }
      }
    }
    return null;
  };

  const specs: IdsSpecification[] = specNodes.map((entry: any, index: number) => {
    const id = (entry?.['@_id'] as string)?.trim?.() || `spec-${index + 1}`;
    const rawName = entry?.['@_name'] ?? entry?.name ?? entry?.Name ?? '';
    const name = String(rawName ?? '');
    const desc = '';
    const applicability: any[] = [];
    const requirements: any[] = [];

    // Applicability: look for applicability -> entity -> name -> simpleValue
    const apps = entry?.applicability ?? entry?.Applicability ?? entry?.['ids:applicability'] ?? null;
    const appArr = ensureArray(apps);
    for (const a of appArr) {
      // drill down to first simple value
      let found: string | null = null;
      const stack: any[] = [a];
      while (stack.length && !found) {
        const node = stack.shift();
        if (!node) continue;
        const txt = readText(node);
        if (txt) { found = txt; break; }
        if (typeof node === 'object') {
          for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v as any);
        }
      }
      if (found) applicability.push({ entity: found });
    }

    // Requirements: look for property entries
    const reqs = entry?.requirements ?? entry?.Requirements ?? entry?.['ids:requirements'] ?? null;
    const reqArr = ensureArray(reqs);
    // Specs sometimes wrap properties in ids:property -> propertySet/baseName
    const collectPropertyEntries = (node: any) => {
      const props: any[] = [];
      const propNodes = [] as any[];
      // try several shapes
      if (node?.property) propNodes.push(...ensureArray(node.property));
      if (node?.Property) propNodes.push(...ensureArray(node.Property));
      if (Array.isArray(node)) propNodes.push(...node);
      if (!propNodes.length && typeof node === 'object') {
        for (const val of Object.values(node)) {
          if (val && typeof val === 'object') propNodes.push(val as any);
        }
      }
      for (const p of propNodes) {
        // find pset and baseName
        const psetNode = p?.propertySet ?? p?.PropertySet ?? p?.['ids:propertySet'] ?? p?.propertySet;
        const baseNode = p?.baseName ?? p?.BaseName ?? p?.['ids:baseName'] ?? p?.baseName;
        const pset = readText(psetNode) || readText(p?.propertySet?.simpleValue) || readText(p?.propertySet?.['ids:simpleValue']);
        const base = readText(baseNode) || readText(p?.baseName?.simpleValue) || readText(p?.baseName?.['ids:simpleValue']);
        const allowed: string[] = [];
        const allowedNode = p?.allowedValues ?? p?.AllowedValues ?? p?.['ids:allowedValues'];
        if (allowedNode) {
          const values = allowedNode?.values ?? allowedNode?.Values ?? allowedNode?.['ids:values'] ?? allowedNode;
          const valArr = ensureArray(values?.value ?? values?.Value ?? values?.['ids:value'] ?? values ?? []);
          for (const v of valArr) {
            const txt = readText(v) || readText(v?.simpleValue) || readText(v?.['ids:simpleValue']);
            if (txt) allowed.push(txt);
          }
        }
        if (pset || base) {
          const rule: any = { id: `rule-${index}-${props.length}`, propertyPath: `${pset ?? 'Pset'}.${base ?? 'Property'}`, operator: 'equals' };
          if (allowed.length) rule.value = allowed.length === 1 ? allowed[0] : JSON.stringify(allowed);
          props.push(rule);
        }
      }
      return props;
    };

    for (const r of reqArr) {
      const collected = collectPropertyEntries(r);
      if (collected.length) requirements.push(...collected);
    }

    return { id, name: String(name ?? ''), description: String(desc), applicability, requirements } as IdsSpecification;
  });

  return specs;
};

export const generateIdsXml = (specs: IdsSpecification[]): string => {
  const builder = new XMLBuilder(xmlOptions);
  // If any spec contains structured requirement entries (propertyPath), emit standard IDS XML
  const hasStructured = (specs ?? []).some((s) => Array.isArray(s.requirements) && s.requirements.some((r) => r && typeof r === 'object' && 'propertyPath' in (r as any)));
  if (hasStructured) {
    const idsSpecs = (specs ?? []).map((spec) => {
        const applicabilityNodes: any[] = [];
      const extractEntityName = (a: any): string | null => {
        if (!a && a !== 0) return null;
        // common direct values
        if (typeof a === 'string') return a;
        if (typeof a === 'number') return String(a);
        
        // Check top-level ifcClass field first (from our capture)
        if (a?.ifcClass && typeof a.ifcClass === 'string' && a.ifcClass.trim()) {
          return a.ifcClass.trim();
        }
        
        // try other direct fields
        const maybe = a?.entity ?? a?.ifcType ?? a?.type;
        if (maybe && typeof maybe === 'string' && maybe.trim()) return maybe.trim();
        
        // sample container
        const sample = a?.sample ?? a;
        if (sample) {
          // Try _category.value first (most common for IFC class)
          if (sample._category && typeof sample._category === 'object') {
            const catValue = sample._category.value ?? sample._category.Value;
            if (typeof catValue === 'string' && catValue.trim()) return catValue.trim();
          }
          const byKeys = sample?.ifcClass ?? sample?.category?.value ?? sample?.type ?? sample?._type;
          if (byKeys && typeof byKeys === 'string' && byKeys.trim()) return byKeys.trim();
        }
        return null;
      };

      for (const app of ensureArray(spec.applicability)) {
        const name = extractEntityName(app as any) ?? null;
        // If no name, fallback to wildcard so rule can still apply
        const finalName = name && String(name).trim() ? String(name) : 'IFCELEMENT';
        applicabilityNodes.push({ 'ids:name': { 'ids:simpleValue': finalName } });
      }

      const requirementNodes: any[] = [];
      const extractPsetName = (v: any): string => {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
        if (typeof v === 'object') {
          if (v['ids:simpleValue']) return String(v['ids:simpleValue']);
          if (v.__cdata) return String(v.__cdata);
          if (v.Name) return String(v.Name);
          if (v.name) return String(v.name);
          // try to find a string field
          for (const key of Object.keys(v)) {
            const val = v[key];
            if (typeof val === 'string' && val.trim()) return val;
            if (val && typeof val === 'object') {
              const vv = val as any;
              if (typeof vv['ids:simpleValue'] === 'string') return vv['ids:simpleValue'];
              if (typeof vv.value === 'string') return vv.value;
            }
          }
          // avoid returning '[object Object]' as a fallback; return empty so caller can choose default
          return '';
        }
        return '';
      };

      for (const req of ensureArray(spec.requirements)) {
        if (req && typeof req === 'object') {
          const r = req as any;
          // propertyPath might be a string like 'Pset.Name' or an object with pset/property fields
          let psetRaw: any = null;
          let propRaw: any = null;
          if (typeof r.propertyPath === 'string') {
            const [a, b] = String(r.propertyPath).split('.');
            psetRaw = a; propRaw = b;
          } else if (r.propertyPath && typeof r.propertyPath === 'object') {
            psetRaw = r.propertyPath.pset ?? r.propertyPath.propertySet ?? r.propertySet ?? null;
            propRaw = r.propertyPath.property ?? r.propertyPath.prop ?? r.property ?? r.propertyName ?? null;
          } else {
            psetRaw = r.propertySet ?? r.pset ?? null;
            propRaw = r.baseName ?? r.property ?? r.prop ?? null;
          }
          const psetName = extractPsetName(psetRaw) || 'Pset';
          const baseName = extractPsetName(propRaw) || 'Property';
          
          // Normalize property and pset names to match how they're stored in flattened properties
          // (spaces become underscores, etc.) so validation can find them
          const normalizedPsetName = normalizeToken(psetName) || psetName;
          const normalizedBaseName = normalizeToken(baseName) || baseName;
          
          const propNode: any = {};
          propNode['ids:propertySet'] = { 'ids:simpleValue': normalizedPsetName };
          propNode['ids:baseName'] = { 'ids:simpleValue': normalizedBaseName };
          
          // Handle operator: 'exists' means no value constraint; others require allowedValues
          const operator = r.operator ?? 'equals';
          if (operator === 'exists') {
            // For 'exists' operator, don't add allowedValues (just check property presence)
            // Some IDS validators require empty simpleValue or omit the node entirely
            // We'll emit an empty simpleValue to indicate "any value is acceptable"
            propNode['ids:allowedValues'] = { 'ids:values': { 'ids:value': { 'ids:simpleValue': '' } } };
          } else if (r.value != null && String(r.value).trim()) {
            let allowedArr: string[] | null = null;
            try {
              const parsed = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
              if (Array.isArray(parsed)) allowedArr = parsed.map((v: any) => String(v));
            } catch {
              // not JSON
            }
            if (!allowedArr) {
              if (typeof r.value === 'string' && r.value.includes(',')) allowedArr = r.value.split(',').map((s: string) => normalizeValueCharacters(s.trim())).filter(Boolean);
            }
            if (allowedArr && allowedArr.length) {
              propNode['ids:allowedValues'] = { 'ids:values': { 'ids:value': allowedArr.map((v) => ({ 'ids:simpleValue': normalizeValueCharacters(String(v)) })) } };
            } else {
              propNode['ids:allowedValues'] = { 'ids:values': { 'ids:value': { 'ids:simpleValue': normalizeValueCharacters(String(r.value)) } } };
            }
          }
          requirementNodes.push({ 'ids:property': propNode });
        }
      }

      const specNode: any = {
        '@_ifcVersion': 'IFC4',
        '@_name': spec.name ?? '',
      };
      if (applicabilityNodes.length) specNode['ids:applicability'] = { 'ids:entity': applicabilityNodes.map((n) => ({ 'ids:name': n['ids:name'] ? n['ids:name'] : n })) };
      if (requirementNodes.length) specNode['ids:requirements'] = { 'ids:property': requirementNodes.map((r) => r['ids:property']) };
      return specNode;
    });

    const payload: any = { 'ids:ids': { '@_xmlns:ids': 'http://standards.buildingsmart.org/IDS', 'ids:specification': idsSpecs } };
    const xmlBody = builder.build(payload);
    return xmlBody.startsWith('<?xml') ? xmlBody : `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
  }

  // Fallback: keep the original IdsCreator wrapper for backwards compatibility
  const payload = {
    IdsCreator: {
      Specification: (specs ?? []).map((spec) => ({
        '@_id': spec.id,
        Name: spec.name,
        Description: spec.description,
        Applicability: { __cdata: JSON.stringify(spec.applicability ?? []) },
        Requirements: { __cdata: JSON.stringify(spec.requirements ?? []) },
      })),
    },
  };
  const xmlBody = builder.build(payload);
  return xmlBody.startsWith('<?xml') ? xmlBody : `<?xml version="1.0" encoding="UTF-8"?>\n${xmlBody}`;
};

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

const normalizeValueCharacters = (value: string): string => {
  if (!value || typeof value !== 'string') return value;
  return value
    // Normalize various dash characters to hyphen-minus
    .replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-') // en-dash, em-dash, minus, hyphen, non-breaking hyphen
    // Normalize various quote characters
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    // Normalize various spaces
    .replace(/[\u00A0\u2000-\u200B]/g, ' ') // non-breaking space, various width spaces
    .trim();
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return normalizeValueCharacters(value.trim());
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

/**
 * Stream element data collection - yields chunks as they're ready
 * Useful for progressive validation with large datasets
 */
const collectElementsStream = async function* (
  viewerApi: ViewerApi,
  globalIds: string[],
  options?: CollectElementsOptions & { chunkSize?: number }
): AsyncGenerator<ElementData[]> {
  const chunkSize = options?.chunkSize ?? 100;
  const total = Math.max(globalIds.length, 1);
  const useElementPropsMethod = viewerApi.getElementPropsFast || viewerApi.getElementProps;
  
  let processedCount = 0;
  let currentChunk: ElementData[] = [];
  
  for (const globalId of globalIds) {
    try {
      const { ifcClass, psets, attributes } = await useElementPropsMethod.call(viewerApi, globalId);
      
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
      
      currentChunk.push({ GlobalId: globalId, ifcClass, properties: flattened });
      processedCount++;
      
      // Yield chunk when full
      if (currentChunk.length >= chunkSize) {
        options?.onProgress?.({ done: processedCount, total });
        yield currentChunk;
        currentChunk = [];
      }
    } catch (error) {
      console.warn(`IDS adapter (stream) failed to load element ${globalId}`, error);
    }
  }
  
  // Yield remaining elements
  if (currentChunk.length > 0) {
    options?.onProgress?.({ done: processedCount, total });
    yield currentChunk;
  }
};

const collectElementsDirect = async (
  viewerApi: ViewerApi,
  globalIds: string[],
  options?: CollectElementsOptions
): Promise<ElementData[]> => {
  console.log('🔍 [collectElementsDirect] START with', globalIds.length, 'globalIds');
  console.log('🔍 [collectElementsDirect] Has getElementProps?', !!viewerApi.getElementProps);
  
  const elements: ElementData[] = [];
  const total = Math.max(globalIds.length, 1);
  options?.onProgress?.({ done: 0, total });
  
  // Use getElementProps for each GlobalId (this should already be on-demand if implemented correctly)
  const useElementPropsMethod = viewerApi.getElementProps;
  console.log('🔍 [collectElementsDirect] Using getElementProps method');
  
  for (let i = 0; i < globalIds.length; i++) {
    const globalId = globalIds[i];
    try {
      const { ifcClass, psets, attributes } = await useElementPropsMethod.call(viewerApi, globalId);
      
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
      
      // Update progress periodically
      if (i % 50 === 0 || i === globalIds.length - 1) {
        options?.onProgress?.({ done: elements.length, total });
      }
    } catch (error) {
      console.warn(`IDS adapter (direct) failed to load element ${globalId}`, error);
    }
  }
  options?.onProgress?.({ done: elements.length, total });
  console.log('🔍 [collectElementsDirect] COMPLETE - returning', elements.length, 'elements');
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

  // Calculate optimal worker count (leave one core for UI)
  const workerCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  console.log(`🚀 Starting parallel property extraction with ${workerCount} workers`);
  
  // Create worker pool
  const workers: Worker[] = [];
  const workerPromises: Promise<ElementData[]>[] = [];
  const workerResults: ElementData[][] = [];
  
  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(new URL('../workers/buildProps.worker.ts', import.meta.url), { type: 'module' });
    workers.push(worker);
    
    const promise = new Promise<ElementData[]>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<BuildWorkerResponse>) => {
        const message = event.data;
        if (!message) return;
        if (message.type === 'error') {
          reject(new Error(message.message || `Worker ${i} failed.`));
          return;
        }
        if (message.type === 'progress') {
          // Aggregate progress from all workers
          const totalDone = workerResults.reduce((sum, results) => sum + results.length, 0) + message.done;
          options?.onProgress?.({ done: totalDone, total: Math.max(total, totalDone) });
          return;
        }
        if (message.type === 'done') {
          workerResults[i] = message.elements ?? [];
          resolve(message.elements ?? []);
        }
      };
      const handleError = (event: ErrorEvent) => {
        reject(event.error ?? new Error(event.message || `Worker ${i} error.`));
      };
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
    });
    
    workerPromises.push(promise);
    worker.postMessage({ type: 'build-props', reset: true, total } satisfies BuildWorkerRequest);
  }

  options?.onProgress?.({ done: 0, total });

  const seen = new Set<string>();
  let workerIndex = 0;
  
  try {
    // Distribute batches across workers in round-robin fashion
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
        // Send to next worker in rotation
        const targetWorker = workers[workerIndex];
        targetWorker.postMessage({ type: 'build-props', elements: payload } satisfies BuildWorkerRequest);
        workerIndex = (workerIndex + 1) % workerCount;
      }
    }
  } catch (error) {
    // Cancel all workers
    workers.forEach(worker => {
      worker.postMessage({ type: 'cancel' } satisfies BuildWorkerRequest);
      worker.terminate();
    });
    throw error;
  }

  // Signal all workers to finalize
  workers.forEach(worker => {
    worker.postMessage({ type: 'build-props', final: true } satisfies BuildWorkerRequest);
  });

  try {
    // Wait for all workers to complete
    const allResults = await Promise.all(workerPromises);
    
    // Combine results from all workers
    const elements = allResults.flat();
    
    console.log(`✅ Parallel processing complete: ${elements.length} elements processed by ${workerCount} workers`);
    options?.onProgress?.({ done: elements.length, total: Math.max(total, elements.length) });
    return elements;
  } finally {
    // Terminate all workers
    workers.forEach(worker => worker.terminate());
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
  options?: CollectElementsOptions & { filterGlobalIds?: string[] } // Add optional filter
): Promise<ElementData[]> => {
  console.log('🔍 [collectElementsForIds] START', { 
    hasFilterGlobalIds: !!options?.filterGlobalIds, 
    filterCount: options?.filterGlobalIds?.length 
  });
  
  if (!viewerApi) {
    console.log('🔍 [collectElementsForIds] No viewerApi');
    return [];
  }
  
  // OPTIMIZATION: If we have filterGlobalIds, use them directly - no need to get all IDs!
  let globalIds: string[];
  if (options?.filterGlobalIds && options.filterGlobalIds.length > 0) {
    console.log('🔍 [collectElementsForIds] Using provided filterGlobalIds directly (skipping listGlobalIds)');
    globalIds = options.filterGlobalIds;
  } else {
    // Get all global IDs first (only when validating entire model)
    console.log('🔍 [collectElementsForIds] Calling listGlobalIds...');
    const allGlobalIds = await viewerApi.listGlobalIds();
    console.log('🔍 [collectElementsForIds] Got all GlobalIds:', allGlobalIds.length);
    globalIds = allGlobalIds;
  }
  
  console.log('🔍 [collectElementsForIds] GlobalIds to validate:', globalIds.length);
  
  if (!globalIds.length) {
    console.log('🔍 [collectElementsForIds] No GlobalIds to process');
    cachedElements = null;
    return [];
  }
  
  console.log('🔍 [collectElementsForIds] Building cache token...');
  const token = buildCacheToken(globalIds);
  console.log('🔍 [collectElementsForIds] Token built:', token.substring(0, 20) + '...');
  
  const expectedTotal = Math.max(globalIds.length, 1);
  options?.onPhase?.('BUILDING_PROPERTIES');
  options?.onProgress?.({ done: 0, total: expectedTotal });
  
  // Check if we have cached data for this exact set of elements
  console.log('🔍 [collectElementsForIds] Checking memory cache...');
  if (cachedElements && cachedElements.token === token) {
    console.log('🔍 [collectElementsForIds] Memory cache HIT! Returning', cachedElements.elements.length, 'elements');
    return cachedElements.elements;
  }
  console.log('🔍 [collectElementsForIds] Memory cache MISS');
  
  // Skip persistent cache for filtered queries (small element sets don't benefit from caching)
  const isFiltering = options?.filterGlobalIds && options.filterGlobalIds.length > 0;
  let persistentKey: string | null = null;
  
  if (!isFiltering) {
    console.log('🔍 [collectElementsForIds] Resolving persistent key...');
    persistentKey = await resolvePersistentKey(token, viewerApi);
    console.log('🔍 [collectElementsForIds] Persistent key:', persistentKey);
    
    if (persistentKey) {
      console.log('🔍 [collectElementsForIds] Checking IndexedDB cache...');
      try {
        const stored = await idsDb.get(persistentKey);
        console.log('🔍 [collectElementsForIds] IndexedDB returned:', stored?.length || 0, 'elements');
        if (stored && stored.length) {
          const metadata = await idsDb.getMetadata(persistentKey);
          const cacheAge = metadata ? Math.round((Date.now() - metadata.timestamp) / 1000 / 60) : 0;
          console.log(`⚡ Using cached elements from IndexedDB: ${stored.length} elements (cached ${cacheAge} minutes ago)`);
          options?.onProgress?.({ done: stored.length, total: expectedTotal });
          cachedElements = { token, elements: stored };
          return stored;
        }
        console.log('🔍 [collectElementsForIds] IndexedDB cache MISS or empty');
      } catch (error) {
        console.warn('IDS adapter: failed to read cached elements from IndexedDB', error);
      }
    }
  } else {
    console.log('🔍 [collectElementsForIds] Skipping persistent cache (filtering mode)');
  }

  let elements: ElementData[] = [];
  
  console.log('🔍 [collectElementsForIds] Decision point:', { 
    isFiltering, 
    willUseDirect: isFiltering,
    globalIdsCount: globalIds.length 
  });
  
  if (isFiltering) {
    console.log(`📌 Filtering mode: collecting ${globalIds.length} specific elements directly`);
    console.log('🔍 [collectElementsForIds] Calling collectElementsDirect...');
    elements = await collectElementsDirect(viewerApi, globalIds, options);
    console.log('🔍 [collectElementsForIds] collectElementsDirect returned:', elements.length, 'elements');
  } else {
    console.log('🔍 [collectElementsForIds] Full model mode - using workers');
    // For full model validation, use parallel workers
    const total = typeof viewerApi.countElements === 'function' ? await viewerApi.countElements().catch(() => globalIds.length) : globalIds.length;
    console.log('🔍 [collectElementsForIds] Total elements:', total);

    if (typeof viewerApi.iterElements === 'function') {
      try {
        console.log('🔍 [collectElementsForIds] Calling buildWithWorker...');
        elements = await buildWithWorker(viewerApi, total ?? globalIds.length, options);
        console.log('🔍 [collectElementsForIds] buildWithWorker returned:', elements.length, 'elements');
        if (!elements.length) {
          console.log('🔍 [collectElementsForIds] No elements from worker, falling back to direct');
          elements = await collectElementsDirect(viewerApi, globalIds, options);
        }
      } catch (error) {
        console.warn('IDS adapter: property build worker failed, falling back to direct collection', error);
    elements = await collectElementsDirect(viewerApi, globalIds, options);
      }
    } else {
      console.log('🔍 [collectElementsForIds] iterElements not available, using direct');
      elements = await collectElementsDirect(viewerApi, globalIds, options);
    }
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

/**
 * Build element data for the given global IDs and persist to IndexedDB under a computed key.
 * Returns the built elements.
 */
export const buildAndPersistCache = async (
  viewerApi: ViewerApi,
  globalIds: string[],
  options?: CollectElementsOptions
): Promise<ElementData[]> => {
  console.log('🔧 [buildAndPersistCache] START', { count: globalIds.length });
  if (!viewerApi) return [];
  // If viewerApi supports iterElements, prefer worker-based full extraction to speed up large builds
  if (typeof viewerApi.iterElements === 'function') {
    // Use buildWithWorker to extract full properties in parallel. Note: buildWithWorker expects total count
    const total = typeof viewerApi.countElements === 'function' ? await viewerApi.countElements().catch(() => globalIds.length) : globalIds.length;
    try {
      const elements = await buildWithWorker(viewerApi, total, options);
      try {
        const token = buildCacheToken(globalIds);
        const persistentKey = await resolvePersistentKey(token, viewerApi);
        if (persistentKey && elements.length) {
          // Chunk writes to avoid blocking the main thread too long
          const CHUNK = 20000;
          for (let i = 0; i < elements.length; i += CHUNK) {
            const slice = elements.slice(i, i + CHUNK);
            try {
              await idsDb.set(persistentKey, slice);
            } catch (err) {
              console.warn('🔧 [buildAndPersistCache] chunk write failed', err);
            }
          }
          cachedElements = { token, elements };
          console.log(`🔧 [buildAndPersistCache] Persisted ${elements.length} elements to IndexedDB key=${persistentKey.substring(0,16)}...`);
        }
      } catch (err) {
        console.warn('🔧 [buildAndPersistCache] Failed to compute key/persist', err);
      }
      return elements;
    } catch (err) {
      console.warn('🔧 [buildAndPersistCache] buildWithWorker failed, falling back to direct', err);
      // fallback to direct per-id collection
    }
  }

  // Fallback: direct collection for the provided ids
  const elements = await collectElementsDirect(viewerApi, globalIds, options);
  try {
    const token = buildCacheToken(globalIds);
    const persistentKey = await resolvePersistentKey(token, viewerApi);
    if (persistentKey && elements.length) {
      await idsDb.set(persistentKey, elements);
      cachedElements = { token, elements };
      console.log(`🔧 [buildAndPersistCache] Persisted ${elements.length} elements to IndexedDB key=${persistentKey.substring(0,16)}...`);
    }
  } catch (error) {
    console.warn('🔧 [buildAndPersistCache] Failed to persist cache', error);
  }
  return elements;
};

/**
 * Build and persist using worker-based extraction (cancellable). Returns a controller to cancel.
 */
export const buildAndPersistCacheWithWorkers = async (
  viewerApi: ViewerApi,
  globalIds: string[],
  onProgress?: (progress: BuildProgress) => void,
  abortSignal?: AbortSignal
): Promise<ElementData[]> => {
  if (!viewerApi) return [];
  if (!globalIds.length) return [];

  // If iterElements not available, fallback to the non-streaming path
  if (typeof viewerApi.iterElements !== 'function') {
    return buildAndPersistCache(viewerApi, globalIds, { onProgress: onProgress as any });
  }

  const total = typeof viewerApi.countElements === 'function' ? await viewerApi.countElements().catch(() => globalIds.length) : globalIds.length;
  const token = buildCacheToken(globalIds);
  const persistentKey = await resolvePersistentKey(token, viewerApi);
  if (!persistentKey) {
    // Cannot persist without a key; just run a normal build
    return buildAndPersistCache(viewerApi, globalIds, { onProgress: onProgress as any });
  }

  // Worker pool streaming implementation
  const workerCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const workers: Worker[] = [];
  let cancelled = false;
  let done = 0;
  let propertiesDone = 0;

  try {
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('../workers/buildProps.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
    }

      // Check for existing parts/metadata to support resume
      const existingMeta = await idsDb.getMetadata(persistentKey).catch(() => null);
      const existingPartKeys = existingMeta?.partKeys && Array.isArray(existingMeta.partKeys) ? existingMeta.partKeys.slice().sort() : [];
      // starting 'done' (elements already persisted)
      done = existingMeta?.elementCount ?? 0;
      // Start partCounter after existing parts so we append new parts
      let partCounter = existingPartKeys.length;
      // Load persisted IDs set for robust skipping
      const persistedIds = await idsDb.getPersistedIds(persistentKey).catch(() => new Set<string>());
      if (done > 0 && existingPartKeys.length) {
        // Resume mode
        onProgress?.({ done, total, propertiesDone, propertiesTotal: undefined });
      }

    // Attach message handlers
    const handlers: Array<(ev: MessageEvent) => void> = [];
    workers.forEach((worker, idx) => {
      const handler = async (ev: MessageEvent) => {
        const msg = ev.data as any;
        if (!msg) return;
        if (msg.type === 'error') {
          // bubble up error
          console.warn('Worker error:', msg.message);
          cancelled = true;
          return;
        }
        if (msg.type === 'progress') {
          const pDone = msg.done ?? done;
          const pTotal = msg.total ?? total;
          // accumulate properties if provided in progress
          if ((msg as any).propertiesDone) propertiesDone += (msg as any).propertiesDone;
          onProgress?.({ done: pDone, total: pTotal, propertiesDone, propertiesTotal: undefined });
          return;
        }
        if (msg.type === 'batch') {
          const batch: ElementData[] = msg.elements ?? [];
          const partIndex = typeof msg.partIndex === 'number' ? msg.partIndex : undefined;
          if (batch.length) {
            // Write batch as a part
            try {
              const idxToWrite = partIndex ?? Math.floor(done / 1000) + 1;
              await idsDb.writePart(persistentKey, idxToWrite, batch);
              // accumulate properties count if provided
              if ((msg as any).properties) propertiesDone += (msg as any).properties;
            } catch (err) {
              console.warn('Failed to write part to IndexedDB', err);
            }
            done += batch.length;
            onProgress?.({ done, total, propertiesDone, propertiesTotal: undefined });
          }
          return;
        }
        if (msg.type === 'done') {
          // worker finished
          return;
        }
      };
      handlers.push(handler);
      worker.addEventListener('message', handler);
    });

    // Distribute element batches from viewerApi.iterElements to workers
  let workerIndex = 0;
    for await (const batch of viewerApi.iterElements({ batchSize: 128 })) {
      if (abortSignal?.aborted) {
        cancelled = true;
        break;
      }
      if (!Array.isArray(batch) || !batch.length) continue;
      const payload: Array<{ globalId: string; ifcClass?: string; data: Record<string, unknown> }> = [];
      const seen = new Set<string>();
      // processedCount tracks how many elements we've iterated over (including skipped ones when resuming)
      // We rely on the order of iterElements being stable between runs to skip already-persisted elements.
      // processedCount is derived from done + number of elements seen in this run so far.
      // We'll compute a simple per-loop offset using 'done' as the number of elements already persisted.
      batch.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const rawData = (item as { data?: Record<string, unknown> }).data;
        if (!rawData) return;
        const globalId = extractGlobalId(rawData);
        if (!globalId || seen.has(globalId)) return;
        // Skip if already persisted (robust resume)
        if (persistedIds && persistedIds.has(globalId)) return;
        seen.add(globalId);
        const ifcClassCandidate = typeof rawData.ifcClass === 'string' ? rawData.ifcClass : undefined;
        payload.push({ globalId, ifcClass: ifcClassCandidate, data: rawData });
      });
      // If we're resuming and already have persisted elements (done > 0), we should skip the first 'done' elements from the stream.
      // We'll maintain a counter 'streamedProcessed' in closure to track how many elements we've examined during this run.
      // To avoid adding a new top-level variable here, we store streamedProcessed on the function scope via a Symbol property on the function.
      // Simpler: use a closure-scoped variable by checking if a symbol exists on this function (create if missing).
      // However, to keep changes minimal, we'll derive skip behavior from 'done' and a local static 'offsetSeen' stored on the function object.
      // @ts-ignore - attach runtime state
      (buildAndPersistCacheWithWorkers as any).__offsetSeen = (buildAndPersistCacheWithWorkers as any).__offsetSeen || 0;
      // Number of elements we've already skipped/consumed from the stream in previous iterations of this run
      // (not to be confused with 'done' which is elements already persisted from previous runs)
      // @ts-ignore
      let offsetSeen: number = (buildAndPersistCacheWithWorkers as any).__offsetSeen;
      // Decide how many to skip from this batch
      if (done > 0) {
        // We need to skip up to remaining = done - offsetSeen
        const remainingToSkip = Math.max(0, done - offsetSeen);
        if (remainingToSkip >= payload.length) {
          // skip whole payload
          offsetSeen += payload.length;
          // save back to closure state
          // @ts-ignore
          (buildAndPersistCacheWithWorkers as any).__offsetSeen = offsetSeen;
          continue; // skip sending this batch
        } else if (remainingToSkip > 0) {
          // drop first 'remainingToSkip' entries from payload
          payload.splice(0, remainingToSkip);
          offsetSeen += remainingToSkip;
          // save back
          // @ts-ignore
          (buildAndPersistCacheWithWorkers as any).__offsetSeen = offsetSeen;
        }
      }
      if (payload.length) {
        const target = workers[workerIndex];
        const partIndex = partCounter++;
        target.postMessage({ type: 'build-props', elements: payload, partIndex } as any);
        workerIndex = (workerIndex + 1) % workers.length;
      }
    }

    // Signal finalize to workers
    workers.forEach((w) => w.postMessage({ type: 'build-props', final: true } satisfies BuildWorkerRequest));

    // Wait for small grace period for workers to flush (they post batches as they process)
    // We'll poll the metadata store to know final element count
    // Wait until no progress for a short period or until done matches total (best-effort)
    const CHECK_INTERVAL = 200;
    let lastDone = done;
    let stableCountIterations = 0;
    while (true) {
      if (abortSignal?.aborted) {
        cancelled = true;
        break;
      }
      // If workers have completed and no more progress for a few intervals, break
      if (done === lastDone) {
        stableCountIterations += 1;
      } else {
        stableCountIterations = 0;
        lastDone = done;
      }
      if (stableCountIterations > 5) break;
      // If we've reached expected total, break
      if (total && done >= total) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
    }

    // Read back persisted parts and assemble
    const partKeys = await idsDb.listParts(persistentKey);
    const persisted: ElementData[] = [];
    for (const partKey of partKeys) {
      try {
        const part = await idsDb.get(partKey);
        if (part && part.length) persisted.push(...part);
      } catch (err) {
        console.warn('Failed to read part', partKey, err);
      }
    }
    cachedElements = { token, elements: persisted };
    onProgress?.({ done: persisted.length, total });
    return persisted;
  } finally {
    // Terminate and cleanup handlers
    workers.forEach((w, i) => {
      try {
        w.postMessage({ type: 'cancel' } satisfies BuildWorkerRequest);
      } catch {}
      try {
        w.terminate();
      } catch {}
    });
  }
};

/**
 * Incremental property extraction with signature validation and smart caching.
 * Extracts properties in batches, checks if model changed, and only processes new/changed elements.
 */
export const extractPropertiesIncremental = async (
  viewerApi: ViewerApi,
  onProgress?: (progress: { done: number; total?: number; phase: string }) => void,
  abortSignal?: AbortSignal,
  options?: {
    ifcTypes?: string[]; // Optional: only extract these IFC types
    batchSize?: number; // Elements per batch (default 2000 for faster processing)
  }
): Promise<ElementData[]> => {
  console.log('🚀 [extractPropertiesIncremental] START', { batchSize: options?.batchSize, ifcTypes: options?.ifcTypes });
  
  const batchSize = options?.batchSize ?? 2000;
  const ifcFilter = options?.ifcTypes && options.ifcTypes.length > 0 ? options.ifcTypes : null;
  
  console.log('📝 [extractPropertiesIncremental] Configuration:', { batchSize, ifcFilter });
  
  onProgress?.({ done: 0, total: undefined, phase: 'Checking model signature...' });
  
  // Get current model signature
  console.log('🔍 [extractPropertiesIncremental] Getting model signature...');
  let currentSignature: { signature: string; elementCount: number; modelFiles: Array<{ id: string; name: string }> } | null = null;
  try {
    if (typeof viewerApi.getModelSignature === 'function') {
      console.log('📞 [extractPropertiesIncremental] Calling viewerApi.getModelSignature()...');
      currentSignature = await viewerApi.getModelSignature();
      console.log('✅ [extractPropertiesIncremental] Got signature:', currentSignature);
    } else {
      console.warn('⚠️ [extractPropertiesIncremental] getModelSignature not available on viewerApi');
    }
  } catch (error) {
    console.error('❌ [extractPropertiesIncremental] Failed to get model signature', error);
  }
  
  if (!currentSignature || currentSignature.elementCount === 0) {
    console.warn('⚠️ [extractPropertiesIncremental] No elements found in model', currentSignature);
    return [];
  }
  
  console.log('🔑 [extractPropertiesIncremental] Computing storage key...');
  // Compute storage key
  const persistentKey = await computeModelKey({ 
    modelUrl: currentSignature.signature, 
    extra: String(currentSignature.elementCount) 
  });
  console.log('🔑 [extractPropertiesIncremental] Storage key:', persistentKey.substring(0, 20) + '...');
  
  // Check if signature matches (cache still valid)
  console.log('🔍 [extractPropertiesIncremental] Checking if signature is valid...');
  const signatureValid = await idsDb.isSignatureValid(persistentKey, currentSignature.signature);
  console.log('🔍 [extractPropertiesIncremental] Signature valid:', signatureValid);
  
  if (signatureValid) {
    console.log('⚡ [extractPropertiesIncremental] Cache is valid, reading cached data...');
    onProgress?.({ done: 0, total: currentSignature.elementCount, phase: 'Using cached data (model unchanged)' });
    // Read cached data
    try {
      const cached = await idsDb.readAllParts(persistentKey);
      if (cached && cached.length > 0) {
        console.log(`✅ [extractPropertiesIncremental] Using cached properties: ${cached.length} elements (signature valid)`);
        onProgress?.({ done: cached.length, total: currentSignature.elementCount, phase: 'Cache loaded' });
        return cached;
      } else {
        console.warn('⚠️ [extractPropertiesIncremental] Signature valid but no cached data found');
      }
    } catch (error) {
      console.warn('⚠️ [extractPropertiesIncremental] Failed to read cached data, will rebuild', error);
    }
  } else {
    console.log('🔄 [extractPropertiesIncremental] Model signature changed or no cache - extracting properties...');
    // Clear old cache for this key
    try {
      await idsDb.removeParts(persistentKey);
      console.log('🗑️ [extractPropertiesIncremental] Cleared old cache parts');
    } catch (error) {
      console.warn('⚠️ [extractPropertiesIncremental] Failed to remove old parts', error);
    }
  }
  
  // Extract properties using iterElements
  console.log('🔍 [extractPropertiesIncremental] Checking if iterElements is available...');
  if (typeof viewerApi.iterElements !== 'function') {
    console.error('❌ [extractPropertiesIncremental] iterElements not available');
    throw new Error('extractPropertiesIncremental: iterElements not available');
  }
  console.log('✅ [extractPropertiesIncremental] iterElements is available');
  
  onProgress?.({ done: 0, total: currentSignature.elementCount, phase: 'Extracting properties...' });
  
  // Worker pool for parallel extraction
  const workerCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  console.log(`👷 [extractPropertiesIncremental] Creating worker pool with ${workerCount} workers...`);
  const workers: Worker[] = [];
  let done = 0;
  let partIndex = 0;
  const allExtracted: ElementData[] = [];
  
  try {
    // Create worker pool
    for (let i = 0; i < workerCount; i++) {
      console.log(`👷 [extractPropertiesIncremental] Creating worker ${i + 1}/${workerCount}...`);
      const worker = new Worker(new URL('../workers/buildProps.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
    }
    console.log(`✅ [extractPropertiesIncremental] Worker pool created with ${workers.length} workers`);
    
    // Attach message handlers
    const handlers: Array<(ev: MessageEvent) => void> = [];
    workers.forEach((worker, idx) => {
      const handler = async (ev: MessageEvent) => {
        const msg = ev.data as any;
        if (!msg) return;
        
        if (msg.type === 'error') {
          console.error(`❌ [extractPropertiesIncremental] Worker ${idx} error:`, msg.message);
          return;
        }
        
        if (msg.type === 'batch') {
          const batch: ElementData[] = msg.elements ?? [];
          if (batch.length) {
            // Apply IFC filter if specified
            const filtered = ifcFilter 
              ? batch.filter(el => ifcFilter.includes(el.ifcClass))
              : batch;
            
            if (filtered.length) {
              // Write to DB immediately
              try {
                const idx = ++partIndex;
                await idsDb.writePart(persistentKey, idx, filtered);
                done += filtered.length;
                allExtracted.push(...filtered);
                
                // Log progress every 5000 elements
                if (done % 5000 < filtered.length || done === filtered.length) {
                  console.log(`💾 [extractPropertiesIncremental] Saved ${done.toLocaleString()} elements...`);
                }
                
                onProgress?.({ 
                  done, 
                  total: currentSignature!.elementCount, 
                  phase: `Extracted ${done.toLocaleString()} / ${currentSignature!.elementCount.toLocaleString()}` 
                });
              } catch (error) {
                console.error('❌ [extractPropertiesIncremental] Failed to write batch', error);
              }
            }
          }
        }
      };
      handlers.push(handler);
      worker.addEventListener('message', handler);
    });
    console.log(`✅ [extractPropertiesIncremental] ${workers.length} workers ready`);
    
    // Distribute batches from iterElements
    console.log('🔄 [extractPropertiesIncremental] Starting to iterate elements...');
    let workerIndex = 0;
    let batchBuffer: Array<{ globalId: string; ifcClass?: string; data: Record<string, unknown> }> = [];
    let iterationCount = 0;
    let totalProcessed = 0;
    
    for await (const batch of viewerApi.iterElements({ batchSize })) {
      iterationCount++;
      
      if (abortSignal?.aborted) {
        console.log('🛑 [extractPropertiesIncremental] Aborted by user');
        break;
      }
      if (!Array.isArray(batch) || !batch.length) {
        continue;
      }
      
      for (const item of batch) {
        if (!item || typeof item !== 'object') continue;
        
        const raw = (item as any).data;
        if (!raw) continue;
        
        const globalId = extractGlobalId(raw);
        if (!globalId) continue;
        
        const ifcClass = typeof raw.ifcClass === 'string' ? raw.ifcClass : undefined;
        
        // Apply IFC filter early if specified (skip extraction for unwanted types)
        if (ifcFilter && ifcClass && !ifcFilter.includes(ifcClass)) {
          continue;
        }
        
        batchBuffer.push({ globalId, ifcClass, data: raw });
        totalProcessed++;
        
        // Send batch to worker when buffer is full
        if (batchBuffer.length >= batchSize) {
          const target = workers[workerIndex];
          target.postMessage({ type: 'build-props', elements: batchBuffer, partIndex: partIndex + 1 } as any);
          workerIndex = (workerIndex + 1) % workers.length;
          batchBuffer = [];
          
          // Log progress every 10000 elements
          if (totalProcessed % 10000 === 0) {
            console.log(`📊 [extractPropertiesIncremental] Processed ${totalProcessed} elements...`);
          }
        }
      }
    }
    
    console.log(`✅ [extractPropertiesIncremental] Finished iterating: ${totalProcessed} elements in ${iterationCount} batches`);
    
    // Send remaining buffer
    if (batchBuffer.length > 0) {
      console.log(`📤 [extractPropertiesIncremental] Sending final batch of ${batchBuffer.length} elements to worker ${workerIndex}...`);
      const target = workers[workerIndex];
      target.postMessage({ type: 'build-props', elements: batchBuffer, partIndex: partIndex + 1 } as any);
    }
    
    // Signal finalize
    console.log(`🏁 [extractPropertiesIncremental] Signaling workers to finalize...`);
    workers.forEach((w, idx) => {
      console.log(`🏁 [extractPropertiesIncremental] Sending finalize to worker ${idx}...`);
      w.postMessage({ type: 'build-props', final: true } as any);
    });
    
    // Wait for workers to finish
    console.log('⏳ [extractPropertiesIncremental] Waiting for workers to finish (500ms grace period)...');
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(`✅ [extractPropertiesIncremental] Workers finished. Total extracted: ${done}`);
    
    // Update signature in metadata
    console.log('💾 [extractPropertiesIncremental] Updating signature in metadata...');
    await idsDb.updateSignature(persistentKey, currentSignature.signature, currentSignature.modelFiles);
    console.log('✅ [extractPropertiesIncremental] Signature updated');
    
    onProgress?.({ done, total: currentSignature.elementCount, phase: 'Extraction complete' });
    
    console.log(`✅ [extractPropertiesIncremental] COMPLETE: Extracted ${done} elements to IndexedDB`);
    return allExtracted;
    
  } finally {
    // Cleanup workers
    console.log('🧹 [extractPropertiesIncremental] Cleaning up workers...');
    workers.forEach((w, idx) => {
      try { 
        console.log(`🧹 [extractPropertiesIncremental] Terminating worker ${idx}...`);
        w.postMessage({ type: 'cancel' } as any); 
      } catch (e) {
        console.warn(`⚠️ [extractPropertiesIncremental] Failed to send cancel to worker ${idx}`, e);
      }
      try { 
        w.terminate(); 
      } catch (e) {
        console.warn(`⚠️ [extractPropertiesIncremental] Failed to terminate worker ${idx}`, e);
      }
    });
    console.log('✅ [extractPropertiesIncremental] Workers cleaned up');
  }
};

// New: stream from iterElements directly and persist per-part. Useful when listGlobalIds is slow/unavailable.
export const buildAndPersistFromIter = async (
  viewerApi: ViewerApi,
  scope: 'current' | 'all',
  onProgress?: (progress: BuildProgress) => void,
  abortSignal?: AbortSignal
): Promise<ElementData[]> => {
  if (!viewerApi) return [];
  if (typeof viewerApi.iterElements !== 'function') {
    console.warn('buildAndPersistFromIter: iterElements not available, falling back');
    return [];
  }

  // Compute token based on scope and element count (best-effort)
  let total: number | undefined = undefined;
  try {
    if (typeof viewerApi.countElements === 'function') {
      total = await viewerApi.countElements().catch(() => undefined);
    }
  } catch {}

  const tokenBase = scope === 'current' ? `SCOPE:CURRENT` : `SCOPE:ALL`;
  const token = `${tokenBase}::${total ?? 'unknown'}`;
  const persistentKey = await (async () => {
    try {
      return await computeModelKey({ modelUrl: token, extra: total != null ? String(total) : undefined });
    } catch (e) {
      console.warn('buildAndPersistFromIter: computeModelKey failed', e);
      return null;
    }
  })();

  // Worker pool similar to buildAndPersistCacheWithWorkers
  const workerCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const workers: Worker[] = [];
  let done = 0;
  let propertiesDone = 0;

  try {
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('../workers/buildProps.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
    }

    // Attach handlers
    const handlers: Array<(ev: MessageEvent) => void> = [];
    workers.forEach((worker) => {
      const handler = async (ev: MessageEvent) => {
        const msg = ev.data as any;
        if (!msg) return;
        if (msg.type === 'progress') {
          if ((msg as any).propertiesDone) propertiesDone += (msg as any).propertiesDone;
          onProgress?.({ done, total: total ?? 0, propertiesDone, propertiesTotal: undefined });
          return;
        }
        if (msg.type === 'batch') {
          const batch: ElementData[] = msg.elements ?? [];
          const partIndex = typeof msg.partIndex === 'number' ? msg.partIndex : undefined;
          if (batch.length) {
            try {
              const idxToWrite = partIndex ?? Math.floor(done / 1000) + 1;
              if (persistentKey) await idsDb.writePart(persistentKey, idxToWrite, batch);
              if ((msg as any).properties) propertiesDone += (msg as any).properties;
            } catch (err) {
              console.warn('buildAndPersistFromIter: Failed to write part', err);
            }
            done += batch.length;
            onProgress?.({ done, total: total ?? 0, propertiesDone, propertiesTotal: undefined });
          }
          return;
        }
      };
      handlers.push(handler);
      worker.addEventListener('message', handler);
    });

    // Distribute iterElements batches
    let workerIndex = 0;
    let partCounter = 0;
    for await (const batch of viewerApi.iterElements({ batchSize: 256 })) {
      if (abortSignal?.aborted) break;
      if (!Array.isArray(batch) || !batch.length) continue;
      const payload: Array<{ globalId: string; ifcClass?: string; data: Record<string, unknown> }> = [];
      const seen = new Set<string>();
      for (const item of batch) {
        if (!item || typeof item !== 'object') continue;
        const raw = (item as any).data;
        if (!raw) continue;
        const gid = extractGlobalId(raw);
        if (!gid || seen.has(gid)) continue;
        seen.add(gid);
        const ifcClassCandidate = typeof raw.ifcClass === 'string' ? raw.ifcClass : undefined;
        payload.push({ globalId: gid, ifcClass: ifcClassCandidate, data: raw });
      }
      if (payload.length) {
        const target = workers[workerIndex];
        const partIndex = ++partCounter;
        target.postMessage({ type: 'build-props', elements: payload, partIndex } as any);
        workerIndex = (workerIndex + 1) % workers.length;
      }
    }

    // Signal finalize
    workers.forEach((w) => w.postMessage({ type: 'build-props', final: true } as any));

    // Wait for flushing/progress stability
    const CHECK_INTERVAL = 200;
    let lastDone = done;
    let stableIterations = 0;
    while (true) {
      if (abortSignal?.aborted) break;
      if (done === lastDone) stableIterations++; else { stableIterations = 0; lastDone = done; }
      if (stableIterations > 5) break;
      if (total && done >= total) break;
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
    }

    // Read back persisted parts
    const persisted: ElementData[] = [];
    if (persistentKey) {
      const partKeys = await idsDb.listParts(persistentKey);
      for (const pk of partKeys) {
        try {
          const part = await idsDb.get(pk);
          if (part && part.length) persisted.push(...part);
        } catch (err) {
          console.warn('buildAndPersistFromIter: failed to read part', pk, err);
        }
      }
    }
    onProgress?.({ done: persisted.length, total: total ?? 0, propertiesDone, propertiesTotal: undefined });
    return persisted;
  } finally {
    workers.forEach((w) => {
      try { w.postMessage({ type: 'cancel' } as any); } catch {}
      try { w.terminate(); } catch {}
    });
  }
};
