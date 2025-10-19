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

const extractNominalValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value !== 'object') {
    const formatted = formatPrimitive(value);
    return normalizeValueCharacters(formatted);
  }
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
  const formatted = formatPrimitive(value);
  return normalizeValueCharacters(formatted);
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

const PROPERTY_SET_CONTAINER_KEYS = ['IsDefinedBy', 'isDefinedBy', 'psets', 'Psets', 'propertySets', 'PropertySets', 'property_sets', 'Property_Sets'] as const;

const PROPERTY_SET_METADATA_KEYS = new Set([
  'type',
  'Type',
  'id',
  'ID',
  'expressID',
  'ExpressID',
  'expressId',
  'globalId',
  'GlobalId',
  'GlobalID',
  'guid',
  'Guid',
  'GUID',
  '_t',
  '_type',
  '_id',
  '_guid',
]);

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

  type PropertySetMeta = { rawName: string; friendlyName: string; uniqueKey: string };

  const makePropertySetMeta = (rawNameCandidate: unknown): PropertySetMeta => {
    let rawName: string | undefined;
    if (typeof rawNameCandidate === 'string') {
      const trimmed = rawNameCandidate.trim();
      if (trimmed.length) rawName = trimmed;
    }
    if (!rawName && rawNameCandidate && typeof rawNameCandidate === 'object') {
      const typed = rawNameCandidate as Record<string, unknown>;
      const name = readName(rawNameCandidate) ?? (typeof typed.Name === 'string' ? typed.Name : undefined);
      const alt = typeof typed.id === 'string' ? typed.id : undefined;
      rawName = (name ?? alt) as string | undefined;
    }
    if (!rawName || !rawName.length) rawName = 'Property Set';
    const friendlyName = prettifyLabel(rawName) || rawName;
    const base = sanitizeKey(rawName) || 'property-set';
    const occurrence = (psetCounters.get(base) ?? 0) + 1;
    psetCounters.set(base, occurrence);
    return { rawName, friendlyName, uniqueKey: `${base}-${occurrence}` };
  };

  const ensureSingleValue = (propertyName: string, rawValue: unknown, index: number): Record<string, unknown> => {
    const fallback = `Property ${index + 1}`;
    const effectiveName = propertyName && propertyName.trim().length ? propertyName.trim() : fallback;
    if (isIfcPropertySingleValue(rawValue)) {
      const source = rawValue as Record<string, unknown>;
      const copy: Record<string, unknown> = { ...source };
      if (copy.Name == null && copy.PropertyName == null) {
        copy.Name = effectiveName;
      }
      if (copy.PropertyName == null) {
        copy.PropertyName = (copy.Name as string | undefined) ?? effectiveName;
      }
      if (copy.__rawValue == null) {
        copy.__rawValue = rawValue;
      }
      return copy;
    }
    if (rawValue && typeof rawValue === 'object') {
      const typed = rawValue as Record<string, unknown>;
      const clone: Record<string, unknown> = { ...typed };
      if (clone.Name == null && clone.PropertyName == null) {
        clone.Name = effectiveName;
      }
      if (clone.PropertyName == null) {
        clone.PropertyName = (clone.Name as string | undefined) ?? effectiveName;
      }
      if (clone.type == null && clone.Type == null) {
        clone.type = 'IFCPROPERTYSINGLEVALUE';
      }
      if (!('NominalValue' in clone) && !('nominalValue' in clone) && !('Value' in clone) && !('value' in clone)) {
        clone.NominalValue = rawValue;
      }
      if (clone.__rawValue == null) {
        clone.__rawValue = rawValue;
      }
      return clone;
    }
    return {
      type: 'IFCPROPERTYSINGLEVALUE',
      Name: effectiveName,
      PropertyName: effectiveName,
      NominalValue: rawValue,
      __rawValue: rawValue,
    };
  };

  const buildSyntheticPropertySet = (rawName: string, source: unknown): Record<string, unknown> => {
    const properties: Record<string, unknown>[] = [];
    const pushProperty = (candidateName: unknown, value: unknown) => {
      const fallback = `Property ${properties.length + 1}`;
      const candidateObj = candidateName as Record<string, unknown> | undefined;
      const rawPropertyName =
        (typeof candidateName === 'string' && candidateName.trim().length ? candidateName.trim() : undefined) ??
        readName(candidateName) ??
        (typeof candidateObj?.Name === 'string' ? (candidateObj.Name as string) : undefined) ??
        (typeof candidateObj?.PropertyName === 'string' ? (candidateObj.PropertyName as string) : undefined) ??
        fallback;
      properties.push(ensureSingleValue(rawPropertyName, value, properties.length));
    };

    if (source && typeof source === 'object') {
      const typed = source as Record<string, unknown>;
      for (const key of IFC_PROPERTY_COLLECTION_KEYS) {
        const collection = typed[key as keyof typeof typed];
        if (Array.isArray(collection) && collection.length) {
          collection.forEach((entry) => pushProperty(entry, entry));
        }
      }
    }

    if (!properties.length) {
      if (Array.isArray(source)) {
        source.forEach((entry) => pushProperty(entry, entry));
      } else if (source && typeof source === 'object') {
        for (const [propKey, propValue] of Object.entries(source as Record<string, unknown>)) {
          if (propValue == null) continue;
          if (PROPERTY_SET_METADATA_KEYS.has(propKey)) continue;
          if (IFC_PROPERTY_COLLECTION_KEYS.includes(propKey as any)) continue;
          if (PROPERTY_SET_CONTAINER_KEYS.includes(propKey as any)) continue;
          pushProperty(propKey, propValue);
        }
      } else if (source != null) {
        pushProperty(undefined, source);
      }
    }

    return {
      type: 'IFCPROPERTYSET',
      Name: rawName,
      HasProperties: properties,
    } as Record<string, unknown>;
  };

  const emitPropertySetRows = (meta: PropertySetMeta, candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return;
    const synthetic = buildSyntheticPropertySet(meta.rawName, candidate);
    const list = Array.isArray((synthetic as any).HasProperties) ? ((synthetic as any).HasProperties as Record<string, unknown>[]) : [];
    if (!list.length) return;

    const friendlyPsetName = meta.friendlyName;

    list.forEach((property, index) => {
      const typedProp = property as Record<string, unknown>;
      
      // Handle nested Name.value structure from fragments library
      let nameCandidate: string | undefined;
      if (typeof typedProp.Name === 'string') {
        nameCandidate = typedProp.Name;
      } else if (typedProp.Name && typeof typedProp.Name === 'object') {
        const nameObj = typedProp.Name as Record<string, unknown>;
        if (typeof nameObj.value === 'string') {
          nameCandidate = nameObj.value;
        }
      }
      
      if (!nameCandidate && typeof typedProp.PropertyName === 'string') {
        nameCandidate = typedProp.PropertyName;
      }
      
      if (!nameCandidate) {
        nameCandidate = `Property ${index + 1}`;
      }
      
      const friendlyPropertyName = prettifyLabel(nameCandidate) || nameCandidate;
      const valueText = extractSingleValueText(property);

      rows.push({
        label: `Property Sets / ${friendlyPsetName} / ${friendlyPropertyName}`,
        value: valueText || '',
        rawPsetName: meta.rawName,
        rawPropertyName: nameCandidate,
      });
    });
  };

  const processDeclarativeContainer = (container: unknown) => {
    if (!container || typeof container !== 'object') return;
    if (visited.has(container as object)) return;
    visited.add(container as object);

    if (Array.isArray(container)) {
      container.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const meta = makePropertySetMeta(entry);
        const target = isIfcPropertySet(entry) ? (entry as Record<string, unknown>) : buildSyntheticPropertySet(meta.rawName, entry);
        emitPropertySetRows(meta, target);
        visited.add(entry as object);
      });
      return;
    }

    for (const [psetName, rawValue] of Object.entries(container as Record<string, unknown>)) {
      if (rawValue == null) continue;
      const meta = makePropertySetMeta(psetName);
      const target = isIfcPropertySet(rawValue) ? (rawValue as Record<string, unknown>) : buildSyntheticPropertySet(meta.rawName, rawValue);
      emitPropertySetRows(meta, target);
      if (rawValue && typeof rawValue === 'object') {
        visited.add(rawValue as object);
      }
    }
  };

  const traverse = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach(traverse);
      return;
    }

    // Process property set containers first
    let hasProcessedContainers = false;
    for (const key of PROPERTY_SET_CONTAINER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const container = (value as Record<string, unknown>)[key];
        processDeclarativeContainer(container);
        hasProcessedContainers = true;
      }
    }

    if (isIfcPropertySet(value)) {
      const meta = makePropertySetMeta(value);
      emitPropertySetRows(meta, value);
    }

    // Only traverse deeper if we haven't already processed property set containers
    // and this isn't a property set itself (to avoid double processing)
    if (!hasProcessedContainers && !isIfcPropertySet(value)) {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        // Skip known container keys and metadata keys to prevent duplication
        if (PROPERTY_SET_CONTAINER_KEYS.includes(key as any)) return;
        if (PROPERTY_SET_METADATA_KEYS.has(key)) return;
        if (IFC_PROPERTY_COLLECTION_KEYS.includes(key as any)) return;
        if (child && typeof child === 'object') traverse(child);
      });
    }
  };

  traverse(root);
  
  // Aggressive deduplication pass: remove duplicate rows based on multiple strategies
  const seen = new Map<string, PropertyRow>();
  const labelValueSeen = new Set<string>();
  
  for (const row of rows) {
    // Strategy 1: Exact match on label + value
    const labelValueKey = `${row.label}::${row.value}`;
    if (labelValueSeen.has(labelValueKey)) {
      continue; // Skip duplicate
    }
    
    // Strategy 2: Match on full property path including pset and property names
    const fullKey = `${row.rawPsetName || 'unknown'}::${row.rawPropertyName || 'unknown'}::${row.value}`;
    if (seen.has(fullKey)) {
      continue; // Skip duplicate
    }
    
    // This is a unique property, keep it
    labelValueSeen.add(labelValueKey);
    seen.set(fullKey, row);
  }
  
  return Array.from(seen.values());
};

const readName = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const typed = value as Record<string, unknown>;
  
  // Handle fragments library nested value structure: { Name: { value: "string" } }
  let primary: string | undefined;
  if (typeof typed.Name === 'string') {
    primary = typed.Name;
  } else if (typed.Name && typeof typed.Name === 'object') {
    const nameObj = typed.Name as Record<string, unknown>;
    if (typeof nameObj.value === 'string') {
      primary = nameObj.value;
    }
  }
  
  const secondary = typeof (typed as any).name === 'string' ? (typed as any).name : undefined;
  const name = primary ?? secondary;
  if (!name) return undefined;
  const trimmed = name.trim();
  return trimmed.length ? trimmed : undefined;
};

const extractIfcClassFromData = (data: unknown): string => {
  if (!data || typeof data !== 'object') return 'IfcProduct';
  const typed = data as Record<string, unknown>;
  
  // Property value types that should NOT be treated as entity classes
  const PROPERTY_TYPES = new Set([
    'IFCIDENTIFIER', 'IFCLABEL', 'IFCTEXT', 'IFCBOOLEAN', 'IFCINTEGER', 'IFCREAL',
    'IFCLENGTHMEASURE', 'IFCPOSITIVELENGTHMEASURE', 'IFCAREAMEASURE', 'IFCVOLUMEMEASURE',
    'IFCPOSITIVERATIOMEASURE', 'IFCPLANEANGLEMEASURE', 'IFCPOSITIVEINTEGER', 'IFCLOGICAL'
  ]);
  
  // 1. Check if data is a web-ifc constructor instance
  if (typed.constructor && typeof typed.constructor === 'function' && typed.constructor.name) {
    const constructorName = typed.constructor.name.toUpperCase();
    if (constructorName.startsWith('IFC') && !PROPERTY_TYPES.has(constructorName)) {
      return constructorName;
    }
  }
  
  // 2. Check _category.value (fragments library pattern)
  if (typed._category && typeof typed._category === 'object') {
    const category = typed._category as Record<string, unknown>;
    if (category.value && typeof category.value === 'string') {
      const categoryValue = category.value.trim().toUpperCase();
      if (categoryValue.startsWith('IFC') && !PROPERTY_TYPES.has(categoryValue)) {
        return categoryValue;
      }
    }
  }
  
  // 3. Check standard fields
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
      const trimmed = candidate.trim().toUpperCase();
      // Filter out property types
      if (!PROPERTY_TYPES.has(trimmed)) {
        return candidate.trim(); // Return original casing
      }
    }
  }
  
  // 4. Fallback keyword search (but filter property types)
  const fallback = findFirstValueByKeywords(data, ['ifcclass', 'ifc type', 'type']);
  if (fallback) {
    const fallbackUpper = fallback.trim().toUpperCase();
    if (!PROPERTY_TYPES.has(fallbackUpper)) {
      return fallback;
    }
  }
  
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
  attributes.GlobalId = globalId;
  flattened['Attributes.GlobalId'] = globalId;
  flattened['Attributes.IfcClass'] = ifcClass;
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

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value == null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) continue;
      const nominal = extractNominalValue(value);
      if (!nominal) continue;
      const cleaned = String(key).replace(/^_+/, '');
      const attrKey = `Attributes.${prettifyLabel(cleaned)}`;
      if (!(attrKey in flattened)) flattened[attrKey] = nominal;
      if (!(cleaned in attributes)) attributes[cleaned] = nominal;
      if (/guid|globalid|_guid/i.test(key)) {
        const candidate = nominal.trim();
        if (candidate && !flattened.GlobalId) {
          flattened.GlobalId = candidate;
          attributes.GlobalId = candidate;
          flattened['Attributes.GlobalId'] = candidate;
        }
      }
    }
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
