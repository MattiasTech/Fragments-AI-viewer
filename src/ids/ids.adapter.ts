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

const collectElementsDirect = async (
  viewerApi: ViewerApi,
  globalIds: string[],
  options?: CollectElementsOptions
): Promise<ElementData[]> => {
  console.log('🔍 [collectElementsDirect] START with', globalIds.length, 'globalIds');
  console.log('🔍 [collectElementsDirect] Has getElementPropsFast?', !!viewerApi.getElementPropsFast);
  
  const elements: ElementData[] = [];
  const total = Math.max(globalIds.length, 1);
  options?.onProgress?.({ done: 0, total });
  
  // Use fast path if available (for selected-only validation)
  const useElementPropsMethod = viewerApi.getElementPropsFast || viewerApi.getElementProps;
  const methodName = viewerApi.getElementPropsFast ? 'getElementPropsFast' : 'getElementProps';
  console.log('🔍 [collectElementsDirect] Using method:', methodName);
  
  for (let i = 0; i < globalIds.length; i++) {
    const globalId = globalIds[i];
    console.log(`🔍 [collectElementsDirect] Processing ${i + 1}/${globalIds.length}: ${globalId}`);
    try {
      console.log(`🔍 [collectElementsDirect] Calling ${methodName} for ${globalId}...`);
      const { ifcClass, psets, attributes } = await useElementPropsMethod.call(viewerApi, globalId);
      console.log(`🔍 [collectElementsDirect] Got props for ${globalId}:`, { 
        ifcClass, 
        psetCount: Object.keys(psets).length,
        attrCount: Object.keys(attributes || {}).length 
      });
      
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
      console.log(`🔍 [collectElementsDirect] Added element ${i + 1}, total now: ${elements.length}`);
    } catch (error) {
      console.warn(`IDS adapter (direct) failed to load element ${globalId}`, error);
    }
    const done = elements.length;
    options?.onProgress?.({ done, total });
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
