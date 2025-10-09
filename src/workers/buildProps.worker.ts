import type { ElementData } from '../ids/ids.types';

type RawElement = {
  globalId: string;
  ifcClass?: string;
  data: unknown;
};

type BuildRequest = {
  type: 'build-props';
  total?: number;
  elements?: RawElement[];
  final?: boolean;
  reset?: boolean;
};

type CancelRequest = { type: 'cancel' };

type WorkerInMessage = BuildRequest | CancelRequest;

type ProgressMessage = { type: 'progress'; done: number; total: number };
type DoneMessage = { type: 'done'; elements: ElementData[] };
type ErrorMessage = { type: 'error'; message: string };

type WorkerOutMessage = ProgressMessage | DoneMessage | ErrorMessage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = self as any;

type PropertyRow = {
  label: string;
  value: string;
  rawPsetName?: string;
  rawPropertyName?: string;
};

const UPPERCASE_WORDS = new Set(['ID', 'IFC', 'BIM', 'MEP', 'HVAC', 'URL', 'CAD']);

const prettifyLabel = (label: string): string => {
  if (!label) return '';
  let text = label.replace(/[_\-]+/g, ' ');
  text = text.replace(/([a-z\d])([A-Z])/g, '$1 $2');
  text = text.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const words = text.split(' ').map((word) => {
    const upper = word.toUpperCase();
    if (UPPERCASE_WORDS.has(upper)) return upper;
    if (upper.length <= 3 && /^[A-Z]+$/.test(upper)) return upper;
    if (/^\d+(\.\d+)?$/.test(word)) return word;
    if (!word.length) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  return words.join(' ');
};

const formatPrimitive = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  try {
    const text = JSON.stringify(value);
    if (!text) return '';
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return String(value);
  }
};

const extractNominalValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value !== 'object') return formatPrimitive(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) return extractNominalValue(record.value);
    if ('Value' in record) return extractNominalValue(record.Value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractNominalValue(entry)).filter(Boolean).join(', ');
  }
  // @ts-expect-error - possible vector-like object
  if (typeof value?.x === 'number' && typeof value?.y === 'number' && typeof value?.z === 'number') {
    // @ts-expect-error - treat as vector
    return `${formatPrimitive(value.x)}, ${formatPrimitive(value.y)}, ${formatPrimitive(value.z)}`;
  }
  return formatPrimitive(value);
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
        }
      }
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return undefined;
};

const sanitizeKey = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/-{2,}/g, '-').replace(/(^-|-$)/g, '').toLowerCase();

const normalizeIdsToken = (value: string): string => {
  if (!value) return '';
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
};

const IFC_PROPERTY_COLLECTION_KEYS = ['HasProperties', 'hasProperties', 'Properties', 'properties'] as const;

const isIfcPropertySet = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const typed = value as Record<string, unknown>;
  const typeField = typeof typed.type === 'string' ? typed.type : typeof typed.Type === 'string' ? (typed.Type as string) : undefined;
  if (typeField && typeField.toUpperCase() === 'IFCPROPERTYSET') return true;
  return IFC_PROPERTY_COLLECTION_KEYS.some((key) => Array.isArray((typed as any)[key]));
};

const isIfcPropertySingleValue = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const typed = value as Record<string, unknown>;
  const typeField = typeof typed.type === 'string' ? typed.type : typeof typed.Type === 'string' ? (typed.Type as string) : undefined;
  if (typeField && typeField.toUpperCase() === 'IFCPROPERTYSINGLEVALUE') return true;
  return 'NominalValue' in typed || 'nominalValue' in typed;
};

const extractSingleValueText = (property: unknown): string => {
  if (!property || typeof property !== 'object') return formatPrimitive(property);
  const typed = property as Record<string, unknown>;
  const candidateKeys = [
    'NominalValue',
    'nominalValue',
    'Value',
    'value',
    'DataValue',
    'dataValue',
    'LengthValue',
    'AreaValue',
    'CountValue',
    'VolumeValue',
    'NumberValue',
    'BooleanValue',
    'LogicalValue',
    'TextValue',
    'IntegerValue',
    'UpperBoundValue',
    'LowerBoundValue',
    'EnumerationValues',
    'ListValues',
  ];

  for (const key of candidateKeys) {
    if (!(key in typed)) continue;
    const entry = typed[key];
    if (entry === null || entry === undefined) continue;
    return extractNominalValue(entry);
  }

  if ('NominalValue' in typed) return extractNominalValue(typed.NominalValue);
  if ('nominalValue' in typed) return extractNominalValue(typed.nominalValue);
  if ('Value' in typed) return extractNominalValue(typed.Value);
  if ('value' in typed) return extractNominalValue(typed.value);
  return formatPrimitive(property);
};

const collectIfcPropertySetRows = (root: unknown): PropertyRow[] => {
  if (!root || typeof root !== 'object') return [];

  const rows: PropertyRow[] = [];
  const visited = new WeakSet<object>();
  const psetCounters = new Map<string, number>();

  const traverse = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach(traverse);
      return;
    }

    if (isIfcPropertySet(value)) {
      const typed = value as Record<string, unknown>;
      const rawNameCandidate =
        (typeof typed.Name === 'string' ? typed.Name : undefined) ??
        (typeof typed.GlobalId === 'string' ? typed.GlobalId : undefined) ??
        (typeof typed.GlobalID === 'string' ? typed.GlobalID : undefined) ??
        (typeof typed.id === 'string' ? typed.id : undefined) ??
        'Property Set';

      const rawName = typeof rawNameCandidate === 'string' ? rawNameCandidate.trim() : String(rawNameCandidate ?? '');
      const effectiveName = rawName.length ? rawName : 'Property Set';
      const psetKeyBase = sanitizeKey(effectiveName) || 'property-set';
      const occurrence = (psetCounters.get(psetKeyBase) ?? 0) + 1;
      psetCounters.set(psetKeyBase, occurrence);
      const collections = IFC_PROPERTY_COLLECTION_KEYS
        .map((key) => (Array.isArray((typed as any)[key]) ? ((typed as any)[key] as unknown[]) : null))
        .filter((collection): collection is unknown[] => Boolean(collection));

      if (collections.length) {
        const friendlyPsetName = prettifyLabel(effectiveName) || effectiveName;
        const propertyCounters = new Map<string, number>();
        collections.flat().forEach((property, index) => {
          if (!property || typeof property !== 'object') return;
          if (!isIfcPropertySingleValue(property)) return;

          const typedProperty = property as Record<string, unknown>;
          const nameCandidate =
            (typeof typedProperty.Name === 'string' ? typedProperty.Name : undefined) ??
            (typeof typedProperty.PropertyName === 'string' ? typedProperty.PropertyName : undefined);
          const fallbackName = `Property ${index + 1}`;
          const rawPropertyName = nameCandidate && nameCandidate.trim().length ? nameCandidate.trim() : fallbackName;
          const friendlyPropertyName = prettifyLabel(rawPropertyName) || rawPropertyName;
          const valueText = extractSingleValueText(property);

          const propertyKeyBase = sanitizeKey(rawPropertyName) || 'property';
          const occurrence = (propertyCounters.get(propertyKeyBase) ?? 0) + 1;
          propertyCounters.set(propertyKeyBase, occurrence);

          const label = `Property Sets / ${friendlyPsetName} / ${friendlyPropertyName}`;

          rows.push({
            label,
            value: valueText || '',
            rawPsetName: effectiveName,
            rawPropertyName,
          });
        });
      }
    }

    Object.values(value as Record<string, unknown>).forEach((child) => {
      if (child && typeof child === 'object') traverse(child);
    });
  };

  traverse(root);
  return rows;
};

const readName = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const typed = value as Record<string, unknown>;
  const primary = typeof typed.Name === 'string' ? typed.Name : undefined;
  const secondary = typeof (typed as any).name === 'string' ? (typed as any).name : undefined;
  const name = primary ?? secondary;
  if (!name) return undefined;
  const trimmed = name.trim();
  return trimmed.length ? trimmed : undefined;
};

const extractIfcClassFromData = (data: unknown): string => {
  if (!data || typeof data !== 'object') return 'IfcProduct';
  const typed = data as Record<string, unknown>;
  const candidates = [
    typed.ifcClass,
    typed.IfcClass,
    typed.type,
    typed.Type,
    typed.expressType,
    typed.ExpressType,
    typed.entity,
    typed.Entity,
    (typed.attributes as Record<string, unknown> | undefined)?.ifcClass,
    (typed.Attributes as Record<string, unknown> | undefined)?.IfcClass,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim();
    }
  }
  const fallback = findFirstValueByKeywords(data, ['ifcclass', 'ifc type', 'type']);
  if (fallback) return fallback;
  return 'IfcProduct';
};

const flattenPropertiesForIds = (data: unknown, globalId: string, ifcClass: string) => {
  const flattened: Record<string, unknown> = {};
  const psets: Record<string, Record<string, unknown>> = {};
  const attributes: Record<string, unknown> = {};

  const propertyRows = collectIfcPropertySetRows(data);
  propertyRows.forEach((row) => {
    const labelParts = row.label.split('/').map((part) => part.trim());
    const rawPset = row.rawPsetName ?? labelParts[1] ?? '';
    const rawProperty = row.rawPropertyName ?? labelParts[labelParts.length - 1] ?? '';
    const normalizedPset = normalizeIdsToken(rawPset);
    const normalizedProperty = normalizeIdsToken(rawProperty);
    if (!normalizedPset || !normalizedProperty) return;
    if (!psets[normalizedPset]) {
      psets[normalizedPset] = {};
    }
    if (!(normalizedProperty in psets[normalizedPset])) {
      psets[normalizedPset][normalizedProperty] = row.value;
    }
    const path = `${normalizedPset}.${normalizedProperty}`;
    if (!(path in flattened)) {
      flattened[path] = row.value;
    }
  });

  flattened.GlobalId = globalId;
  flattened.ifcClass = ifcClass;
  attributes.ifcClass = ifcClass;
  flattened['Attributes.ifcClass'] = ifcClass;

  const name = readName(data);
  if (name) {
    attributes.Name = name;
    flattened['Attributes.Name'] = name;
  }

  const category = findFirstValueByKeywords(data, ['category', 'ifccategory']);
  if (category) {
    attributes.Category = category;
    flattened['Attributes.Category'] = category;
  }

  const typeValue = findFirstValueByKeywords(data, ['type', 'typename']);
  if (typeValue) {
    attributes.Type = typeValue;
    flattened['Attributes.Type'] = typeValue;
  }

  return { flattened, psets, attributes };
};

let accumulated: ElementData[] = [];
let seenIds = new Set<string>();
let total = 0;
let done = 0;
let cancelled = false;

const resetState = () => {
  accumulated = [];
  seenIds = new Set<string>();
  total = 0;
  done = 0;
  cancelled = false;
};

const handleBuildRequest = (data: BuildRequest) => {
  if (data.reset) {
    resetState();
  }
  if (typeof data.total === 'number' && !Number.isNaN(data.total)) {
    total = data.total;
  }
  if (cancelled) return;
  if (Array.isArray(data.elements) && data.elements.length) {
    for (const item of data.elements) {
      if (cancelled) break;
      const globalId = item.globalId?.trim();
      if (!globalId || seenIds.has(globalId)) continue;
      const rawData = item.data;
      if (!rawData || typeof rawData !== 'object') continue;
      const ifcClass = item.ifcClass && item.ifcClass.trim().length ? item.ifcClass.trim() : extractIfcClassFromData(rawData);
      const { flattened } = flattenPropertiesForIds(rawData, globalId, ifcClass);
      const element: ElementData = {
        GlobalId: globalId,
        ifcClass,
        properties: flattened,
      };
      seenIds.add(globalId);
      accumulated.push(element);
    }
    done = Math.min(accumulated.length, total || accumulated.length);
    const progress: ProgressMessage = { type: 'progress', done, total: total || Math.max(accumulated.length, done) };
    ctx.postMessage(progress satisfies WorkerOutMessage);
  }
  if (data.final) {
    if (cancelled) {
      const error: ErrorMessage = { type: 'error', message: 'Build cancelled' };
      ctx.postMessage(error satisfies WorkerOutMessage);
    } else {
      const doneMessage: DoneMessage = {
        type: 'done',
        elements: accumulated,
      };
      ctx.postMessage(doneMessage satisfies WorkerOutMessage);
    }
    resetState();
  }
};

ctx.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;
  if (!message) return;
  switch (message.type) {
    case 'build-props':
      handleBuildRequest(message);
      break;
    case 'cancel':
      cancelled = true;
      ctx.postMessage({ type: 'error', message: 'Build cancelled' } satisfies WorkerOutMessage);
      resetState();
      break;
    default:
      ctx.postMessage({ type: 'error', message: 'Unknown message type' } satisfies WorkerOutMessage);
  }
};
