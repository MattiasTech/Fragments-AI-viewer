import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';
import * as FRAGS from '@thatopen/fragments';
import * as BUI from '@thatopen/ui';
import * as BUIC from '@thatopen/ui-obc';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import LinearProgress from '@mui/material/LinearProgress';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Alert from '@mui/material/Alert';
import Draggable from 'react-draggable';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import ViewListIcon from '@mui/icons-material/ViewList';
import ChatIcon from '@mui/icons-material/Chat';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import * as THREE from 'three';
import Stats from 'stats.js';
import ChatWindow, { SelectionCommand } from './ChatWindow';

type Selection = { modelId: string; localId: number };

type PropertyRow = {
  label: string;
  value: string;
  path: string;
  searchText: string;
};

type PropertyNode = {
  id: string;
  label: string;
  fullLabel: string;
  value?: string;
  children: PropertyNode[];
  searchText: string;
};

type PropertyTabId = 'favorites' | 'all';

type ModelSummary = {
  modelId: string;
  label: string;
  elementCount: number;
  instancedCount: number;
  meshCount: number;
  categoryCounts: { category: string; count: number }[];
  bboxSize: { x: number; y: number; z: number };
  bboxCenter: { x: number; y: number; z: number };
  collectedAt: number;
};

const FILTER_KEY_ALIASES: Record<string, string[]> = {
  category: ['category', 'ifccategory', 'ifcclass', 'class'],
  type: ['type', 'ifctype', 'typemark', 'typename'],
  system: ['system', 'systemtype'],
  name: ['name', 'label', 'description'],
  material: ['material', 'materialname'],
  guid: ['guid', 'globalid', 'global id'],
  globalid: ['globalid', 'guid', 'global id'],
  family: ['family', 'familyname'],
  level: ['level', 'storey', 'story', 'buildingstorey'],
  discipline: ['discipline'],
  phase: ['phase'],
};

const pickCategoryLabel = (userData: Record<string, any>, fallback: string): string => {
  if (!userData) return fallback;
  const candidates = [
    userData.ifcCategory,
    userData.Category,
    userData.category,
    userData.ifcClass,
    userData.class,
    userData.type,
    userData.Type,
    userData.system,
    userData.System,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (Array.isArray(userData.categories) && userData.categories.length) {
    const first = userData.categories.find((entry: any) => typeof entry === 'string' && entry.trim());
    if (first) return first.trim();
  }
  if (typeof userData.name === 'string' && userData.name.trim()) return userData.name.trim();
  if (typeof userData.Name === 'string' && userData.Name.trim()) return userData.Name.trim();
  if (typeof userData.label === 'string' && userData.label.trim()) return userData.label.trim();
  return fallback;
};

const computeModelSummary = (modelId: string, label: string, object: THREE.Object3D): ModelSummary => {
  const categoryMap = new Map<string, number>();
  let elementCount = 0;
  let instancedCount = 0;
  let meshCount = 0;

  object.traverse((node: any) => {
    const isInstanced = Boolean(node?.isInstancedMesh);
    const isMesh = Boolean(node?.isMesh);
    if (!isInstanced && !isMesh) return;

    let addition = 0;
    if (isInstanced) {
      let candidate = 0;
      if (typeof node.count === 'number') candidate = node.count;
      else if (typeof node.instanceCount === 'number') candidate = node.instanceCount;
      else if (Array.isArray(node.instanceIdMap)) candidate = node.instanceIdMap.length;
      else if (Array.isArray(node.userData?.ids)) candidate = node.userData.ids.length;
      else if (typeof node.userData?.size === 'number') candidate = node.userData.size;
      if (Number.isFinite(candidate) && candidate > 0) {
        addition = candidate;
        instancedCount += candidate;
      }
    } else {
      addition = 1;
      meshCount += 1;
    }

    if (addition <= 0) {
      addition = 1;
    }

    elementCount += addition;

    const category = pickCategoryLabel(node?.userData ?? {}, node?.type ?? 'Mesh');
    const previous = categoryMap.get(category) ?? 0;
    categoryMap.set(category, previous + addition);
  });

  const categories = Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const bbox = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  return {
    modelId,
    label,
    elementCount,
    instancedCount,
    meshCount,
    categoryCounts: categories,
    bboxSize: { x: size.x, y: size.y, z: size.z },
    bboxCenter: { x: center.x, y: center.y, z: center.z },
    collectedAt: Date.now(),
  };
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

const truncateDisplayValue = (value: string, maxLength = 200): string => {
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
};

const formatPrimitive = (value: any): string => {
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

const extractNominalValue = (value: any): string => {
  if (value == null) return '';
  if (typeof value !== 'object') return formatPrimitive(value);
  if ('value' in value) return extractNominalValue(value.value);
  if ('Value' in value) return extractNominalValue(value.Value);
  if (Array.isArray(value)) {
    return value.map((entry) => extractNominalValue(entry)).filter(Boolean).join(', ');
  }
  if (typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number') {
    return `${formatPrimitive(value.x)}, ${formatPrimitive(value.y)}, ${formatPrimitive(value.z)}`;
  }
  return formatPrimitive(value);
};

const findFirstValueByKeywords = (source: any, keywords: string[]): string | undefined => {
  if (!source || typeof source !== 'object') return undefined;
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  const visited = new WeakSet<object>();
  const stack: any[] = [source];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) {
        if (entry && typeof entry === 'object') {
          stack.push(entry);
        }
      }
      continue;
    }
    for (const [key, value] of Object.entries(current as Record<string, any>)) {
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

const summariseItemDataForAI = (data: any, detailLimit: number): string => {
  if (!data || typeof data !== 'object') {
    return stringifyLimited(data, 300);
  }
  const parts: string[] = [];
  const name = readName(data) ?? findFirstValueByKeywords(data, ['name', 'label', 'description']);
  if (name) parts.push(`name:${name}`);
  const category = findFirstValueByKeywords(data, ['category', 'ifcclass', 'ifc type', 'type']);
  if (category) parts.push(`category:${category}`);
  const globalId = findFirstValueByKeywords(data, ['globalid', 'global id', 'guid']);
  if (globalId) parts.push(`globalId:${globalId}`);
  const expressId = findFirstValueByKeywords(data, ['expressid', 'express id']);
  if (expressId && expressId !== globalId) parts.push(`expressId:${expressId}`);
  if (detailLimit > 0) {
    try {
      const { rows } = buildPropertyData(data);
      if (rows.length) {
        const detailRows = rows.slice(0, detailLimit);
        const detail = detailRows.map((row) => `${row.label}=${row.value}`).join(' | ');
        if (detail) parts.push(`props:${detail}`);
        if (rows.length > detailLimit) {
          parts.push(`propsTruncated:${rows.length - detailLimit}`);
        }
      }
    } catch (err) {
      console.warn('Failed to build detailed property data for AI summary', err);
    }
  }
  const summary = parts.filter(Boolean).join(' | ');
  if (!summary) {
    return stringifyLimited(data, 300);
  }
  return summary.length > 1200 ? `${summary.slice(0, 1200)}…` : summary;
};

const TOP_LEVEL_LABELS: Record<string, string> = {
  attributes: 'Attributes',
  psets: 'Property Sets',
  qsets: 'Quantity Sets',
  type: 'Type',
  materials: 'Materials',
  classification: 'Classification',
  systems: 'Systems',
  expressID: 'Express ID',
  expressId: 'Express ID',
  GlobalId: 'Global Id',
  globalId: 'Global Id',
};

const IGNORED_TOP_LEVEL_KEYS = new Set<string>(['modelIdMap']);
const sanitizeKey = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/-{2,}/g, '-').replace(/(^-|-$)/g, '').toLowerCase();

const IFC_PROPERTY_COLLECTION_KEYS = ['HasProperties', 'hasProperties', 'Properties', 'properties'] as const;

const isIfcPropertySet = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false;
  const typeField = typeof value.type === 'string' ? value.type : typeof value.Type === 'string' ? value.Type : undefined;
  if (typeField && typeField.toUpperCase() === 'IFCPROPERTYSET') return true;
  return IFC_PROPERTY_COLLECTION_KEYS.some((key) => Array.isArray((value as any)[key]));
};

const isIfcPropertySingleValue = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false;
  const typeField = typeof value.type === 'string' ? value.type : typeof value.Type === 'string' ? value.Type : undefined;
  if (typeField && typeField.toUpperCase() === 'IFCPROPERTYSINGLEVALUE') return true;
  return 'NominalValue' in value || 'nominalValue' in value;
};

const extractSingleValueText = (property: any): string => {
  if (!property || typeof property !== 'object') return formatPrimitive(property);
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
    if (!(key in property)) continue;
    const entry = (property as any)[key];
    if (entry == null) continue;
    if (Array.isArray(entry)) {
      const joined = entry.map((item) => extractNominalValue(item)).filter(Boolean).join(', ');
      if (joined) return joined;
      continue;
    }
    const resolved = extractNominalValue(entry);
    if (resolved) return resolved;
  }

  for (const [key, value] of Object.entries(property as Record<string, any>)) {
    if ((typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && key.toLowerCase().includes('value')) {
      const formatted = formatPrimitive(value);
      if (formatted) return formatted;
    }
  }

  return '';
};

const extractPropertySetRows = (pset: Record<string, any>, rawName: string, uniquePsetKey: string): PropertyRow[] => {
  const collections = IFC_PROPERTY_COLLECTION_KEYS
    .map((key) => (Array.isArray((pset as any)[key]) ? ((pset as any)[key] as any[]) : null))
    .filter((collection): collection is any[] => Boolean(collection));

  if (!collections.length) return [];

  const friendlyPsetName = prettifyLabel(rawName) || rawName;
  const rows: PropertyRow[] = [];
  const propertyCounters = new Map<string, number>();

  collections.flat().forEach((property, index) => {
    if (!property || typeof property !== 'object') return;
    if (!isIfcPropertySingleValue(property)) return;

    const nameCandidate = readName(property) ?? (typeof property.Name === 'string' ? property.Name : undefined) ?? (typeof property.PropertyName === 'string' ? property.PropertyName : undefined);
    const fallbackName = `Property ${index + 1}`;
    const rawPropertyName = nameCandidate && nameCandidate.trim().length ? nameCandidate.trim() : fallbackName;
    const friendlyPropertyName = prettifyLabel(rawPropertyName) || rawPropertyName;
    const valueText = extractSingleValueText(property);

    const propertyKeyBase = sanitizeKey(rawPropertyName) || 'property';
    const occurrence = (propertyCounters.get(propertyKeyBase) ?? 0) + 1;
    propertyCounters.set(propertyKeyBase, occurrence);
    const uniquePropertyKey = `${propertyKeyBase}-${occurrence}`;

    const label = `Property Sets / ${friendlyPsetName} / ${friendlyPropertyName}`;
    const searchPieces = [label.toLowerCase()];
    if (valueText) {
      searchPieces.push(valueText.toLowerCase());
    }

    rows.push({
      label,
      value: valueText || '',
      path: `property-sets/${uniquePsetKey}/${uniquePropertyKey}`,
      searchText: searchPieces.join(' ').trim(),
    });
  });

  return rows;
};

const collectIfcPropertySetRows = (root: any): PropertyRow[] => {
  if (!root || typeof root !== 'object') return [];

  const rows: PropertyRow[] = [];
  const visited = new WeakSet<object>();
  const psetCounters = new Map<string, number>();

  const traverse = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(traverse);
      return;
    }

    if (isIfcPropertySet(value)) {
      const rawNameCandidate =
        readName(value) ??
        (typeof (value as any).GlobalId === 'string' ? (value as any).GlobalId : undefined) ??
        (typeof (value as any).GlobalID === 'string' ? (value as any).GlobalID : undefined) ??
        (typeof (value as any).id === 'string' ? (value as any).id : undefined) ??
        'Property Set';

      const rawName = typeof rawNameCandidate === 'string' ? rawNameCandidate.trim() : String(rawNameCandidate ?? '');
      const effectiveName = rawName.length ? rawName : 'Property Set';
      const psetKeyBase = sanitizeKey(effectiveName) || 'property-set';
      const occurrence = (psetCounters.get(psetKeyBase) ?? 0) + 1;
      psetCounters.set(psetKeyBase, occurrence);
      const uniquePsetKey = `${psetKeyBase}-${occurrence}`;

      rows.push(...extractPropertySetRows(value as Record<string, any>, effectiveName, uniquePsetKey));
    }

    Object.values(value as Record<string, any>).forEach((child) => {
      if (child && typeof child === 'object') traverse(child);
    });
  };

  traverse(root);
  return rows;
};

const FAVORITES_STORAGE_KEY = 'fragmentsViewer.favoritePropertyPaths';
const MAX_DISPLAY_PROPERTY_ROWS = 200;
const MAX_SEARCH_RESULTS = 200;

const readName = (value: any): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const primary = typeof value.Name === 'string' ? value.Name : undefined;
  const secondary = typeof (value as any).name === 'string' ? (value as any).name : undefined;
  const name = primary ?? secondary;
  if (!name) return undefined;
  const trimmed = name.trim();
  return trimmed.length ? trimmed : undefined;
};

const buildPropertyData = (item: Record<string, any> | null | undefined): { rows: PropertyRow[]; tree: PropertyNode[] } => {
  if (!item || typeof item !== 'object') return { rows: [], tree: [] };

  const rows: PropertyRow[] = [];
  const visited = new WeakSet<object>();

  const visit = (value: any, labelParts: string[], keyParts: string[]): PropertyNode | null => {
    if (value == null) return null;

    const displayParts = labelParts.map((part) => {
      const trimmed = part?.trim?.() ?? part;
      if (typeof trimmed === 'string' && trimmed.length) {
        return prettifyLabel(trimmed) || trimmed;
      }
      return typeof part === 'string' ? part : String(part ?? '');
    });
    const fullLabel = displayParts.filter(Boolean).join(' / ');
    const idBase = keyParts.length ? keyParts.join('/') : sanitizeKey(fullLabel || 'value');
    const label = displayParts[displayParts.length - 1] ?? 'Value';

    const pushRow = (valueText?: string) => {
      const lowerLabel = fullLabel.toLowerCase();
      const searchPieces = [lowerLabel];
      if (valueText) searchPieces.push(valueText.toLowerCase());
      const searchText = searchPieces.join(' ').trim() || lowerLabel;
      const row: PropertyRow = {
        label: fullLabel,
        value: valueText ?? '',
        path: idBase,
        searchText,
      };
      rows.push(row);
      return searchText;
    };

    if (typeof value !== 'object' || value instanceof Date) {
      const valueText = formatPrimitive(value);
      const searchText = pushRow(valueText);
      return { id: idBase, label, fullLabel, value: valueText || undefined, children: [], searchText };
    }

    if (visited.has(value)) {
      const valueText = '[Circular reference]';
      const searchText = pushRow(valueText);
      return { id: idBase, label, fullLabel, value: valueText, children: [], searchText };
    }
    visited.add(value);

    let nodeValue: string | undefined;
    const children: PropertyNode[] = [];

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        const childName = readName(child);
        const fallbackLabel = `${label} ${index + 1}`;
        const resolvedLabel = childName && childName.trim().length ? childName.trim() : fallbackLabel;
        const childLabel = prettifyLabel(resolvedLabel) || resolvedLabel;
        const childKey = childName && childName.trim().length ? sanitizeKey(childName) : String(index);
        const childNode = visit(child, [...labelParts, childLabel], [...keyParts, childKey]);
        if (childNode) children.push(childNode);
      });
      if (children.length === 0) {
        nodeValue = formatPrimitive(value);
      }
    } else {
      // Nominal value takes priority for display
      if ('NominalValue' in value || 'nominalValue' in value) {
        const base = (value as any).NominalValue ?? (value as any).nominalValue;
        const nominal = extractNominalValue(base);
        if (nominal) nodeValue = nominal;
      }

      if (!nodeValue && 'value' in value && typeof (value as any).value !== 'object') {
        nodeValue = formatPrimitive((value as any).value);
      }

      if (!nodeValue && 'Value' in value && typeof (value as any).Value !== 'object') {
        nodeValue = formatPrimitive((value as any).Value);
      }

      for (const [entryKey, childVal] of Object.entries(value as Record<string, any>)) {
        if (childVal == null) continue;
        if (entryKey === 'Name' || entryKey === 'name') continue;
        if (entryKey === 'NominalValue' || entryKey === 'nominalValue') {
          const nominalLabel = prettifyLabel('Nominal Value') || 'Nominal Value';
          const childNode = visit(childVal, [...labelParts, nominalLabel], [...keyParts, 'nominal-value']);
          if (childNode) children.push(childNode);
          continue;
        }
        const friendlyRaw = TOP_LEVEL_LABELS[entryKey] ?? entryKey;
        const friendly = prettifyLabel(friendlyRaw) || friendlyRaw;
        const childName = readName(childVal)?.trim();
        const childLabel = childName && childName.length ? prettifyLabel(childName) || childName : friendly;
        const childKeyPart = childName && childName.length ? sanitizeKey(childName) : sanitizeKey(friendlyRaw);
        const nextLabelParts = [...labelParts, childLabel];
        const childNode = visit(childVal, nextLabelParts, [...keyParts, childKeyPart]);
        if (childNode) children.push(childNode);
      }

      if (!nodeValue && children.length === 0) {
        nodeValue = formatPrimitive(value);
      }
    }

    const searchText = pushRow(nodeValue);
    return { id: idBase, label, fullLabel, value: nodeValue, children, searchText };
  };

  const tree: PropertyNode[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (value == null || IGNORED_TOP_LEVEL_KEYS.has(key)) continue;
    const friendly = TOP_LEVEL_LABELS[key] ?? key;
    const node = visit(value, [friendly], [key]);
    if (node) tree.push(node);
  }

  if (rows.length) {
    const filtered = rows.filter((row) => {
      const lower = row.label.toLowerCase();
      if (!lower.startsWith('property sets /')) return true;
      if (lower.includes('/ has properties')) return false;
      if (lower.includes('/ nominal value')) return false;
      return true;
    });
    if (filtered.length !== rows.length) {
      rows.splice(0, rows.length, ...filtered);
    }
  }

  const propertySetRows = collectIfcPropertySetRows(item);
  if (propertySetRows.length) {
    const dedupedPropertySetRows: PropertyRow[] = [];
    const propertySetPathSet = new Set<string>();

    for (const row of propertySetRows) {
      if (propertySetPathSet.has(row.path)) continue;
      propertySetPathSet.add(row.path);
      dedupedPropertySetRows.push(row);
    }

    const remainingRows: PropertyRow[] = [];
    for (const row of rows) {
      if (propertySetPathSet.has(row.path)) {
        // Skip older representation of the same property-set entry; we'll use the enriched one.
        continue;
      }
      remainingRows.push(row);
    }

    rows.splice(0, rows.length, ...dedupedPropertySetRows, ...remainingRows);
  }

  return { rows, tree };
};

const App: React.FC = () => {
  // DOM & engine refs
  const viewerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const worldRef = useRef<OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer> | null>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const fragmentsRef = useRef<OBC.FragmentsManager | null>(null);
  const ifcImporterRef = useRef<FRAGS.IfcImporter | null>(null);
  const currentModelIdRef = useRef<string | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [selectedItems, setSelectedItems] = useState<Selection[]>([]);
  const [properties, setProperties] = useState<Record<string, any> | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [isExplorerMinimized, setIsExplorerMinimized] = useState(false);
  const [ifcProgress, setIfcProgress] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [componentsReady, setComponentsReady] = useState(false);
  const ifcAbortRef = useRef<AbortController | null>(null);
  const ifcCancelledRef = useRef<boolean>(false);
  const navCubeRef = useRef<HTMLCanvasElement | null>(null);
  const navCubeState = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; cube: THREE.Mesh } | null>(null);
  const selectionMarkerRef = useRef<THREE.Group | null>(null);
  const prevInstanceHighlightRef = useRef<{ mesh: THREE.InstancedMesh; index: number } | null>(null);
  const aiSelectionSeqRef = useRef(0);
  const highlighterRef = useRef<any>(null);
  const [explorerSize, setExplorerSize] = useState({ width: 360, height: 520 });
  const explorerResizeOriginRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const explorerResizingRef = useRef(false);
  const explorerNodeRef = useRef<HTMLDivElement | null>(null);
  const uiInitializedRef = useRef(false);
  const modelsListContainerRef = useRef<HTMLDivElement | null>(null);
  const modelsListElementRef = useRef<HTMLElement | null>(null);
  const updateModelsListRef = useRef<ReturnType<typeof BUIC.tables.modelsList>[1] | null>(null);
  const modelTreeContainerRef = useRef<HTMLDivElement | null>(null);
  const modelTreeElementRef = useRef<HTMLElement | null>(null);
  const updateModelTreeRef = useRef<ReturnType<typeof BUIC.tables.spatialTree>[1] | null>(null);
  const lastModelTreeContainerRef = useRef<HTMLDivElement | null>(null);
  const hiderRef = useRef<OBC.Hider | null>(null);
  const selectedRef = useRef<Selection[]>([]);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [propertyRows, setPropertyRows] = useState<PropertyRow[]>([]);
  const [selectionSearch, setSelectionSearch] = useState('');
  const [modelTreeSearch, setModelTreeSearch] = useState('');
  const [favoritePropertyPaths, setFavoritePropertyPaths] = useState<string[]>([]);
  const [selectedPropertyTab, setSelectedPropertyTab] = useState<PropertyTabId>('favorites');
  const [isModelsSectionCollapsed, setIsModelsSectionCollapsed] = useState(false);
  const [isSelectionPropertiesCollapsed, setIsSelectionPropertiesCollapsed] = useState(false);
  const [isModelTreeCollapsed, setIsModelTreeCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatExpandSignal, setChatExpandSignal] = useState(0);
  const [modelSummaries, setModelSummaries] = useState<Record<string, ModelSummary>>({});
  const [lastItemsDataTSV, setLastItemsDataTSV] = useState<string | null>(null);
  const [lastItemsDataRows, setLastItemsDataRows] = useState<{ path: string; value: string }[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'selected' | 'model'>('selected');
  const [exportModelId, setExportModelId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const sanitized = parsed.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
      );
      if (sanitized.length) {
        setFavoritePropertyPaths(sanitized);
      }
    } catch (error) {
      console.warn('Failed to restore favourites from storage', error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoritePropertyPaths));
    } catch (error) {
      console.warn('Failed to persist favourites to storage', error);
    }
  }, [favoritePropertyPaths]);

  const selectionSearchTerm = selectionSearch.trim();
  const hasSelectionSearch = selectionSearchTerm.length > 0;

  const matchedPropertyRows = useMemo(() => {
    const term = selectionSearchTerm.toLowerCase();
    if (!term) return [] as PropertyRow[];
    return propertyRows.filter((row) => row.searchText.includes(term)).slice(0, MAX_SEARCH_RESULTS);
  }, [selectionSearchTerm, propertyRows]);

  const propertyRowMap = useMemo(() => {
    const map = new Map<string, PropertyRow>();
    propertyRows.forEach((row) => map.set(row.path, row));
    return map;
  }, [propertyRows]);

  const limitedPropertyRows = useMemo(
    () => propertyRows.slice(0, MAX_DISPLAY_PROPERTY_ROWS),
    [propertyRows]
  );

  const truncatedPropertyCount = Math.max(propertyRows.length - limitedPropertyRows.length, 0);

  const favoritePathSet = useMemo(() => new Set(favoritePropertyPaths), [favoritePropertyPaths]);

  const favoriteRows = useMemo(() => {
    if (!favoritePropertyPaths.length) return [] as PropertyRow[];
    return favoritePropertyPaths
      .map((path) => propertyRowMap.get(path))
      .filter((row): row is PropertyRow => Boolean(row));
  }, [favoritePropertyPaths, propertyRowMap]);

  const missingFavoriteCount = useMemo(() => {
    if (!favoritePropertyPaths.length) return 0;
    let missing = 0;
    for (const path of favoritePropertyPaths) {
      if (!propertyRowMap.has(path)) missing += 1;
    }
    return missing;
  }, [favoritePropertyPaths, propertyRowMap]);

  const toggleFavoriteProperty = useCallback((path: string) => {
    setFavoritePropertyPaths((prev) => {
      if (prev.includes(path)) {
        return prev.filter((entry) => entry !== path);
      }
      return [...prev, path];
    });
  }, []);

  const renderPropertyRow = useCallback(
    (row: PropertyRow) => {
      const isFavorite = favoritePathSet.has(row.path);
      return (
        <Box key={row.path} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {row.label}
            </Typography>
            <Tooltip title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => toggleFavoriteProperty(row.path)}
                  color={isFavorite ? 'primary' : 'default'}
                >
                  {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {row.value ? truncateDisplayValue(row.value, 360) : '—'}
          </Typography>
        </Box>
      );
    },
    [favoritePathSet, toggleFavoriteProperty]
  );

  useEffect(() => {
    if (!models.length) {
      setExportModelId('');
      return;
    }
    setExportModelId((prev) => (prev && models.some((model) => model.id === prev) ? prev : models[0].id));
  }, [models]);

  const gatherModelPropertyRows = useCallback(
    async (modelId: string): Promise<{ path: string; value: string }[]> => {
      const fragments = fragmentsRef.current;
      if (!fragments) return [];
      const record = fragments.list.get(modelId);
      if (!record) return [];

      let localIds: number[] = [];
      try {
        const fetched = await record.getLocalIds();
        if (Array.isArray(fetched)) localIds = fetched;
        else if (fetched && typeof (fetched as any)[Symbol.iterator] === 'function') {
          localIds = Array.from(fetched as Iterable<number>);
        }
      } catch (error) {
        console.warn(`Failed to retrieve local IDs for model ${modelId}`, error);
        return [];
      }

      if (!localIds.length) return [];

      const chunkSize = 32;
      const rows: { path: string; value: string }[] = [];
      for (let index = 0; index < localIds.length; index += chunkSize) {
        const chunk = localIds.slice(index, index + chunkSize);
        let batch: any[] = [];
        try {
          batch = await record.getItemsData(chunk);
        } catch (error) {
          console.warn(`Failed to fetch items data for model ${modelId} chunk starting at ${chunk[0]}`, error);
          continue;
        }
        batch.forEach((data, position) => {
          const localId = chunk[position];
          if (!data) return;
          try {
            const { rows: propertyRowsForItem } = buildPropertyData(data);
            propertyRowsForItem.forEach((propertyRow) => {
              rows.push({
                path: `localId:${localId} / ${propertyRow.label}`,
                value: propertyRow.value,
              });
            });
          } catch (error) {
            console.warn(`Failed to process properties for model ${modelId} localId ${localId}`, error);
          }
        });
      }

      return rows;
    },
    []
  );

  const buildCsvContent = useCallback((rows: { path: string; value: string }[]) => {
    const lines: string[] = [];
    lines.push('Path,Value');
    rows.forEach(({ path, value }) => {
      const safePath = path.replace(/"/g, '""');
      const safeValue = (value ?? '').replace(/"/g, '""');
      lines.push(`"${safePath}","${safeValue}"`);
    });
    return lines.join('\r\n');
  }, []);

  const handleOpenExportDialog = useCallback(() => {
    setExportError(null);
    setExportScope(propertyRows.length ? 'selected' : 'model');
    if (models.length && !models.some((model) => model.id === exportModelId)) {
      setExportModelId(models[0].id);
    }
    setExportDialogOpen(true);
  }, [propertyRows.length, models, exportModelId]);

  const handleCloseExportDialog = useCallback(() => {
    if (isExporting) return;
    setExportDialogOpen(false);
    setExportError(null);
  }, [isExporting]);

  const handleConfirmExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      let rows: { path: string; value: string }[] = [];
      if (exportScope === 'selected') {
        if (!propertyRows.length) {
          throw new Error('No properties available for the current selection.');
        }
        rows = propertyRows.map((row) => ({ path: row.label, value: row.value }));
      } else {
        if (!exportModelId) {
          throw new Error('Select a model to export.');
        }
        rows = await gatherModelPropertyRows(exportModelId);
        if (!rows.length) {
          throw new Error('No properties were found for the chosen model.');
        }
      }

      const csv = buildCsvContent(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const scopeLabel = exportScope === 'selected' ? 'selection' : `model-${exportModelId}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `fragment-properties-${scopeLabel}-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportDialogOpen(false);
    } catch (error) {
      console.warn('Failed to export properties', error);
      setExportError((error as Error).message ?? 'Failed to export properties.');
    } finally {
      setIsExporting(false);
    }
  }, [buildCsvContent, exportModelId, exportScope, gatherModelPropertyRows, isExporting, propertyRows]);

  const updateSelectedProperties = useCallback(
    (data: Record<string, any> | null) => {
      const normalized = data ?? null;
      setProperties(normalized);
      const { rows } = buildPropertyData(normalized);
      setPropertyRows(rows);
      setSelectedPropertyTab(favoritePropertyPaths.length ? 'favorites' : 'all');
      if (rows.length) {
        setLastItemsDataRows(rows.map((row) => ({ path: row.label, value: row.value })));
        const header = 'Path\tValue';
        const tsvRows = rows.map((row) => `${row.label}\t${row.value ?? ''}`);
        setLastItemsDataTSV([header, ...tsvRows].join('\r\n'));
      } else {
        setLastItemsDataRows([]);
        setLastItemsDataTSV(null);
      }
    },
    [favoritePropertyPaths.length]
  );

  const openChatWindow = useCallback(() => {
    setIsChatOpen((prev) => {
      if (!prev) {
        setChatExpandSignal((signal) => signal + 1);
      }
      return true;
    });
  }, []);

  const closeChatWindow = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  const toggleChatWindow = useCallback(() => {
    setIsChatOpen((prev) => {
      const next = !prev;
      if (next) {
        setChatExpandSignal((signal) => signal + 1);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    selectedRef.current = selectedItems;
  }, [selectedItems]);


  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;

    if (!uiInitializedRef.current) {
      BUI.Manager.init();
      BUIC.Manager.init();
      uiInitializedRef.current = true;
    }

    try { container.replaceChildren(); } catch { /* no-op */ }

    const components = new OBC.Components();
    componentsRef.current = components;

    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    world.name = 'main';
    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.camera.controls?.setLookAt(10, 10, 10, 0, 0, 0);
    world.camera.three.near = 0.1;
    world.camera.three.far = 1e9;
    world.camera.three.updateProjectionMatrix();

    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    world.scene.three.add(ambient);

    components.init();
    components.get(OBC.Grids).create(world);

    const highlighter = components.get(OBCF.Highlighter);
    highlighter.setup({ world });
    highlighter.zoomToSelection = true;
    highlighterRef.current = highlighter;

  const hider = components.get(OBC.Hider);
  hiderRef.current = hider;

    worldRef.current = world;

    const stats = new Stats();
    stats.showPanel(2);
    stats.dom.style.position = 'absolute';
    stats.dom.style.left = '8px';
    stats.dom.style.top = '8px';
    stats.dom.style.zIndex = '1000';
    container.appendChild(stats.dom);
    world.renderer.onBeforeUpdate.add(() => stats.begin());
    world.renderer.onAfterUpdate.add(() => stats.end());

    const init = async () => {
      const fetched = await fetch('https://thatopen.github.io/engine_fragment/resources/worker.mjs');
      const blob = await fetched.blob();
      const workerUrl = URL.createObjectURL(new File([blob], 'worker.mjs', { type: 'text/javascript' }));
      workerUrlRef.current = workerUrl;

      const fragments = components.get(OBC.FragmentsManager);
      fragments.init(workerUrl);
      fragmentsRef.current = fragments;

      world.camera.controls?.addEventListener('rest', () => fragments.core.update(true));

      const ifcImporter = new FRAGS.IfcImporter();
      const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
      ifcImporter.wasm = {
        path: `${baseUrl}web-ifc/`,
        absolute: true,
      };
      ifcImporterRef.current = ifcImporter;
    };
    init();

    setComponentsReady(true);

    const navCanvas = document.createElement('canvas');
    navCanvas.width = 110;
    navCanvas.height = 110;
    navCanvas.className = 'nav-cube';
    container.appendChild(navCanvas);
    navCubeRef.current = navCanvas;

    const nScene = new THREE.Scene();
    const nCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    nCamera.position.set(0, 0, 5);
    const nRenderer = new THREE.WebGLRenderer({ canvas: navCanvas, alpha: true, antialias: true });
    nRenderer.setPixelRatio(window.devicePixelRatio);
    nRenderer.setSize(110, 110);
    const cubeGeom = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const cube = new THREE.Mesh(cubeGeom, new THREE.MeshNormalMaterial({ flatShading: true }));
    nScene.add(cube);
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 10, 7);
    nScene.add(dl);
    navCubeState.current = { scene: nScene, camera: nCamera, renderer: nRenderer, cube };

    world.renderer.onAfterUpdate.add(() => {
      const st = navCubeState.current;
      if (!st) return;
      st.cube.quaternion.copy(world.camera.three.quaternion);
      st.renderer.render(st.scene, st.camera);
    });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onNavClick = async (ev: MouseEvent) => {
      const st = navCubeState.current;
      if (!st) return;
      const rect = navCanvas.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, st.camera);
      const hit = raycaster.intersectObject(st.cube, true)[0];
      if (!hit || !hit.face) return;
      const normal = hit.face.normal.clone().transformDirection(st.cube.matrixWorld);
      const target = new THREE.Vector3();
      const fragments = fragmentsRef.current;
      if (fragments && fragments.list.size) {
        const full = new THREE.Box3();
        for (const model of fragments.list.values()) full.expandByObject(model.object);
        full.getCenter(target);
        const sphere = new THREE.Sphere();
        full.getBoundingSphere(sphere);
        const dist = Math.max(3, sphere.radius * 3);
        const eye = target.clone().add(normal.multiplyScalar(dist));
        await world.camera.controls?.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true);
        return;
      }
      const eye = normal.clone().multiplyScalar(10);
      await world.camera.controls?.setLookAt(eye.x, eye.y, eye.z, 0, 0, 0, true);
    };
    navCanvas.addEventListener('click', onNavClick);

    const highlightHandler = async (modelIdMap: Record<string, Set<number>>) => {
      const selections: Selection[] = [];
      for (const [modelId, ids] of Object.entries(modelIdMap)) {
        ids.forEach((id) => {
          if (Number.isInteger(id)) {
            selections.push({ modelId, localId: id });
          }
        });
      }
      setSelectedItems(selections);
      handleExplorerOpen();

      const fragments = fragmentsRef.current;
      if (!fragments || !selections.length) {
        updateSelectedProperties(null);
        return;
      }

      const primary = selections[0];
      const model = fragments.list.get(primary.modelId);
      if (!model) {
        updateSelectedProperties(null);
        return;
      }
      try {
        const [data] = await model.getItemsData([primary.localId]);
        updateSelectedProperties(data || null);
      } catch (error) {
        console.warn('Failed to fetch properties for selection', error);
      }
    };

    const clearHandler = () => {
      setSelectedItems([]);
      updateSelectedProperties(null);
    };

    highlighter.events.select.onHighlight.add(highlightHandler);
    highlighter.events.select.onClear.add(clearHandler);

    return () => {
      (async () => {
        highlighter.events.select.onHighlight.remove?.(highlightHandler);
        highlighter.events.select.onClear.remove?.(clearHandler);

        try { await hiderRef.current?.set?.(true); } catch {}
        if (fragmentsRef.current) {
          const ids = [...fragmentsRef.current.list.keys()];
          await Promise.all(ids.map((id) => fragmentsRef.current!.core.disposeModel(id)));
        }
        try { highlighterRef.current?.clear?.(); } catch {}
        if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
        try { container.replaceChildren(); } catch { /* no-op */ }
      })();
    };
  }, []);

  useEffect(() => {
    if (!componentsReady) return;
    const components = componentsRef.current;
    const fragments = fragmentsRef.current;
    if (!components || !fragments) return;

    const ensureChild = <T extends HTMLElement>(container: HTMLDivElement | null, elementRef: React.MutableRefObject<T | null>, create: () => T) => {
      if (!container) return;
      let element = elementRef.current;
      if (!element) {
        element = create();
        elementRef.current = element;
      }
      if (!element) return;
      if (element.parentElement !== container) {
        container.replaceChildren(element);
      }
    };

    ensureChild(modelsListContainerRef.current, modelsListElementRef, () => {
      const [element, update] = BUIC.tables.modelsList({ components });
      updateModelsListRef.current = update;
      return element;
    });

    if (modelsListElementRef.current) {
      updateModelsListRef.current?.({ components });
      if (!modelsListElementRef.current.dataset.initialized) {
        modelsListElementRef.current.dataset.initialized = 'true';
        modelsListElementRef.current.style.width = '100%';
        modelsListElementRef.current.style.maxHeight = '200px';
      }
    }

    if (modelTreeContainerRef.current !== lastModelTreeContainerRef.current) {
      modelTreeElementRef.current = null;
      updateModelTreeRef.current = null;
      lastModelTreeContainerRef.current = modelTreeContainerRef.current;
    }

    ensureChild(modelTreeContainerRef.current, modelTreeElementRef, () => {
      const [element, update] = BUIC.tables.spatialTree({
        components,
        models: Array.from(fragments.list.values()),
      });
      updateModelTreeRef.current = update;
      element.style.width = '100%';
      element.style.height = '100%';
      element.style.overflow = 'auto';
      const tableElement = element as BUI.Table<any> & { queryString?: string | null };
      tableElement.queryString = modelTreeSearch.trim() ? modelTreeSearch.trim() : null;
      return element;
    });

    if (updateModelTreeRef.current) {
      updateModelTreeRef.current({
        components,
        models: Array.from(fragments.list.values()),
      });
    }
  }, [componentsReady, isExplorerOpen, modelTreeSearch, models]);

  useEffect(() => {
    if (!componentsReady) return;
    const components = componentsRef.current;
    const fragments = fragmentsRef.current;
    const updateTree = updateModelTreeRef.current;
    if (!components || !fragments || !updateTree) return;

    updateTree({
      components,
      models: Array.from(fragments.list.values()),
    });
  }, [componentsReady, models]);

  useEffect(() => {
    const table = modelTreeElementRef.current as (BUI.Table<any> & { queryString?: string | null }) | null;
    if (!table) return;
    const term = modelTreeSearch.trim();
    table.queryString = term ? term : null;
  }, [modelTreeSearch]);

  // File handler (safe input reset)
  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async () => {
    const inputEl = fileInputRef.current;        // capture element synchronously
    const file = inputEl?.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
  const fragments = fragmentsRef.current;
    const ifcImporter = ifcImporterRef.current;
    const world = worldRef.current;

    if (!fragments || !world) {
      alert('Viewer is still initializing. Please try again in a moment.');
      inputEl && (inputEl.value = '');
      return;
    }

    // Keep previously loaded models to allow multi-model exploration
    let usedIfcProgress = false;
    try {
  const modelId = `${file.name}-${Date.now()}`;
  let model: any;

      if (ext === 'ifc') {
        if (!ifcImporter) throw new Error('IFC importer is not ready.');
        setIfcProgress(0);
        usedIfcProgress = true;
        ifcCancelledRef.current = false;
        setIsCancelling(false);
        const ctrl = new AbortController();
        ifcAbortRef.current = ctrl;
        const ifcBytes = new Uint8Array(await file.arrayBuffer());
        const processed = await ifcImporter.process({
          bytes: ifcBytes,
          progressCallback: (p: number, msg: unknown) => {
            if (ifcCancelledRef.current) return;
            // Normalize progress: importer may report 0-1 or 0-100
            const raw = typeof p === 'number' ? p : 0;
            const percent = raw <= 1 ? raw * 100 : raw;
            const clamped = Math.max(0, Math.min(100, percent));
            setIfcProgress(Number(clamped.toFixed(1)));
            console.log(`IFC conversion progress: ${clamped.toFixed(1)}%`, msg);
          },
          // Pass abort signal if importer supports it; harmless if ignored
          signal: ctrl.signal,
        } as any);
        // If the user cancelled during processing, stop here
        if (ifcCancelledRef.current) {
          throw { __cancelled: true } as any;
        }
        // Normalize to a clean ArrayBuffer (no SharedArrayBuffer unions)
        let fragArrayBuffer: ArrayBuffer;
        if (processed instanceof ArrayBuffer) {
          // Copy into a new ArrayBuffer to satisfy strict typings
          const src = new Uint8Array(processed);
          const copy = new Uint8Array(src.byteLength);
          copy.set(src);
          fragArrayBuffer = copy.buffer;
        } else if (processed instanceof Uint8Array) {
          const copy = new Uint8Array(processed.byteLength);
          copy.set(processed);
          fragArrayBuffer = copy.buffer;
        } else {
          const buf = processed as ArrayBuffer;
          const src = new Uint8Array(buf);
          const copy = new Uint8Array(src.byteLength);
          copy.set(src);
          fragArrayBuffer = copy.buffer;
        }
        model = await fragments.core.load(fragArrayBuffer, { modelId });
      } else if (ext === 'frag') {
        const fragBytes = await file.arrayBuffer();
        model = await fragments.core.load(fragBytes, { modelId });
      } else {
        alert('Unsupported file type. Please choose a .ifc or .frag file.');
        return;
      }

    currentModelIdRef.current = modelId;
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);

      // Ensure fragments finish building GPU buffers before computing bounds
  await fragments.core.update(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      // --- Center & fit ---
      const box = new THREE.Box3().setFromObject(model.object);
      const center = new THREE.Vector3();
      box.getCenter(center);

      // If the model is very far from origin (georeferenced), recenter it
      if (Math.abs(center.x) > 1e6 || Math.abs(center.y) > 1e6 || Math.abs(center.z) > 1e6) {
        model.object.position.sub(center);
      }

      // Fit camera to the model bounds (smooth = true)
      try {
        if (world.camera.controls) {
          await world.camera.controls.fitToBox(model.object, true);
        }
      } catch {
        // Fallback: basic look-at if fitToBox isn't available
        const size = new THREE.Vector3(); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const dist = maxDim * 2.5;
        if (world.camera.controls) {
          world.camera.controls.setLookAt(center.x + dist, center.y + dist, center.z + dist, center.x, center.y, center.z, true);
        } else {
          world.camera.three.position.set(center.x + dist, center.y + dist, center.z + dist);
          world.camera.three.lookAt(center);
        }
      }

      setModelSummaries((prev) => ({
        ...prev,
        [modelId]: computeModelSummary(modelId, file.name, model.object),
      }));

      setModelLoaded(true);
      setModels((prev) => [...prev, { id: modelId, label: file.name }]);
      handleExplorerOpen();
      const components = componentsRef.current;
      if (components) {
        updateModelsListRef.current?.({ components });
      }
      // Ensure we end with 100% before closing
      if (usedIfcProgress) setIfcProgress(100);
    } catch (err: any) {
      if (err && (err.__cancelled || err?.name === 'AbortError')) {
        console.info('IFC conversion cancelled by user.');
      } else {
        console.error(err);
        alert('Failed to load model. See console for more details.');
      }
      setModelLoaded(false);
    } finally {
      // safe even after awaits
      if (inputEl) inputEl.value = '';
      // Hide IFC progress overlay if shown
      if (usedIfcProgress) setTimeout(() => setIfcProgress(null), 200);
      ifcAbortRef.current = null;
      setIsCancelling(false);
    }
  };

  const cancelIfcConversion = useCallback(() => {
    if (ifcProgress === null) return;
    ifcCancelledRef.current = true;
    setIsCancelling(true);
    try { ifcAbortRef.current?.abort(); } catch {}
    // Immediately hide overlay; if the importer ignores abort, we still avoid using the result
    setIfcProgress(null);
  }, [ifcProgress]);

  const handleExplorerOpen = useCallback(() => {
    setIsExplorerOpen(true);
    setIsExplorerMinimized(false);
  }, []);

  const toggleExplorerWindow = useCallback(() => {
    setIsExplorerOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsExplorerMinimized(false);
      }
      return next;
    });
  }, []);

  const handleExplorerClose = useCallback(() => {
    setIsExplorerOpen(false);
  }, []);

  const toggleExplorerMinimized = useCallback(() => {
    setIsExplorerMinimized((prev) => !prev);
  }, []);

  const handleAISelection = useCallback(async (command: SelectionCommand) => {
    const normalizeFilter = (source: Record<string, any> | undefined) => {
      type Term = { type: 'field'; key: string; value: string } | { type: 'text'; value: string };
      const terms: Term[] = [];
      const modelIds = new Set<string>();
      if (!source || typeof source !== 'object') {
        return { terms, modelIds };
      }
      for (const [rawKey, rawValue] of Object.entries(source)) {
        if (rawValue == null) continue;
        const keyLower = rawKey.trim().toLowerCase();
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        if (!values.length) continue;

        if (keyLower === 'modelid' || keyLower === 'modelids' || keyLower === 'model') {
          for (const entry of values) {
            const text = typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim();
            if (text) modelIds.add(text);
          }
          continue;
        }

        if (['text', 'query', 'keyword', 'search'].includes(keyLower)) {
          for (const entry of values) {
            if (entry == null) continue;
            const text = typeof entry === 'string' ? entry.trim().toLowerCase() : String(entry ?? '').trim().toLowerCase();
            if (text) terms.push({ type: 'text', value: text });
          }
          continue;
        }

        for (const entry of values) {
          if (entry == null) continue;
          let text: string | null = null;
          if (typeof entry === 'string') text = entry.trim();
          else if (typeof entry === 'number' || typeof entry === 'boolean') text = String(entry);
          if (!text) continue;
          terms.push({ type: 'field', key: keyLower, value: text.toLowerCase() });
        }
      }
      return { terms, modelIds };
    };

    const fragments = fragmentsRef.current;
    if (!fragments) {
      console.warn('AI selection requested but fragments are unavailable.');
      return;
    }

    const highlighter = highlighterRef.current;
    const hider = hiderRef.current;

    const { terms, modelIds } = normalizeFilter(command.filter);
    const normalizedMode = command.mode?.toLowerCase?.() as ('highlight' | 'isolate' | 'focus' | undefined);
    const isolate = normalizedMode === 'isolate' || normalizedMode === 'focus';

    if (command.action === 'clear') {
      try { highlighter?.clear?.(); } catch {}
      if (hider) {
        try { await hider.set(true); } catch (err) { console.warn('Failed to reset visibility while clearing AI selection', err); }
      }
      try {
        const prev = prevInstanceHighlightRef.current;
        if (prev && prev.mesh && prev.mesh.instanceColor) {
          const white = new THREE.Color(1, 1, 1);
          prev.mesh.setColorAt(prev.index, white);
          prev.mesh.instanceColor.needsUpdate = true;
        }
      } catch {}
      prevInstanceHighlightRef.current = null;
      if (selectionMarkerRef.current) selectionMarkerRef.current.visible = false;
      setSelectedItems([]);
      updateSelectedProperties(null);
      return;
    }

    if (terms.length === 0) {
      console.warn('AI selection command did not include usable filters', command);
      return;
    }

    const requestId = ++aiSelectionSeqRef.current;
    const entries: Array<{ model: any; modelId: string; allIds: number[]; matched: Set<number> }> = [];
    const chunkSize = 60;

    for (const model of fragments.list.values()) {
      const modelId: string = typeof model?.modelId === 'string' ? model.modelId : '';
      if (modelIds.size && !modelIds.has(modelId)) {
        continue;
      }

      let localIds: number[] = [];
      try {
        const retrieved = await model.getLocalIds();
        if (Array.isArray(retrieved)) localIds = retrieved.slice();
        else if (retrieved && typeof (retrieved as any)[Symbol.iterator] === 'function') {
          localIds = Array.from(retrieved as Iterable<number>);
        }
      } catch (err) {
        console.warn('Failed to fetch local IDs for model', modelId, err);
      }

      const entry = { model, modelId, allIds: localIds, matched: new Set<number>() };
      entries.push(entry);

      if (!localIds.length) continue;

      for (let offset = 0; offset < localIds.length; offset += chunkSize) {
        if (requestId !== aiSelectionSeqRef.current) return;
        const chunk = localIds.slice(offset, offset + chunkSize);
        let batch: any[] = [];
        try {
          batch = await model.getItemsData(chunk);
        } catch (err) {
          console.warn('Failed to retrieve property batch for AI selection', err);
          continue;
        }
        chunk.forEach((localId, idx) => {
          const itemData = batch?.[idx];
          if (!itemData) return;
          let rows: PropertyRow[] = [];
          try {
            rows = buildPropertyData(itemData).rows;
          } catch (err) {
            console.warn('Failed to build property rows for AI selection', err);
          }
          const rowSearches = rows.map((row) => row.searchText);
          const flattened = stringifyLimited(itemData, 6000).toLowerCase();
          const termMatched = terms.every((term) => {
            if (term.type === 'text') {
              return rowSearches.some((entryText) => entryText.includes(term.value)) || flattened.includes(term.value);
            }
            const aliases = FILTER_KEY_ALIASES[term.key] ?? [term.key];
            const rowsMatch = rowSearches.some((entryText) => aliases.some((alias) => entryText.includes(alias)) && entryText.includes(term.value));
            if (rowsMatch) return true;
            return aliases.some((alias) => flattened.includes(alias) && flattened.includes(term.value));
          });
          if (termMatched) {
            entry.matched.add(localId);
          }
        });
      }
    }

    if (requestId !== aiSelectionSeqRef.current) return;

    const matches = entries.filter((entry) => entry.matched.size > 0);
    if (!matches.length) {
      console.info('AI selection produced no matches for command', command);
      return;
    }

    try {
      const prev = prevInstanceHighlightRef.current;
      if (prev && prev.mesh && prev.mesh.instanceColor) {
        const white = new THREE.Color(1, 1, 1);
        prev.mesh.setColorAt(prev.index, white);
        prev.mesh.instanceColor.needsUpdate = true;
      }
    } catch {}
    prevInstanceHighlightRef.current = null;
    if (selectionMarkerRef.current) selectionMarkerRef.current.visible = false;

    if (hider) {
      try {
        await hider.set(true);
      } catch (err) {
        console.warn('Failed to reset hidden state before AI selection', err);
      }
    }

    if (highlighter) {
      try { highlighter.clear?.(); } catch {}
      const color = isolate ? 0xffa640 : 0x66ccff;
      for (const entry of matches) {
        const ids = Array.from(entry.matched);
        if (!ids.length) continue;
        try {
          if (typeof highlighter.highlightById === 'function') {
            await highlighter.highlightById(entry.model, ids, color);
          } else if (typeof highlighter.highlightByID === 'function') {
            await highlighter.highlightByID(entry.model, ids, color);
          } else if (typeof highlighter.add === 'function') {
            highlighter.add(entry.model, ids, color);
          }
        } catch (err) {
          console.warn('Failed to apply AI highlight for model', entry.modelId, err);
        }
      }
    }

    if (isolate && hider) {
      const hideMap: Record<string, Set<number>> = {};
      for (const entry of entries) {
        if (!entry.allIds.length) continue;
        if (entry.matched.size === entry.allIds.length) continue;
        const hiddenIds = entry.allIds.filter((id) => !entry.matched.has(id));
        if (hiddenIds.length) {
          hideMap[entry.modelId] = new Set(hiddenIds);
        }
      }
      if (Object.keys(hideMap).length) {
        try {
          await hider.set(false, hideMap);
        } catch (err) {
          console.warn('Failed to isolate AI-selected elements', err);
        }
      }
    }

    const selectionList = matches.flatMap((entry) => Array.from(entry.matched).map((localId) => ({ modelId: entry.modelId, localId })));
    setSelectedItems(selectionList);
    handleExplorerOpen();

    try {
      const primary = matches[0];
      const firstId = Array.from(primary.matched)[0];
      if (firstId !== undefined) {
        const [data] = await primary.model.getItemsData([firstId]);
        if (requestId === aiSelectionSeqRef.current) {
          updateSelectedProperties(data || null);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch properties for AI selection result', err);
    }
  }, [handleExplorerOpen, setSelectedItems, updateSelectedProperties]);

  const onExplorerResizePointerMove = useCallback((event: PointerEvent) => {
    if (!explorerResizingRef.current) return;
    const origin = explorerResizeOriginRef.current;
    if (!origin) return;
    const deltaX = event.clientX - origin.startX;
    const deltaY = event.clientY - origin.startY;
    const minWidth = 280;
    const minHeight = 260;
    setExplorerSize(prev => {
      const baseWidth = origin.width;
      const baseHeight = origin.height;
      const nextWidth = Math.max(minWidth, baseWidth + deltaX);
      const nextHeight = Math.max(minHeight, baseHeight + deltaY);
      if (nextWidth === prev.width && nextHeight === prev.height) return prev;
      return { width: Math.round(nextWidth), height: Math.round(nextHeight) };
    });
  }, []);

  const stopExplorerResize = useCallback(() => {
    if (!explorerResizingRef.current) return;
    explorerResizingRef.current = false;
    explorerResizeOriginRef.current = null;
    window.removeEventListener('pointermove', onExplorerResizePointerMove);
    window.removeEventListener('pointerup', stopExplorerResize);
  }, [onExplorerResizePointerMove]);

  const handleExplorerResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = explorerNodeRef.current;
    if (!node) return;
    explorerResizingRef.current = true;
    explorerResizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    window.addEventListener('pointermove', onExplorerResizePointerMove);
    window.addEventListener('pointerup', stopExplorerResize);
  }, [onExplorerResizePointerMove, stopExplorerResize]);

  useEffect(() => {
    return () => {
      stopExplorerResize();
    };
  }, [stopExplorerResize]);

  const getModelDataForAI = useCallback(async () => {
    const fr = fragmentsRef.current;
    const lines: string[] = [];

    if (!fr || fr.list.size === 0 || models.length === 0) {
      lines.push('No models are currently loaded in the viewer.');
    } else {
      lines.push(`Loaded models (${models.length}): ${models.map((m) => `${m.label} [${m.id}]`).join(', ')}`);
      lines.push(`Fragments models in memory: ${fr.list.size}`);
      try {
        const bounds = new THREE.Box3();
        for (const model of fr.list.values()) bounds.expandByObject(model.object);
        const size = new THREE.Vector3(); bounds.getSize(size);
        lines.push(`Scene bounds approx size => x:${size.x.toFixed(2)} y:${size.y.toFixed(2)} z:${size.z.toFixed(2)}`);
      } catch (err) {
        console.warn('Failed to compute bounds for AI context', err);
      }

      const collectedSummaries = models
        .map((info) => modelSummaries[info.id])
        .filter((summary): summary is ModelSummary => Boolean(summary));

      if (collectedSummaries.length) {
        let totalElements = 0;
        const globalCategories = new Map<string, number>();
        lines.push('Model geometry snapshots:');
        for (const summary of collectedSummaries) {
          totalElements += summary.elementCount;
          for (const { category, count } of summary.categoryCounts) {
            globalCategories.set(category, (globalCategories.get(category) ?? 0) + count);
          }
          const topCategories = summary.categoryCounts.slice(0, 5).map(({ category, count }) => `${category}: ${count}`);
          lines.push(
            `- ${summary.label} [${summary.modelId}] → elements≈${summary.elementCount}, instanced≈${summary.instancedCount}, meshes≈${summary.meshCount}`
          );
          if (topCategories.length) {
            lines.push(`  top categories: ${topCategories.join(' | ')}`);
          }
          lines.push(
            `  bbox size (approx): x:${summary.bboxSize.x.toFixed(2)} y:${summary.bboxSize.y.toFixed(2)} z:${summary.bboxSize.z.toFixed(2)}`
          );
        }
        const globalTop = Array.from(globalCategories.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([category, count]) => `${category}: ${count}`);
        lines.push(`Global approx element total: ${totalElements}`);
        if (globalTop.length) {
          lines.push(`Global top categories: ${globalTop.join(' | ')}`);
        }
      } else {
        lines.push('Geometry summaries are initializing — load a model or wait a moment after loading.');
      }
    }

    if (selectedItems.length) {
      lines.push(`Active selection count: ${selectedItems.length}`);
      for (let idx = 0; idx < selectedItems.length; idx += 1) {
        const selection = selectedItems[idx];
        lines.push(`Selection #${idx + 1} → modelId:${selection.modelId}, localId:${selection.localId}`);
        let snapshot: Record<string, any> | null = null;
        if (idx === 0 && properties && Object.keys(properties).length) {
          snapshot = properties;
        } else if (fr) {
          const model = fr.list.get(selection.modelId);
          if (model) {
            try {
              const [data] = await model.getItemsData([selection.localId]);
              snapshot = data || null;
            } catch (err) {
              console.warn('Failed to fetch properties for AI context (multi)', err);
            }
          }
        }
        if (snapshot) {
          lines.push('  Property snapshot (compact JSON):');
          lines.push(`  ${stringifyLimited(snapshot, 4000)}`);
          const rowsForSelection = buildPropertyData(snapshot).rows;
          if (rowsForSelection.length) {
            lines.push(`  Flattened properties (${rowsForSelection.length} entries):`);
            for (const row of rowsForSelection.slice(0, 120)) {
              lines.push(`  - ${row.label}: ${row.value}`);
            }
            if (rowsForSelection.length > 120) {
              lines.push(`  (Truncated ${rowsForSelection.length - 120} additional properties)`);
            }
          }
        } else {
          lines.push('  Properties for this selection are not available yet.');
        }
      }
    } else {
      lines.push('No active selection — exporting properties for every loaded element.');
      if (fr && fr.list.size) {
        for (const info of models) {
          const record = fr.list.get(info.id);
          if (!record) {
            lines.push(`Model ${info.label} [${info.id}] could not be found in the fragments registry.`);
            continue;
          }
          try {
            const retrievedIds = await record.getLocalIds();
            const localIds = Array.isArray(retrievedIds)
              ? retrievedIds
              : retrievedIds
                ? Array.from(retrievedIds as Iterable<number>)
                : [];
            if (!localIds || localIds.length === 0) {
              lines.push(`Model ${info.label} [${info.id}] has no retrievable local IDs.`);
              continue;
            }
            lines.push(`Model ${info.label} [${info.id}] — enumerating ${localIds.length} items:`);
            const detailLimit = localIds.length <= 40 ? 12 : localIds.length <= 120 ? 6 : 3;
            const chunkSize = 50;
            for (let offset = 0; offset < localIds.length; offset += chunkSize) {
              const chunk = localIds.slice(offset, offset + chunkSize);
              let batch: any[] = [];
              try {
                batch = await record.getItemsData(chunk);
              } catch (err) {
                const start = chunk[0];
                const end = chunk[chunk.length - 1];
                lines.push(`  Failed to retrieve properties for items ${start}–${end}: ${(err as any)?.message ?? err}`);
                continue;
              }
              chunk.forEach((localId, position) => {
                const data = batch?.[position];
                if (!data) {
                  lines.push(`- localId:${localId} (no data available)`);
                  return;
                }
                const summary = summariseItemDataForAI(data, detailLimit).replace(/\s+/g, ' ').trim();
                lines.push(`- localId:${localId} | ${summary}`);
              });
            }
          } catch (err) {
            lines.push(`Failed to enumerate items for model ${info.label} [${info.id}]: ${(err as any)?.message ?? err}`);
          }
        }
      } else {
        lines.push('Fragments data is not available to enumerate model items.');
      }
    }

    if (lastItemsDataRows.length) {
      lines.push('ItemsData extracted name/value pairs (last selection):');
      const cap = 150;
      const limitedRows = lastItemsDataRows.slice(0, cap);
      for (const row of limitedRows) {
        lines.push(`- ${row.path}: ${row.value}`);
      }
      if (lastItemsDataRows.length > cap) {
        lines.push(`(Truncated ${lastItemsDataRows.length - cap} additional rows)`);
      }
    }

    if (lastItemsDataTSV) {
      lines.push('ItemsData table snapshot for last selection (tab-separated):');
      lines.push(lastItemsDataTSV);
    }

    if (lines.length === 0) {
      lines.push('Viewer is idle: no models or selections to describe.');
    }

    return lines.join('\n');
  }, [models, selectedItems, properties, propertyRows, modelSummaries, lastItemsDataTSV, lastItemsDataRows]);

  const fitToCurrentModel = useCallback(async () => {
    const world = worldRef.current;
    const fragments = fragmentsRef.current;
    const id = currentModelIdRef.current;
    if (!world || !fragments || !id) return;
  const record = fragments.list.get(id);
    if (!record) return;

    // Ensure updates
  await fragments.core.update(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const obj = record.object;
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) {
      try {
        if (world.camera.controls) {
          await world.camera.controls.fitToBox(obj, true);
        }
      } catch (e) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const dist = maxDim * 2.5;
        if (world.camera.controls) {
          world.camera.controls.setLookAt(center.x + dist, center.y + dist, center.z + dist, center.x, center.y, center.z, true);
        } else {
          world.camera.three.position.set(center.x + dist, center.y + dist, center.z + dist);
          world.camera.three.lookAt(center);
        }
      }
    }
  }, []);

  const hideSelected = useCallback(async () => {
    const selection = selectedRef.current;
    const hider = hiderRef.current;
    if (!selection || selection.length === 0 || !hider) {
      setContextMenu(null);
      return;
    }
    const modelIdMap: Record<string, Set<number>> = {};
    for (const entry of selection) {
      if (!modelIdMap[entry.modelId]) {
        modelIdMap[entry.modelId] = new Set<number>();
      }
      modelIdMap[entry.modelId].add(entry.localId);
    }
    try {
      await hider.set(false, modelIdMap);
      try { highlighterRef.current?.clear?.(); } catch {}
      setSelectedItems([]);
      updateSelectedProperties(null);
    } catch (error) {
      console.warn('Failed to hide selected element', error);
    } finally {
      setContextMenu(null);
    }
  }, [setContextMenu, setSelectedItems, updateSelectedProperties]);

  const resetHidden = useCallback(async () => {
    const hider = hiderRef.current;
    if (!hider) {
      setContextMenu(null);
      return;
    }
    try {
      await hider.set(true);
    } catch (error) {
      console.warn('Failed to reset hidden items', error);
    } finally {
      setContextMenu(null);
    }
  }, [setContextMenu]);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, [setContextMenu]);

  // Simple picking to show properties + add a 3D selection marker
  useEffect(() => {
    const container = viewerRef.current; const world = worldRef.current;
    if (!container || !world) return;
    const dom = world.renderer?.three.domElement as HTMLCanvasElement | undefined;
    if (!dom) return;
    const mouse = new THREE.Vector2();
    const pickAt = async (clientX: number, clientY: number) => {
      const fr = fragmentsRef.current; if (!fr) return;
      const rect = dom.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      let best: { dist: number; model: any; localId: number; point?: THREE.Vector3; object?: any; instanceId?: number } | null = null;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, world.camera.three);
  for (const model of fr.list.values()) {
        const hit = await model.raycast({ camera: world.camera.three, mouse, dom: world.renderer!.three.domElement! });
        if (hit && typeof hit.distance === 'number') {
          const pt = (hit as any).point instanceof THREE.Vector3
            ? (hit as any).point.clone()
            : raycaster.ray.at(hit.distance, new THREE.Vector3());
          if (!best || hit.distance < best.dist) best = {
            dist: hit.distance,
            model,
            localId: (hit as any).localId,
            point: pt,
            object: (hit as any).object,
            instanceId: (hit as any).instanceId,
          } as any;
        }
      }
      if (!best) return;
      // Prefer native Highlighter if present; otherwise color the picked instance
      let usedNativeHighlight = false;
      try {
        const hl = highlighterRef.current;
        if (hl) {
          try { hl.clear?.(); } catch {}
          // Try common method names across versions
          const colorHex = 0x66ccff;
          if (typeof hl.highlightById === 'function') {
            await hl.highlightById(best.model, [best.localId], colorHex);
            usedNativeHighlight = true;
          } else if (typeof hl.highlightByID === 'function') {
            await hl.highlightByID(best.model, [best.localId], colorHex);
            usedNativeHighlight = true;
          } else if (typeof hl.add === 'function') {
            hl.add(best.model, [best.localId], colorHex);
            usedNativeHighlight = true;
          } else if (typeof hl.select === 'function' && best.object) {
            hl.select(best.object, best.instanceId);
            usedNativeHighlight = true;
          }
        }
      } catch { /* ignore and fallback */ }

      if (!usedNativeHighlight) {
        // Try to color the selected instance (light blue) if the hit is an InstancedMesh
        try {
          const obj: any = best.object;
          const idx: any = best.instanceId;
          if (obj && obj.isInstancedMesh && Number.isInteger(idx)) {
            // reset previous highlight
            const prev = prevInstanceHighlightRef.current;
            if (prev && prev.mesh && prev.mesh.instanceColor) {
              const white = new THREE.Color(1, 1, 1);
              try { prev.mesh.setColorAt(prev.index, white); prev.mesh.instanceColor.needsUpdate = true; } catch {}
            }
            const inst = obj as THREE.InstancedMesh;
            const color = new THREE.Color(0x66ccff);
            try { inst.setColorAt(idx as number, color); inst.instanceColor!.needsUpdate = true; } catch {}
            prevInstanceHighlightRef.current = { mesh: inst, index: idx as number };
          }
        } catch { /* non-fatal */ }
      }
      // Place/update selection marker
      try {
        const pt = best.point ?? new THREE.Vector3();
        let marker = selectionMarkerRef.current;
        if (!marker) {
          marker = new THREE.Group();
          // Determine a reasonable marker scale from current models
          const full = new THREE.Box3();
          const fr2 = fragmentsRef.current;
          if (fr2 && fr2.list.size) {
            for (const m of fr2.list.values()) full.expandByObject(m.object);
          }
          const sph = new THREE.Sphere(); full.getBoundingSphere(sph);
          const base = isFinite(sph.radius) && sph.radius > 0 ? sph.radius * 0.01 : 0.3;
          const size = Math.max(0.05, Math.min(2, base));

          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(size * 0.5, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false })
          );
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(size * 0.8, size, 32),
            new THREE.MeshBasicMaterial({ color: 0xffee88, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 })
          );
          ring.rotation.x = Math.PI / 2; // default orientation
          sphere.renderOrder = 999;
          ring.renderOrder = 999;
          marker.add(sphere);
          marker.add(ring);
          world.scene.three.add(marker);
          selectionMarkerRef.current = marker;
        }
        marker.position.copy(pt);
        // Make ring face the camera
        const ringMesh = marker.children[1] as THREE.Mesh;
        ringMesh.lookAt(world.camera.three.position);
        marker.visible = true;
      } catch { /* non-fatal */ }

  setSelectedItems([{ modelId: best.model.modelId, localId: best.localId }]);
      handleExplorerOpen();
      try {
  const [data] = await best.model.getItemsData([best.localId]);
        updateSelectedProperties(data || null);
      } catch {}
    };
    const onPointerDown = async (ev: PointerEvent) => {
      setContextMenu(null);
      if (ev.button !== 0) return; // left button only
      await pickAt(ev.clientX, ev.clientY);
    };
    const onClick = async (ev: MouseEvent) => {
      setContextMenu(null);
      await pickAt(ev.clientX, ev.clientY);
    };
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      const currentSelection = selectedRef.current;
      if (!currentSelection || currentSelection.length === 0) {
        setContextMenu(null);
        return;
      }
      setContextMenu({ mouseX: ev.clientX + 2, mouseY: ev.clientY - 6 });
    };
    // Use capture on pointerdown to avoid controls stopping propagation
    dom.addEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions);
    dom.addEventListener('click', onClick);
    dom.addEventListener('contextmenu', onContextMenu);
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions);
      dom.removeEventListener('click', onClick);
      dom.removeEventListener('contextmenu', onContextMenu);
      // Cleanup marker
      try {
        const marker = selectionMarkerRef.current;
        if (marker) {
          world.scene.three.remove(marker);
          marker.traverse(obj => {
            if ((obj as any).geometry) (obj as any).geometry.dispose?.();
            if ((obj as any).material) {
              const mats = Array.isArray((obj as any).material) ? (obj as any).material : [(obj as any).material];
              for (const m of mats) m?.dispose?.();
            }
          });
          selectionMarkerRef.current = null;
        }
      } catch { /* no-op */ }
      // Reset any instance highlight
      try {
        const prev = prevInstanceHighlightRef.current;
        if (prev && prev.mesh && prev.mesh.instanceColor) {
          const white = new THREE.Color(1, 1, 1);
          prev.mesh.setColorAt(prev.index, white);
          prev.mesh.instanceColor.needsUpdate = true;
        }
        prevInstanceHighlightRef.current = null;
      } catch { /* no-op */ }
    };
  }, []);

  const resetView = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    if (world.camera.controls) {
      world.camera.controls.reset(true);
    } else {
      world.camera.three.position.set(10, 10, 10);
      world.camera.three.lookAt(0, 0, 0);
    }
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flex: 1 }}>BIM Viewer</Typography>
          <Button
            color="inherit"
            onClick={toggleExplorerWindow}
            startIcon={<ViewListIcon />}
            aria-pressed={isExplorerOpen}
            sx={{
              mr: 1,
              borderRadius: 1.5,
              backgroundColor: isExplorerOpen ? 'rgba(255,255,255,0.18)' : 'transparent',
              transition: 'background-color 0.2s ease',
              '&:hover': {
                backgroundColor: isExplorerOpen ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)'
              }
            }}
            title={isExplorerOpen ? 'Close Model Explorer' : 'Open Model Explorer'}
          >
            Model Explorer
          </Button>
          <Button
            color="inherit"
            onClick={toggleChatWindow}
            startIcon={<ChatIcon />}
            aria-pressed={isChatOpen}
            sx={{
              mr: 1,
              borderRadius: 1.5,
              backgroundColor: isChatOpen ? 'rgba(255,255,255,0.18)' : 'transparent',
              transition: 'background-color 0.2s ease',
              '&:hover': {
                backgroundColor: isChatOpen ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)'
              }
            }}
            title={isChatOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          >
            AI Assistant
          </Button>
          <Button color="inherit" onClick={fitToCurrentModel} disabled={!modelLoaded} sx={{ mr: 1 }}>
            Fit to Model
          </Button>
          <Button color="inherit" onClick={resetView} sx={{ mr: 1 }}>
            Reset View
          </Button>
        </Toolbar>
      </AppBar>

      <div
        ref={viewerRef}
        style={{ width: '100%', height: 'calc(100% - 64px)', background: '#151515', position: 'relative' }}
      >
        {ifcProgress !== null && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 2000,
              pointerEvents: 'none'
            }}
          >
            <Paper elevation={6} sx={{ p: 3, minWidth: 340, textAlign: 'center', pointerEvents: 'auto' }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>Converting IFC…</Typography>
              <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, ifcProgress))} sx={{ height: 10, borderRadius: 1 }} />
              <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                {ifcProgress.toFixed(1)}%
              </Typography>
              <div style={{ marginTop: 12 }}>
                <Button size="small" variant="outlined" color="inherit" onClick={cancelIfcConversion} disabled={isCancelling}>
                  {isCancelling ? 'Cancelling…' : 'Cancel'}
                </Button>
              </div>
            </Paper>
          </div>
        )}
      </div>

      {isExplorerOpen ? (
        <Draggable nodeRef={explorerNodeRef} handle=".explorer-header" bounds="parent">
          <Paper
            ref={explorerNodeRef}
            elevation={8}
            sx={{
              position: 'fixed',
              top: 120,
              right: 30,
              width: explorerSize.width,
              height: isExplorerMinimized ? 'auto' : explorerSize.height,
              minWidth: 280,
              minHeight: isExplorerMinimized ? 56 : 260,
              maxWidth: '85vw',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 1800,
              boxSizing: 'border-box',
              overflow: 'hidden'
            }}
          >
            <Box
              className="explorer-header"
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1,
                backgroundColor: 'primary.main',
                color: 'white',
                cursor: 'move'
              }}
            >
              <Typography variant="subtitle1">Model Explorer</Typography>
              <Box>
                <IconButton size="small" color="inherit" onClick={toggleExplorerMinimized}>
                  {isExplorerMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
                </IconButton>
                <IconButton size="small" color="inherit" onClick={handleExplorerClose}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </Box>

            {!isExplorerMinimized && (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, px: 2, py: 1, minHeight: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button variant="contained" size="small" onClick={() => fileInputRef.current?.click()} disabled={!componentsReady}>
                    Open IFC / FRAG
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                                 </Typography>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".ifc,.IFC,.frag,.FRAG"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="subtitle2">Loaded Models</Typography>
                    <IconButton size="small" onClick={() => setIsModelsSectionCollapsed((prev) => !prev)}>
                      {isModelsSectionCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                    </IconButton>
                  </Box>
                  <Collapse in={!isModelsSectionCollapsed} timeout="auto">
                    <Box
                      ref={modelsListContainerRef}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, overflow: 'hidden' }}
                    >
                      {!componentsReady && (
                        <Typography variant="body2" color="text.secondary">Initializing components…</Typography>
                      )}
                    </Box>
                  </Collapse>
                </Box>
                
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.25,
                    overflow: 'hidden',
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'rgba(229, 57, 53, 0.45)',
                    bgcolor: 'rgba(229, 57, 53, 0.08)',
                    p: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="subtitle2">Selection Properties</Typography>
                    <IconButton size="small" onClick={() => setIsSelectionPropertiesCollapsed((prev) => !prev)}>
                      {isSelectionPropertiesCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                    </IconButton>
                  </Box>
                  <Collapse in={!isSelectionPropertiesCollapsed} timeout="auto">
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0 }}>
                      <Tabs
                        value={selectedPropertyTab}
                        onChange={(_, value) => setSelectedPropertyTab(value as PropertyTabId)}
                        variant="scrollable"
                        allowScrollButtonsMobile
                        sx={{
                          minHeight: 'auto',
                          '.MuiTabs-flexContainer': {
                            gap: 0.5,
                          },
                          '.MuiTab-root': {
                            minHeight: 'auto',
                            py: 0.75,
                          },
                        }}
                      >
                        <Tab value="favorites" label={`Favourites (${favoriteRows.length})`} />
                        <Tab value="all" label={`All (${propertyRows.length})`} />
                      </Tabs>

                      <Box
                        role="tabpanel"
                        hidden={selectedPropertyTab !== 'favorites'}
                        sx={{
                          display: selectedPropertyTab === 'favorites' ? 'flex' : 'none',
                          flexDirection: 'column',
                          gap: 1,
                        }}
                      >
                        {favoriteRows.length ? (
                          <Paper
                            variant="outlined"
                            sx={{
                              p: 1,
                              maxHeight: 220,
                              overflowY: 'auto',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 0.75,
                            }}
                          >
                            {favoriteRows.map(renderPropertyRow)}
                          </Paper>
                        ) : (
                          <Paper variant="outlined" sx={{ p: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                              {favoritePropertyPaths.length
                                ? 'The current selection does not expose any of your favourite properties yet. Try selecting another item.'
                                : 'Mark properties as favourites from the All tab to pin them here.'}
                            </Typography>
                          </Paper>
                        )}
                        {missingFavoriteCount > 0 && favoritePropertyPaths.length > 0 && (
                          <Alert severity="info" variant="outlined">
                            {missingFavoriteCount === 1
                              ? '1 favourite property is not available for this selection.'
                              : `${missingFavoriteCount} favourite properties are not available for this selection.`}
                          </Alert>
                        )}
                      </Box>

                      <Box
                        role="tabpanel"
                        hidden={selectedPropertyTab !== 'all'}
                        sx={{
                          display: selectedPropertyTab === 'all' ? 'flex' : 'none',
                          flexDirection: 'column',
                          gap: 1,
                          minHeight: 0,
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={selectionSearch}
                            onChange={(event) => setSelectionSearch(event.target.value)}
                            placeholder="Search properties…"
                            disabled={!propertyRows.length}
                          />
                          <Tooltip title="Export properties">
                            <span>
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<FileDownloadIcon />}
                                onClick={handleOpenExportDialog}
                                disabled={!propertyRows.length && !models.length}
                              >
                                Export
                              </Button>
                            </span>
                          </Tooltip>
                        </Box>

                        {!propertyRows.length ? (
                          <Paper variant="outlined" sx={{ p: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                              Select an element in the viewer to view its Property Sets / NV_BIM / … breakdown.
                            </Typography>
                          </Paper>
                        ) : hasSelectionSearch ? (
                          matchedPropertyRows.length ? (
                            <Paper
                              variant="outlined"
                              sx={{
                                maxHeight: 200,
                                overflowY: 'auto',
                                p: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 0.75,
                              }}
                            >
                              {matchedPropertyRows.map(renderPropertyRow)}
                            </Paper>
                          ) : (
                            <Paper variant="outlined" sx={{ p: 1 }}>
                              <Typography variant="body2" color="text.secondary">
                                {`No properties matched "${selectionSearchTerm}".`}
                              </Typography>
                            </Paper>
                          )
                        ) : (
                          <React.Fragment>
                            <Paper
                              variant="outlined"
                              sx={{
                                maxHeight: 240,
                                overflowY: 'auto',
                                p: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 0.75,
                              }}
                            >
                              {limitedPropertyRows.map(renderPropertyRow)}
                            </Paper>
                            {truncatedPropertyCount > 0 && (
                              <Alert severity="info" variant="outlined">
                                {`Displaying the first ${limitedPropertyRows.length} properties. ${truncatedPropertyCount} more not shown.`}
                              </Alert>
                            )}
                          </React.Fragment>
                        )}
                      </Box>
                    </Box>
                  </Collapse>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.25,
                    overflow: 'hidden',
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'rgba(255, 179, 0, 0.5)',
                    bgcolor: 'rgba(255, 213, 79, 0.12)',
                    p: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="subtitle2">Model Tree</Typography>
                    <IconButton size="small" onClick={() => setIsModelTreeCollapsed((prev) => !prev)}>
                      {isModelTreeCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                    </IconButton>
                  </Box>
                  <Collapse in={!isModelTreeCollapsed} timeout="auto">
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0 }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={modelTreeSearch}
                        onChange={(event) => setModelTreeSearch(event.target.value)}
                        placeholder="Search the model tree…"
                        disabled={!models.length}
                      />
                      <Box
                        sx={{
                          position: 'relative',
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          minHeight: 240,
                          maxHeight: 360,
                          overflow: 'hidden',
                          bgcolor: 'background.paper',
                        }}
                      >
                        <Box
                          ref={modelTreeContainerRef}
                          sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
                        />
                        {(!componentsReady || !models.length) && (
                          <Box
                            sx={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              textAlign: 'center',
                              px: 2,
                            }}
                          >
                            <Typography variant="body2" color="text.secondary">
                              {componentsReady
                                ? 'Load a model to populate the full model tree.'
                                : 'Viewer is initializing the model tree…'}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </Collapse>
                </Box>
              </Box>
            )}
            <Box
              onPointerDown={handleExplorerResizeStart}
              sx={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                width: 16,
                height: 16,
                cursor: 'nwse-resize',
                borderRight: '2px solid',
                borderBottom: '2px solid',
                borderColor: 'divider',
                opacity: 0.6,
                '&:hover': { opacity: 1 }
              }}
            />
          </Paper>
        </Draggable>
      ) : (
        <Paper elevation={6} sx={{ position: 'fixed', bottom: 20, right: 90, zIndex: 1700, borderRadius: '50%' }}>
          <IconButton onClick={handleExplorerOpen}>
            <ViewListIcon />
          </IconButton>
        </Paper>
      )}

      <Dialog open={exportDialogOpen} onClose={handleCloseExportDialog} fullWidth maxWidth="sm">
        <DialogTitle>Export properties</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl component="fieldset" variant="standard">
            <FormLabel component="legend">Scope</FormLabel>
            <RadioGroup
              value={exportScope}
              onChange={(event) => setExportScope(event.target.value as 'selected' | 'model')}
            >
              <FormControlLabel
                value="selected"
                control={<Radio />}
                label="Selected items"
                disabled={!propertyRows.length}
              />
              <FormControlLabel
                value="model"
                control={<Radio />}
                label="Specific model"
                disabled={!models.length}
              />
            </RadioGroup>
          </FormControl>

          <Collapse in={exportScope === 'model'} unmountOnExit>
            <TextField
              select
              fullWidth
              label="Model"
              value={exportModelId}
              onChange={(event) => setExportModelId(event.target.value)}
              disabled={!models.length}
            >
              {models.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  {model.label}
                </MenuItem>
              ))}
            </TextField>
          </Collapse>

          {exportScope === 'selected' && !propertyRows.length && (
            <Alert severity="warning" variant="outlined">
              Select at least one item before exporting the current selection.
            </Alert>
          )}

          {exportError && (
            <Alert severity="error" variant="outlined">
              {exportError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseExportDialog} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmExport}
            disabled={
              isExporting ||
              (exportScope === 'selected' && !propertyRows.length) ||
              (exportScope === 'model' && !exportModelId)
            }
          >
            {isExporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </DialogActions>
      </Dialog>

      <ChatWindow
        getModelDataForAI={getModelDataForAI}
        isOpen={isChatOpen}
        onOpen={openChatWindow}
        onClose={closeChatWindow}
        expandSignal={chatExpandSignal}
        onRequestSelection={handleAISelection}
      />

      <Menu
        open={Boolean(contextMenu)}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        disableAutoFocus
        disableAutoFocusItem
        disableEnforceFocus
        MenuListProps={{ autoFocusItem: false }}
      >
  <MenuItem onClick={hideSelected} disabled={selectedItems.length === 0}>
          Hide selected element
        </MenuItem>
        <MenuItem onClick={resetHidden}>
          Reset hidden elements
        </MenuItem>
      </Menu>
    </div>
  );
};

function stringifyLimited(value: any, maxLength = 2000): string {
  try {
    if (value == null) return 'null';
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n... [truncated ${text.length - maxLength} chars]`;
  } catch {
    return String(value);
  }
}

export default App;
