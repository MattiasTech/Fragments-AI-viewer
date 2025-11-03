import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';
import type * as FRAGS from '@thatopen/fragments';
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
import Link from '@mui/material/Link';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Alert from '@mui/material/Alert';
import Slider from '@mui/material/Slider';
import Draggable from 'react-draggable';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import FilterListIcon from '@mui/icons-material/FilterList';
import ViewListIcon from '@mui/icons-material/ViewList';
import ChatIcon from '@mui/icons-material/Chat';
import RuleIcon from '@mui/icons-material/Rule';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import StraightenIcon from '@mui/icons-material/Straighten';
import CropIcon from '@mui/icons-material/Crop';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import * as THREE from 'three';
import Stats from 'stats.js';
import type { SelectionCommand } from './ChatWindow';
import { saveApiConfig, loadApiConfig, clearApiConfig, getAvailableModels, getDefaultModel, type AIProvider, type ApiConfig } from './utils/apiKeys';
import { testGeminiConnection } from './ai/gemini';
import { testOpenAIConnection } from './ai/openai';
const ChatWindow = React.lazy(() => import('./ChatWindow'));
const IdsPanel = React.lazy(() => import('./ids/IdsPanel'));
const IdsCreatorPanel = React.lazy(() => import('./ids/IdsCreatorPanel'));
const ModelFilterPanel = React.lazy(() => import('./explorer/ModelFilterPanel'));
import { idsStore } from './ids/ids.store';
import type { ElementData, ViewerApi } from './ids/ids.types';

type Selection = { modelId: string; localId: number };

type PropertyRow = {
  label: string;
  value: string;
  path: string;
  searchText: string;
  rawPsetName?: string;
  rawPropertyName?: string;
  rawValue?: any;
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

const selectionsMatch = (a: Selection[], b: Selection[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const next = a[index];
    const prev = b[index];
    if (!prev || next.modelId !== prev.modelId || next.localId !== prev.localId) {
      return false;
    }
  }
  return true;
};

type IdsElementRecord = {
  element: ElementData;
  modelId: string;
  localId: number;
  psets: Record<string, Record<string, unknown>>;
  attributes: Record<string, unknown>;
  raw: Record<string, unknown>;
};

type IdsCache = {
  signature: string;
  records: Map<string, IdsElementRecord>;
  elements: ElementData[];
  modelLocalIds: Map<string, number[]>;
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
        } else if (value && typeof value === 'object') {
          const extracted = extractNominalValue(value);
          if (extracted) return extracted;
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

const PROPERTY_SET_CONTAINER_KEYS = ['psets', 'Psets', 'propertySets', 'PropertySets', 'property_sets', 'Property_Sets'] as const;

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
      rawPsetName: rawName,
      rawPropertyName: rawPropertyName,
      rawValue: (property as any).__rawValue ?? property,
    });
  });

  return rows;
};

const collectIfcPropertySetRows = (root: any): PropertyRow[] => {
  if (!root || typeof root !== 'object') return [];

  const rows: PropertyRow[] = [];
  const visited = new WeakSet<object>();
  const psetCounters = new Map<string, number>();

  type PropertySetMeta = { rawName: string; friendlyName: string; uniqueKey: string };

  const makePropertySetMeta = (rawNameCandidate: any): PropertySetMeta => {
    let rawName: string | undefined;
    if (typeof rawNameCandidate === 'string') {
      const trimmed = rawNameCandidate.trim();
      if (trimmed.length) rawName = trimmed;
    }
    if (!rawName && rawNameCandidate && typeof rawNameCandidate === 'object') {
      rawName =
        readName(rawNameCandidate) ??
        (typeof (rawNameCandidate as any).Name === 'string' ? (rawNameCandidate as any).Name : undefined) ??
        (typeof (rawNameCandidate as any).id === 'string' ? (rawNameCandidate as any).id : undefined);
    }
    if (!rawName || !rawName.length) rawName = 'Property Set';
    const friendlyName = prettifyLabel(rawName) || rawName;
    const base = sanitizeKey(rawName) || 'property-set';
    const occurrence = (psetCounters.get(base) ?? 0) + 1;
    psetCounters.set(base, occurrence);
    return { rawName, friendlyName, uniqueKey: `${base}-${occurrence}` };
  };

  const ensureSingleValue = (propertyName: string, rawValue: any, index: number) => {
    const fallback = `Property ${index + 1}`;
    const effectiveName = propertyName?.trim?.() ? propertyName.trim() : fallback;
    if (isIfcPropertySingleValue(rawValue)) {
      const copy = { ...(rawValue as Record<string, any>) };
      if (copy.Name == null && copy.PropertyName == null) {
        copy.Name = effectiveName;
      }
      if (copy.PropertyName == null) {
        copy.PropertyName = copy.Name ?? effectiveName;
      }
      if (copy.__rawValue == null) {
        copy.__rawValue = rawValue;
      }
      return copy;
    }
    if (rawValue && typeof rawValue === 'object') {
      const clone = { ...(rawValue as Record<string, any>) };
      if (clone.Name == null && clone.PropertyName == null) {
        clone.Name = effectiveName;
      }
      if (clone.PropertyName == null) {
        clone.PropertyName = clone.Name ?? effectiveName;
      }
      if (clone.type == null && clone.Type == null) {
        clone.type = 'IFCPROPERTYSINGLEVALUE';
      }
      if (!('NominalValue' in clone) && !('nominalValue' in clone) && !('Value' in clone) && !('value' in clone)) {
        clone.NominalValue = rawValue;
      }
      clone.__rawValue = rawValue;
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

  const buildSyntheticPropertySet = (rawName: string, source: any) => {
    const properties: any[] = [];
    const pushProperty = (candidateName: any, value: any) => {
      const fallback = `Property ${properties.length + 1}`;
      const rawPropertyName =
        (typeof candidateName === 'string' && candidateName.trim().length ? candidateName.trim() : undefined) ??
        readName(candidateName) ??
        (typeof candidateName?.Name === 'string' ? candidateName.Name : undefined) ??
        (typeof candidateName?.PropertyName === 'string' ? candidateName.PropertyName : undefined) ??
        fallback;
      properties.push(ensureSingleValue(rawPropertyName, value, properties.length));
    };

    if (source && typeof source === 'object') {
      for (const key of IFC_PROPERTY_COLLECTION_KEYS) {
        const collection = (source as any)[key];
        if (Array.isArray(collection) && collection.length) {
          collection.forEach((entry) => pushProperty(entry, entry));
        }
      }
    }

    if (!properties.length) {
      if (Array.isArray(source)) {
        source.forEach((entry) => pushProperty(entry, entry));
      } else if (source && typeof source === 'object') {
        for (const [propKey, propValue] of Object.entries(source as Record<string, any>)) {
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
    };
  };

  const emitPropertySetRows = (meta: PropertySetMeta, candidate: any) => {
    const propertySet = candidate && typeof candidate === 'object' ? candidate : {};
    const extracted = extractPropertySetRows(propertySet as Record<string, any>, meta.rawName, meta.uniqueKey);
    if (extracted.length) {
      rows.push(...extracted);
    }
  };

  const processDeclarativeContainer = (container: any) => {
    if (!container || typeof container !== 'object') return;
    if (visited.has(container)) return;
    visited.add(container as object);

    if (Array.isArray(container)) {
      container.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const meta = makePropertySetMeta(entry);
        const target = isIfcPropertySet(entry) ? entry : buildSyntheticPropertySet(meta.rawName, entry);
        emitPropertySetRows(meta, target);
        if (target && typeof target === 'object') {
          visited.add(target);
        }
      });
      return;
    }

    for (const [psetName, rawValue] of Object.entries(container as Record<string, any>)) {
      if (rawValue == null) continue;
      const meta = makePropertySetMeta(psetName);
      const target = isIfcPropertySet(rawValue) ? rawValue : buildSyntheticPropertySet(meta.rawName, rawValue);
      emitPropertySetRows(meta, target);
      if (rawValue && typeof rawValue === 'object') {
        visited.add(rawValue);
      }
    }
  };

  const traverse = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(traverse);
      return;
    }

    // Process property set containers first
    let hasProcessedContainers = false;
    for (const key of PROPERTY_SET_CONTAINER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        processDeclarativeContainer((value as Record<string, any>)[key]);
        hasProcessedContainers = true;
      }
    }

    // If this object itself is a property set, emit its rows
    if (isIfcPropertySet(value)) {
      const meta = makePropertySetMeta(value);
      emitPropertySetRows(meta, value);
    }

    // Only traverse deeper if we haven't already processed property set containers
    // and this isn't a property set itself (to avoid double processing)
    if (!hasProcessedContainers && !isIfcPropertySet(value)) {
      Object.entries(value as Record<string, any>).forEach(([key, child]) => {
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
  
  const uniqueRows = Array.from(seen.values());
  
  // Debug logging (can be removed after verification)
  if (rows.length !== uniqueRows.length) {
  // deduplication completed
  }
  
  return uniqueRows;
};

const FRAGMENTS_ITEM_DATA_OPTIONS: Record<string, any> = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: {
      attributes: true,
      relations: true,
    },
  },
};

const IDS_NON_ELEMENT_CLASS_PREFIXES = [
  'ifcproperty',
  'ifcquantity',
  'ifcphysicalsimplequantity',
  'ifcprofile',
  'ifcmaterial',
  'ifcreldefines',
  'ifcstyleditem',
];

const isLikelyNonElementForIds = (ifcClass: string, candidate: any): boolean => {
  const normalizedClass = typeof ifcClass === 'string' ? ifcClass.trim().toLowerCase() : '';
  if (normalizedClass && IDS_NON_ELEMENT_CLASS_PREFIXES.some((prefix) => normalizedClass.startsWith(prefix))) {
    return true;
  }

  if (candidate && typeof candidate === 'object') {
    const categoryNominal = extractNominalValue((candidate as any)._category ?? (candidate as any).category ?? (candidate as any).Category ?? null);
    const normalizedCategory = typeof categoryNominal === 'string' ? categoryNominal.trim().toLowerCase() : '';
    if (normalizedCategory && IDS_NON_ELEMENT_CLASS_PREFIXES.some((prefix) => normalizedCategory.startsWith(prefix))) {
      return true;
    }

    const hasNominalValue =
      ((candidate as any).NominalValue != null || (candidate as any).nominalValue != null) &&
      ((candidate as any).Name != null || (candidate as any).PropertyName != null);
    if (hasNominalValue && normalizedClass.includes('property')) {
      return true;
    }
  }

  return false;
};

const FAVORITES_STORAGE_KEY = 'fragmentsViewer.favoritePropertyPaths';
const MAX_DISPLAY_PROPERTY_ROWS = 10000; // Increased limit - scrolling handles performance
const MAX_SEARCH_RESULTS = 500;

const readName = (value: any): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  let primary: string | undefined;
  let secondary: string | undefined;
  // support wrapped Name objects like { value: '...' } or { Value: ... }
  if (typeof value.Name === 'string') primary = value.Name;
  else if (value.Name && typeof value.Name === 'object') primary = extractNominalValue(value.Name) || undefined;

  if (typeof (value as any).name === 'string') secondary = (value as any).name;
  else if ((value as any).name && typeof (value as any).name === 'object') secondary = extractNominalValue((value as any).name) || undefined;
  const name = primary ?? secondary;
  if (!name) return undefined;
  const trimmed = name.trim();
  return trimmed.length ? trimmed : undefined;
};

const buildPropertyData = (item: Record<string, any> | null | undefined): { rows: PropertyRow[]; tree: PropertyNode[] } => {
  if (!item || typeof item !== 'object') return { rows: [], tree: [] };

  // Debug: Log input structure
  const inputKeys = Object.keys(item);
  // processed property data keys

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
        
        // CRITICAL FIX: Skip property set containers - they're processed by collectIfcPropertySetRows
        // This prevents duplicate extraction of properties
        if (entryKey === 'IsDefinedBy' || entryKey === 'isDefinedBy' || 
            entryKey === 'psets' || entryKey === 'Psets' || 
            entryKey === 'propertySets' || entryKey === 'PropertySets' ||
            entryKey === 'property_sets' || entryKey === 'Property_Sets') {
          continue; // Skip these containers to avoid duplicates
        }
        
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
  // collected property set rows
    
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
  // dedup results summarized
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
  const fragmentsReadyRef = useRef(false);
  const ifcImporterRef = useRef<FRAGS.IfcImporter | null>(null);
  const currentModelIdRef = useRef<string | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  // Dev helpers
  const [devDumpInProgress, setDevDumpInProgress] = useState(false);
  const [devDumpSampleOnly, setDevDumpSampleOnly] = useState<number | null>(50);

  const dumpModelRawData = useCallback(
    async (modelId?: string, opts?: { sample?: number; chunkSize?: number }) => {
      if (!import.meta.env.DEV) {
        console.warn('dumpModelRawData is dev-only.');
        return;
      }
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.warn('Fragments manager not ready');
        return;
      }
      const id = modelId ?? currentModelIdRef.current;
      if (!id) {
        console.warn('No modelId provided and no current model loaded');
        return;
      }
      const model = fragments.list.get(id);
      if (!model) {
        console.warn('Model not found in fragments list', id);
        return;
      }
      const chunkSize = Math.max(8, Math.floor(opts?.chunkSize ?? 128));
      const sample = typeof opts?.sample === 'number' ? opts.sample : devDumpSampleOnly ?? undefined;
      setDevDumpInProgress(true);
      try {
        let localIds: number[] = [];
        try {
          const fetched = await model.getLocalIds();
          if (Array.isArray(fetched)) localIds = fetched;
          else if (fetched && typeof (fetched as any)[Symbol.iterator] === 'function') localIds = Array.from(fetched as Iterable<number>);
        } catch (err) {
          console.warn('Failed to enumerate local IDs for dump', err);
          return;
        }
        if (!localIds.length) {
          console.info('Model has no local IDs to dump.');
          return;
        }
        const toProcess = typeof sample === 'number' && sample > 0 ? localIds.slice(0, sample) : localIds.slice();
        const out: Array<{ localId: number; data: any }> = [];
        for (let offset = 0; offset < toProcess.length; offset += chunkSize) {
          const chunk = toProcess.slice(offset, offset + chunkSize);
          let batch: any[] = [];
          try {
            batch = await model.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
          } catch (err) {
            console.warn(`Failed to fetch items data for chunk starting at ${chunk[0]}`, err);
            chunk.forEach((lId, idx) => out.push({ localId: lId, data: batch?.[idx] ?? null }));
            continue;
          }
          chunk.forEach((localId, i) => out.push({ localId, data: batch?.[i] ?? null }));
          await new Promise((r) => setTimeout(r, 0));
        }
        console.info(`Dumped ${out.length} items for model ${id} (sample=${sample ?? 'all'})`);
        const payload = {
          modelId: id,
          label: models.find((m) => m.id === id)?.label ?? id,
          collectedAt: new Date().toISOString(),
          itemCount: out.length,
          sampleLimit: sample ?? null,
          chunkSize,
          items: out,
        };
        try {
          const json = JSON.stringify(payload, null, 2);
          // raw dump prepared
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const safeLabel = (payload.label ?? id).replace(/[^\w\-]+/g, '_').slice(0, 40);
          a.download = `raw-frag-${safeLabel}-${id}-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (err) {
          console.warn('Failed to prepare/download dump', err);
        }
      } finally {
        setDevDumpInProgress(false);
      }
    },
    [models]
  );

  const inspectModelProperties = useCallback(
    async (modelId?: string, sampleSize = 50, chunkSize = 128) => {
      if (!import.meta.env.DEV) return;
      const fr = fragmentsRef.current;
      if (!fr) {
        console.warn('inspectModelProperties: fragments manager not ready');
        return;
      }
      const id = modelId ?? currentModelIdRef.current;
      if (!id) {
        console.warn('inspectModelProperties: no model id');
        return;
      }
      const model = fr.list.get(id);
      if (!model) {
        console.warn('inspectModelProperties: model not found', id);
        return;
      }

      console.groupCollapsed(`inspectModelProperties: model=${id}`);
      try {
        let localIds: number[] = [];
        try {
          const l = await model.getLocalIds();
          localIds = Array.isArray(l) ? l : Array.from(l as Iterable<number>);
        } catch (err) {
          console.warn('inspectModelProperties: failed to getLocalIds', err);
          console.groupEnd();
          return;
        }
        if (!localIds.length) {
          console.warn('inspectModelProperties: no localIds found');
          console.groupEnd();
          return;
        }

        const sample = localIds.slice(0, Math.min(sampleSize, localIds.length));
        const stats: Record<string, number> = {};
        const keyCounts: Record<string, number> = {};
        const examples: Array<{ localId: number; keys: string[]; foundShapes: string[]; snippet: any }> = [];

        for (let offset = 0; offset < sample.length; offset += chunkSize) {
          const chunk = sample.slice(offset, offset + chunkSize);
          let batch: any[] = [];
          try {
            batch = await model.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
          } catch (err) {
            console.warn('inspectModelProperties: getItemsData chunk failed', err);
            continue;
          }
          chunk.forEach((localId, i) => {
            const item = batch?.[i] ?? null;
            if (!item) {
              stats.missing = (stats.missing ?? 0) + 1;
              return;
            }
            const keys = Object.keys(item);
            keys.forEach((k) => (keyCounts[k] = (keyCounts[k] || 0) + 1));
            const foundShapes: string[] = [];
            if (item.HasProperties || item.Properties || item.PropertySets || item.psets) foundShapes.push('HasProperties/Properties/PropertySets/psets');
            const hasSingleValue =
              keys.some((k) => {
                const v = item[k];
                if (!v) return false;
                if (typeof v === 'object' && (v.Name || v.PropertyName) && (v.NominalValue || v.value || v.Value)) return true;
                if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
                  return v.some((x: any) => x && (x.PropertyName || x.Name) && (x.NominalValue || x.value || x.Value));
                }
                return false;
              }) || false;
            if (hasSingleValue) foundShapes.push('IfcPropertySingleValue-like');
            const psetKeys = keys.filter((k) => /^pset|^Pset|PropertySet/i.test(k));
            if (psetKeys.length) foundShapes.push(`psetKeys:${psetKeys.slice(0, 3).join(',')}`);
            if (examples.length < 6) {
              examples.push({
                localId,
                keys,
                foundShapes,
                snippet: Object.fromEntries(keys.slice(0, 10).map((k) => [k, item[k]])),
              });
            }
            foundShapes.forEach((s) => (stats[s] = (stats[s] || 0) + 1));
          });
          await new Promise((r) => setTimeout(r, 0));
        }
                    <Button size="small" variant="outlined" onClick={async () => {
                      const api = viewerApiRef.current;
                      if (!api || typeof (api as any).buildIdsCache !== 'function') {
                        alert('Build cache is not available in the current viewer API');
                        return;
                      }
                      try {
                        const count = await (api as any).buildIdsCache();
                        alert(`Built ids cache with ${count} elements`);
                      } catch (err) {
                        console.error('Build cache failed', err);
                        alert(`Build cache failed: ${String(err)}`);
                      }
                    }}>Build cache</Button>

  // inspectModelProperties stats available in variable 'stats'
        console.log('inspectModelProperties examples (up to 6):', examples);
        const foundAnyPset = Object.keys(stats).some((k) => /pset|HasProperties|PropertySet|IfcPropertySingleValue/i.test(k));
        if (!foundAnyPset) {
          console.warn(
            'inspectModelProperties: no property-set shapes detected in sample. This suggests the IFC→.frag conversion did not export Psets for this model. Check conversion options or use an exporter that includes property sets (web-ifc flags / exporter settings).'
          );
        }
      } catch (err) {
        console.error('inspectModelProperties: unexpected error', err);
      } finally {
        console.groupEnd();
      }
    },
    []
  );
  const [selectedItems, setSelectedItems] = useState<Selection[]>([]);
  const [properties, setProperties] = useState<Record<string, any> | null>(null);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [isExplorerMinimized, setIsExplorerMinimized] = useState(false);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [ifcProgress, setIfcProgress] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [componentsReady, setComponentsReady] = useState(false);
  const ifcAbortRef = useRef<AbortController | null>(null);
  const ifcCancelledRef = useRef<boolean>(false);
  const selectionMarkerRef = useRef<THREE.Group | null>(null);
  const prevInstanceHighlightRef = useRef<{ mesh: THREE.InstancedMesh; index: number } | null>(null);
  const aiSelectionSeqRef = useRef(0);
  const highlighterRef = useRef<any>(null);
  const idsOriginalColorsRef = useRef<Map<string, { material: any; color: THREE.Color | null }> | null>(null);
  const ghostOriginalMaterialsRef = useRef<Map<any, { color: number | undefined; transparent: boolean; opacity: number }> | null>(null);
  
  // Rectangle selection refs
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const isDrawingSelectionRef = useRef(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionModeRef = useRef<'click' | 'rectangle'>('click');
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
  const lastModelsSignatureRef = useRef<string | null>(null);
  const hiderRef = useRef<OBC.Hider | null>(null);
  const selectedRef = useRef<Selection[]>([]);
  const idsCacheRef = useRef<IdsCache | null>(null);
  const idsCachePromiseRef = useRef<Promise<IdsCache> | null>(null);
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [propertyRows, setPropertyRows] = useState<PropertyRow[]>([]);
  const [selectionSearch, setSelectionSearch] = useState('');
  const [modelTreeSearch, setModelTreeSearch] = useState('');
  const [favoritePropertyPaths, setFavoritePropertyPaths] = useState<string[]>([]);
  const [selectedPropertyTab, setSelectedPropertyTab] = useState<PropertyTabId>('favorites');
  const [isModelsSectionCollapsed, setIsModelsSectionCollapsed] = useState(false);
  const [isSelectionPropertiesCollapsed, setIsSelectionPropertiesCollapsed] = useState(false);
  const [isModelTreeCollapsed, setIsModelTreeCollapsed] = useState(false);
  const [explorerMainTab, setExplorerMainTab] = useState<'models' | 'properties' | 'tree'>('models');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatExpandSignal, setChatExpandSignal] = useState(0);
  const [isIdsOpen, setIsIdsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Settings dialog state
  const [settingsProvider, setSettingsProvider] = useState<AIProvider>('disabled');
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [settingsModel, setSettingsModel] = useState('');
  const [showSettingsApiKey, setShowSettingsApiKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'error' | null>(null);
  
  // Selection mode state
  const [selectionMode, setSelectionMode] = useState<'click' | 'rectangle'>('click');
  const [idsExpandSignal, setIdsExpandSignal] = useState(0);
  const [isIdsCreatorOpen, setIsIdsCreatorOpen] = useState(false);
  const [modelSummaries, setModelSummaries] = useState<Record<string, ModelSummary>>({});
  const [lastItemsDataTSV, setLastItemsDataTSV] = useState<string | null>(null);
  const [lastItemsDataRows, setLastItemsDataRows] = useState<{ path: string; value: string }[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'selected' | 'model'>('selected');
  const [exportModelId, setExportModelId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isViewToolbarOpen, setIsViewToolbarOpen] = useState(false);
  const [clippingPlanes, setClippingPlanes] = useState({ x: false, y: false, z: false });
  const [clippingPositions, setClippingPositions] = useState({ x: 0, y: 0, z: 0 });
  const [isClippingBoxActive, setIsClippingBoxActive] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const isMeasuringRef = useRef(false);
  const clippingPlanesRef = useRef<THREE.Plane[]>([]);
  const clippingHelpersRef = useRef<Map<string, THREE.PlaneHelper>>(new Map());
  const measurementToolRef = useRef<OBCF.LengthMeasurement | null>(null);
  const [lastMeasurementValue, setLastMeasurementValue] = useState<string | null>(null);
  const cameraControlsRef = useRef<any>(null);

  const getWorldCamera = useCallback((): OBC.OrthoPerspectiveCamera | null => {
    const world = worldRef.current;
    return (world?.camera as OBC.OrthoPerspectiveCamera | undefined) ?? null;
  }, []);

  const getThreeCamera = useCallback((): (THREE.PerspectiveCamera | THREE.OrthographicCamera) | null => {
    const camera = getWorldCamera();
    return (camera?.three as THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined) ?? null;
  }, [getWorldCamera]);

  // Sync selection mode state with ref for event handlers
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  // Update camera controls based on selection mode
  useEffect(() => {
    const controls = cameraControlsRef.current;
    if (!controls || !('mouseButtons' in controls)) return;
    
    if (selectionMode === 'rectangle') {
      // Disable left-click rotation for rectangle selection
      (controls as any).mouseButtons = {
        left: 0,    // NONE - disabled for rectangle selection
        middle: 2,  // TRUCK (pan) - middle mouse button
        right: 0,   // NONE - context menu
        wheel: 16,  // DOLLY (zoom) - mouse wheel
      };
    } else {
      // Enable left-click rotation for normal click selection
      (controls as any).mouseButtons = {
        left: 1,    // ROTATE (orbit) - left mouse button
        middle: 2,  // TRUCK (pan) - middle mouse button
        right: 0,   // NONE - context menu
        wheel: 16,  // DOLLY (zoom) - mouse wheel
      };
    }
  }, [selectionMode]);

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

  const modelsSignature = useMemo(() => models.map((model) => `${model.id}:${model.label}`).join('|'), [models]);

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
          batch = await record.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
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

  const handleCopyRawData = useCallback(async () => {
    if (!properties) {
      alert('No element selected');
      return;
    }
    try {
      // Handle circular references by tracking seen objects
      const seen = new WeakSet();
      const jsonString = JSON.stringify(properties, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        // Handle special types
        if (value instanceof Map) {
          return `[Map with ${value.size} entries]`;
        }
        if (value instanceof Set) {
          return `[Set with ${value.size} items]`;
        }
        if (value instanceof WeakMap || value instanceof WeakSet) {
          return '[WeakMap/WeakSet]';
        }
        if (typeof value === 'function') {
          return '[Function]';
        }
        if (typeof value === 'symbol') {
          return '[Symbol]';
        }
        return value;
      }, 2);
      await navigator.clipboard.writeText(jsonString);
      alert('Raw element data copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy raw data:', error);
      alert('Failed to copy data to clipboard. See console for details.');
    }
  }, [properties]);

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

  const toggleIdsCreatorPanel = useCallback(() => {
    setIsIdsCreatorOpen((prev) => !prev);
  }, []);

  const openChatWindow = useCallback(() => {
    setIsChatOpen(true);
    setChatExpandSignal((value) => value + 1);
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

  const handleAboutOpen = useCallback(() => {
    setIsAboutOpen(true);
  }, []);

  const handleAboutClose = useCallback(() => {
    setIsAboutOpen(false);
  }, []);

  const handleSettingsOpen = useCallback(() => {
    // Load current config
    const config = loadApiConfig();
    if (config) {
      setSettingsProvider(config.provider);
      setSettingsApiKey(config.apiKey);
      setSettingsModel(config.model || getDefaultModel(config.provider));
    } else {
      setSettingsProvider('disabled');
      setSettingsApiKey('');
      setSettingsModel('');
    }
    setConnectionTestResult(null);
    setIsSettingsOpen(true);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
    setShowSettingsApiKey(false);
    setConnectionTestResult(null);
  }, []);

  const handleSettingsSave = useCallback(() => {
    if (settingsProvider === 'disabled') {
      clearApiConfig();
    } else {
      const config: ApiConfig = {
        provider: settingsProvider,
        apiKey: settingsApiKey,
        model: settingsModel || getDefaultModel(settingsProvider)
      };
      saveApiConfig(config);
    }
    handleSettingsClose();
  }, [settingsProvider, settingsApiKey, settingsModel, handleSettingsClose]);

  const handleProviderChange = useCallback((provider: AIProvider) => {
    setSettingsProvider(provider);
    setSettingsModel(getDefaultModel(provider));
    setConnectionTestResult(null);
  }, []);

  const handleTestConnection = useCallback(async () => {
    if (!settingsApiKey || settingsProvider === 'disabled') return;
    
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    
    try {
      let success = false;
      const model = settingsModel || getDefaultModel(settingsProvider);
      
      if (settingsProvider === 'gemini') {
        success = await testGeminiConnection(settingsApiKey, model);
      } else if (settingsProvider === 'openai') {
        success = await testOpenAIConnection(settingsApiKey, model);
      }
      
      setConnectionTestResult(success ? 'success' : 'error');
    } catch {
      setConnectionTestResult('error');
    } finally {
      setIsTestingConnection(false);
    }
  }, [settingsProvider, settingsApiKey, settingsModel]);

  const extractIfcClassFromData = useCallback((data: any): string => {
    if (!data || typeof data !== 'object') return 'IfcProduct';
    
    // Primary: check constructor.name (web-ifc often uses class instances whose constructor name is the IFC type)
    if (data.constructor && typeof data.constructor.name === 'string' && data.constructor.name.toUpperCase().startsWith('IFC')) {
      const constructorName = data.constructor.name.trim();
      if (constructorName !== 'Object' && constructorName !== 'Array') {
        return constructorName;
      }
    }
    
    // Try _category.value (common for wrapped IFC data)
    const categoryValue = extractNominalValue((data as any)._category ?? (data as any).category ?? (data as any).Category ?? null);
    if (categoryValue && categoryValue.trim().length && categoryValue.toUpperCase().startsWith('IFC')) {
      return categoryValue.trim();
    }
    
    // Direct field candidates (order matters: most specific first)
    const candidates = [
      (data as any).expressID !== undefined ? null : (data as any).type, // only use 'type' if expressID is not present (avoid confusion with type ID)
      (data as any).ifcClass,
      (data as any).IfcClass,
      (data as any).Type,
      (data as any).expressType,
      (data as any).ExpressType,
      (data as any).entity,
      (data as any).Entity,
      (data as any).ifcType,
      (data as any).IfcType,
      data?.attributes?.ifcClass,
      data?.Attributes?.IfcClass,
    ];
    
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length) {
        const trimmed = candidate.trim();
        // Skip if it looks like a property type not an entity class
        if (trimmed.toUpperCase().startsWith('IFC') && !trimmed.toUpperCase().includes('IDENTIFIER') && !trimmed.toUpperCase().includes('LABEL') && !trimmed.toUpperCase().includes('TEXT')) {
          return trimmed;
        }
      }
    }
    
    // Fallback keyword search
    const fallback = findFirstValueByKeywords(data, ['ifcclass', 'ifc type', 'express type']);
    if (fallback && fallback.toUpperCase().startsWith('IFC')) return fallback;
    
    return 'IfcProduct';
  }, []);

  const flattenPropertiesForIds = useCallback((data: any, globalId: string, ifcClass: string) => {
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

    // If converter left useful values as wrapped top-level fields (e.g. Name: { value: '...' }, _guid: { value: '...' })
    // extract nominal values and put them into Attributes and flattened map so the UI and IDS can see them.
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v == null) continue;
      if (typeof v !== 'object' || Array.isArray(v)) continue;
      const nominal = extractNominalValue(v);
      if (!nominal) continue;
      const cleaned = String(k).replace(/^_+/, '');
      const attrKey = `Attributes.${prettifyLabel(cleaned)}`;
      if (!(attrKey in flattened)) flattened[attrKey] = nominal;
      if (!(cleaned in attributes)) attributes[cleaned] = nominal;
      if (/guid|globalid|_guid/i.test(k)) {
        const candidate = String(nominal).trim();
        if (candidate && !flattened.GlobalId) {
          flattened.GlobalId = candidate;
          attributes.GlobalId = candidate;
        }
      }
    }

    return { flattened, psets, attributes };
  }, []);

  const computeIdsSignature = useCallback(() => {
    const fragments = fragmentsRef.current;
    if (!fragments) return 'empty';
    const ids = Array.from(fragments.list.keys()).sort();
    return `${ids.join('|')}|${models.length}`;
  }, [models]);

  // Compute comprehensive model signature for cache invalidation
  const computeModelSignature = useCallback(async (): Promise<{
    signature: string;
    elementCount: number;
    modelFiles: Array<{ id: string; name: string }>;
  }> => {
    console.log('🔑 [computeModelSignature] START');
    const fragments = fragmentsRef.current;
    
    if (!fragments || fragments.list.size === 0) {
      console.log('⚠️ [computeModelSignature] No fragments available');
      return { signature: 'empty', elementCount: 0, modelFiles: [] };
    }

    console.log(`📊 [computeModelSignature] Found ${fragments.list.size} models in fragments`);

    // Collect model IDs sorted
    const modelIds = Array.from(fragments.list.keys()).sort();
    console.log('🔑 [computeModelSignature] Model IDs:', modelIds);
    
    // Collect model names from the models state
    const modelFiles = models.map(m => ({ id: m.id, name: m.label }));
    console.log('📁 [computeModelSignature] Model files:', modelFiles);
    
    // Count total elements across all models
    console.log('🔢 [computeModelSignature] Counting elements across all models...');
    let totalElements = 0;
    for (const [modelId, model] of fragments.list) {
      console.log(`🔍 [computeModelSignature] Getting local IDs for model ${modelId}...`);
      try {
        const fetched = await model.getLocalIds();
        console.log(`✅ [computeModelSignature] Got local IDs for model ${modelId}, type:`, typeof fetched);
        const localIds = Array.isArray(fetched) 
          ? fetched 
          : (fetched && typeof (fetched as any)[Symbol.iterator] === 'function')
            ? Array.from(fetched as Iterable<number>)
            : [];
        console.log(`📊 [computeModelSignature] Model ${modelId} has ${localIds.length} elements`);
        totalElements += localIds.length;
      } catch (error) {
        console.error(`❌ [computeModelSignature] Failed to count elements in model ${modelId}`, error);
      }
    }

    console.log(`📊 [computeModelSignature] Total elements across all models: ${totalElements}`);

    // Build signature: modelIds + names + element count
    const parts = [
      ...modelIds,
      ...models.map(m => `${m.id}:${m.label}`),
      `count:${totalElements}`
    ];
    const signature = parts.join('|');
    
    console.log('🔑 [computeModelSignature] Generated signature (first 100 chars):', signature.substring(0, 100));

    const result = {
      signature,
      elementCount: totalElements,
      modelFiles
    };
    
    console.log('✅ [computeModelSignature] COMPLETE:', result);
    return result;
  }, [models]);

  const ensureIdsCache = useCallback(async (): Promise<IdsCache> => {
    const fragments = fragmentsRef.current;
    if (!fragments || fragments.list.size === 0) {
      const empty: IdsCache = { signature: 'empty', records: new Map(), elements: [], modelLocalIds: new Map() };
      idsCacheRef.current = empty;
      return empty;
    }

    const signature = computeIdsSignature();
    if (idsCacheRef.current && idsCacheRef.current.signature === signature) {
      return idsCacheRef.current;
    }

    if (idsCachePromiseRef.current) {
      return idsCachePromiseRef.current;
    }

    const promise = (async () => {
      const records = new Map<string, IdsElementRecord>();
      const elements: ElementData[] = [];
      const modelLocalIds = new Map<string, number[]>();

      for (const [modelId, model] of fragments.list) {
        let localIds: number[] = [];
        try {
          const fetched = await model.getLocalIds();
          if (Array.isArray(fetched)) localIds = fetched;
          else if (fetched && typeof (fetched as any)[Symbol.iterator] === 'function') {
            localIds = Array.from(fetched as Iterable<number>);
          }
        } catch (error) {
          console.warn(`IDS cache: failed to read local IDs for model ${modelId}`, error);
          continue;
        }

        modelLocalIds.set(modelId, localIds.slice());
        if (!localIds.length) continue;

        const chunkSize = 48;
        for (let index = 0; index < localIds.length; index += chunkSize) {
          const chunk = localIds.slice(index, index + chunkSize);
          let batch: any[] = [];
          try {
            batch = await model.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
          } catch (error) {
            console.warn(`IDS cache: failed to fetch items data for model ${modelId}`, error);
            continue;
          }

          batch.forEach((itemData, position) => {
            if (!itemData) return;
            const localId = chunk[position];
            const ifcClass = extractIfcClassFromData(itemData);
            const globalIdCandidate =
              (typeof itemData.GlobalId === 'string' && itemData.GlobalId.trim()) ||
              (typeof itemData.GlobalID === 'string' && itemData.GlobalID.trim()) ||
              findFirstValueByKeywords(itemData, ['globalid', 'global id', 'guid']);
            if (!globalIdCandidate) {
              if (isLikelyNonElementForIds(ifcClass, itemData)) {
                if (import.meta.env.DEV) {
                  console.debug('IDS cache: skipping non-element record without GlobalId', {
                    modelId,
                    localId,
                    ifcClass,
                    category: extractNominalValue((itemData as any)?._category ?? null),
                  });
                }
                return;
              }
              console.warn('IDS cache: missing GlobalId for localId', {
                modelId,
                localId,
                itemData,
              });
              return;
            }
            const globalId = globalIdCandidate.trim();
            if (!globalId.length || records.has(globalId)) return;

            const { flattened, psets, attributes } = flattenPropertiesForIds(itemData, globalId, ifcClass);
            const element: ElementData = { GlobalId: globalId, ifcClass, properties: flattened };

            const rawData = itemData as Record<string, unknown>;
            if (typeof rawData.GlobalId !== 'string' || !rawData.GlobalId.trim()) {
              rawData.GlobalId = globalId;
            }
            records.set(globalId, {
              element,
              modelId,
              localId,
              psets,
              attributes,
              raw: rawData,
            });
            elements.push(element);
          });
        }
      }

      const cache: IdsCache = { signature, records, elements, modelLocalIds };
      idsCacheRef.current = cache;
      return cache;
    })().finally(() => {
      idsCachePromiseRef.current = null;
    });

    idsCachePromiseRef.current = promise;
    return promise;
  }, [computeIdsSignature, flattenPropertiesForIds, extractIfcClassFromData]);

  const groupLocalIdsByModel = useCallback(
    async (globalIds: string[]) => {
      const grouped = new Map<string, number[]>();
      
      console.log(`🔍 [groupLocalIdsByModel] Grouping ${globalIds.length} GlobalIds using ThatOpen API...`);
      
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.error(`🔍 [groupLocalIdsByModel] Fragments not available`);
        return { grouped, cache: idsCacheRef.current };
      }
      
      // Use ThatOpen's getLocalIdsByGuids() - much faster, no cache needed!
      for (const [modelId, model] of fragments.list) {
        try {
          // Get local IDs for all globalIds in this model at once (batch operation)
          const localIds = await model.getLocalIdsByGuids(globalIds);
          
          // Filter out nulls and add to grouped map
          const validLocalIds: number[] = [];
          for (let i = 0; i < localIds.length; i++) {
            const localId = localIds[i];
            if (localId !== null) {
              validLocalIds.push(localId);
            }
          }
          
          if (validLocalIds.length > 0) {
            grouped.set(modelId, validLocalIds);
          }
        } catch (error) {
          console.warn(`🔍 [groupLocalIdsByModel] Failed for model ${modelId}:`, error);
        }
      }
      
      console.log(`🔍 [groupLocalIdsByModel] Grouped ${globalIds.length} GlobalIds into ${grouped.size} models (${Array.from(grouped.values()).reduce((sum, arr) => sum + arr.length, 0)} total local IDs)`);
      return { grouped, cache: idsCacheRef.current };
    },
    [] // No dependencies - uses fragmentsRef directly
  );

  const viewerApi = React.useMemo<ViewerApi>(() => ({
    listGlobalIds: async () => {
      const cache = await ensureIdsCache();
      return cache.elements.map((element) => element.GlobalId);
    },
    getSelectedGlobalIds: async () => {
      // Get currently selected element global IDs directly from fragments
      console.log('📍 getSelectedGlobalIds called, selectedRef.current:', selectedRef.current);
      const selection = selectedRef.current; // Use the ref to get latest selection
      
      if (!selection || selection.length === 0) {
        console.log('📍 No selection found');
        return []; // No selection
      }
      
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.warn('📍 Fragments not available');
        return [];
      }
      
      console.log('📍 Processing selection:', selection);
      // Fetch GlobalId directly from each selected element
      const selectedGlobalIds: string[] = [];
      for (const item of selection) {
        const model = fragments.list.get(item.modelId);
        if (!model) {
          console.warn('📍 Model not found for item:', item);
          continue;
        }
        
        try {
          // Fetch just the GlobalId from the element data
          const [data] = await model.getItemsData([item.localId], { attributesDefault: false });
          if (data) {
            const globalId = findFirstValueByKeywords(data, ['globalid', 'global id', 'guid']);
            if (globalId && typeof globalId === 'string') {
              selectedGlobalIds.push(globalId);
              console.log('📍 Found GlobalId for item:', item, '→', globalId);
            } else {
              console.warn('📍 No GlobalId found in data for item:', item);
            }
          }
        } catch (error) {
          console.error('📍 Error fetching data for item:', item, error);
        }
      }
      
      console.log('📍 Final selectedGlobalIds:', selectedGlobalIds);
      return selectedGlobalIds;
    },
    getVisibleGlobalIds: async () => {
      // Get all visible elements from all models using ThatOpen API
      console.log('👁️ getVisibleGlobalIds called');
      
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.warn('👁️ Fragments not available');
        return [];
      }
      
      const visibleGlobalIds: string[] = [];
      
      for (const [modelId, model] of fragments.list) {
        try {
          console.log(`👁️ Getting visible elements from model: ${modelId}`);
          
          // Get local IDs of visible elements
          const visibleLocalIds = await model.getItemsByVisibility(true);
          console.log(`👁️ Model ${modelId}: ${visibleLocalIds.length} visible elements`);
          
          if (visibleLocalIds.length === 0) continue;
          
          // Convert local IDs to GlobalIds
          // We need to fetch the GlobalId attribute for each visible element
          const batchSize = 100; // Process in batches to avoid overwhelming the system
          for (let i = 0; i < visibleLocalIds.length; i += batchSize) {
            const batch = visibleLocalIds.slice(i, Math.min(i + batchSize, visibleLocalIds.length));
            
            try {
              const itemsData = await model.getItemsData(batch, { 
                attributesDefault: false,
                attributes: ['GlobalId']
              });
              
              for (const data of itemsData) {
                const globalId = findFirstValueByKeywords(data, ['globalid', 'global id', 'guid']);
                if (globalId && typeof globalId === 'string') {
                  visibleGlobalIds.push(globalId);
                }
              }
            } catch (error) {
              console.error(`👁️ Error fetching GlobalIds for batch in model ${modelId}:`, error);
            }
          }
        } catch (error) {
          console.error(`👁️ Error getting visible elements from model ${modelId}:`, error);
        }
      }
      
      console.log(`👁️ Total visible GlobalIds: ${visibleGlobalIds.length}`);
      return visibleGlobalIds;
    },
    getElementProps: async (globalId: string) => {
      console.log('🔍 [getElementProps] START for', globalId);
      // Truly on-demand: fetch properties directly without cache
      const fragments = fragmentsRef.current;
      if (!fragments) {
        throw new Error('Fragments not available');
      }
      
      // Find which model contains this GlobalId
      console.log('🔍 [getElementProps] Searching across', fragments.list.size, 'models');
      for (const [modelId, model] of fragments.list) {
        try {
          // Convert GlobalId to local ID
          const localIds = await model.getLocalIdsByGuids([globalId]);
          const localId = localIds[0];
          
          if (localId !== null && localId !== undefined) {
            console.log(`🔍 [getElementProps] Found in model ${modelId}, localId: ${localId}`);
            
            // Fetch data on-demand with full relations
            const [data] = await model.getItemsData([localId], FRAGMENTS_ITEM_DATA_OPTIONS);
            
            if (!data) {
              console.warn(`🔍 [getElementProps] No data returned for localId ${localId}`);
              continue;
            }
            
            console.log('🔍 [getElementProps] Got data, extracting properties...');
            
            // Extract IFC class
            const ifcClass = extractIfcClassFromData(data);
            console.log('🔍 [getElementProps] ifcClass:', ifcClass);
            
            const psets: Record<string, Record<string, unknown>> = {};
            const attributes: Record<string, unknown> = {};
            
            // Extract property sets
            const propertyRows = collectIfcPropertySetRows(data);
            console.log('🔍 [getElementProps] Got', propertyRows.length, 'property rows');
            
            propertyRows.forEach((row) => {
              const labelParts = row.label.split('/').map((part: string) => part.trim());
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
            });
            
            // Extract basic attributes
            attributes.ifcClass = ifcClass;
            attributes.GlobalId = globalId;
            const name = readName(data);
            if (name) attributes.Name = name;
            const category = findFirstValueByKeywords(data, ['category', 'ifccategory']);
            if (category) attributes.Category = category;
            const typeValue = findFirstValueByKeywords(data, ['type', 'typename']);
            if (typeValue) attributes.Type = typeValue;
            
            console.log(`🔍 [getElementProps] SUCCESS: ${Object.keys(psets).length} psets, ${Object.keys(attributes).length} attributes`);
            return { ifcClass, psets, attributes };
          }
        } catch (error) {
          console.warn(`🔍 [getElementProps] Error in model ${modelId}:`, error);
          continue;
        }
      }
      
      // If not found in any model, throw error
      console.error(`🔍 [getElementProps] Element with GlobalId ${globalId} not found in any model`);
      throw new Error(`Element with GlobalId ${globalId} is not available.`);
    },
    getElementPropsFast: async (globalId: string) => {
      console.log('🔍 [getElementPropsFast] START for', globalId);
      // Fast path: get properties directly from selectedRef without building full cache
      const selection = selectedRef.current;
      const fragments = fragmentsRef.current;
      
      console.log('🔍 [getElementPropsFast] Selection:', selection);
      console.log('🔍 [getElementPropsFast] Fragments available:', !!fragments);
      
      if (!fragments) {
        console.error('🔍 [getElementPropsFast] Fragments not available!');
        throw new Error('Fragments not available');
      }
      
      // Find the element in current selection first (most likely case for filtered validation)
      console.log('🔍 [getElementPropsFast] Searching in', selection.length, 'selected items');
      for (let i = 0; i < selection.length; i++) {
        const item = selection[i];
        console.log(`🔍 [getElementPropsFast] Checking item ${i + 1}/${selection.length}:`, item);
        const model = fragments.list.get(item.modelId);
        if (!model) {
          console.log(`🔍 [getElementPropsFast] Model not found for ${item.modelId}`);
          continue;
        }
        
        try {
          console.log(`🔍 [getElementPropsFast] Calling getItemsData for localId ${item.localId}...`);
          const [data] = await model.getItemsData([item.localId], FRAGMENTS_ITEM_DATA_OPTIONS);
          console.log('🔍 [getElementPropsFast] Got data:', !!data);
          
          if (data) {
            console.log('🔍 [getElementPropsFast] Data keys:', Object.keys(data));
            console.log('🔍 [getElementPropsFast] data._category:', data._category);
            console.log('🔍 [getElementPropsFast] data.ifcClass:', data.ifcClass);
            console.log('🔍 [getElementPropsFast] data.type:', data.type);
            console.log('🔍 [getElementPropsFast] data.constructor.name:', data.constructor?.name);
            
            const elementGlobalId = findFirstValueByKeywords(data, ['globalid', 'global id', 'guid']);
            console.log(`🔍 [getElementPropsFast] Element GlobalId: ${elementGlobalId}, looking for: ${globalId}`);
            
            if (elementGlobalId === globalId) {
              console.log('🔍 [getElementPropsFast] MATCH! Extracting properties...');
              // Found it! Extract properties directly using the same logic as cache building
              const ifcClass = extractIfcClassFromData(data);
              console.log('🔍 [getElementPropsFast] ifcClass extracted:', ifcClass);
              
              const psets: Record<string, Record<string, unknown>> = {};
              const attributes: Record<string, unknown> = {};
              
              console.log('🔍 [getElementPropsFast] Calling collectIfcPropertySetRows...');
              // Extract property sets
              const propertyRows = collectIfcPropertySetRows(data);
              console.log('🔍 [getElementPropsFast] Got', propertyRows.length, 'property rows');
              
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
              });
              
              console.log('🔍 [getElementPropsFast] Extracted', Object.keys(psets).length, 'psets');
              
              // Extract basic attributes
              attributes.ifcClass = ifcClass;
              attributes.GlobalId = globalId;
              const name = readName(data);
              if (name) attributes.Name = name;
              const category = findFirstValueByKeywords(data, ['category', 'ifccategory']);
              if (category) attributes.Category = category;
              const typeValue = findFirstValueByKeywords(data, ['type', 'typename']);
              if (typeValue) attributes.Type = typeValue;
              
              console.log(`📌 Fast props for ${globalId}:`, { ifcClass, psetCount: Object.keys(psets).length });
              console.log('🔍 [getElementPropsFast] SUCCESS - returning properties');
              return { ifcClass, psets, attributes };
            }
          }
        } catch (error) {
          console.error(`🔍 [getElementPropsFast] Error for item:`, item, error);
        }
      }
      
      // Fallback to regular method if not found in selection
      console.log(`📌 ${globalId} not in selection, falling back to cache`);
      console.log('🔍 [getElementPropsFast] FALLBACK to getElementProps');
      return viewerApiRef.current!.getElementProps(globalId);
    },
    countElements: async () => {
      const cache = await ensureIdsCache();
      return cache.elements.length;
    },
    iterElements: (options) => {
      const batchSize = Math.max(1, Math.floor(options?.batchSize ?? 500));
      console.log('🔄 [viewerApi.iterElements] START', { batchSize });
      return {
        async *[Symbol.asyncIterator]() {
          const fragments = fragmentsRef.current;
          if (!fragments || fragments.list.size === 0) {
            console.warn('⚠️ [viewerApi.iterElements] No fragments available');
            return;
          }
          
          console.log(`🔄 [viewerApi.iterElements] Processing ${fragments.list.size} models with batch size ${batchSize}`);
          
          let accumulator: Array<{ modelId: string; localId: number; data: Record<string, unknown> }> = [];
          let totalYielded = 0;
          
          // Iterate directly from fragments without building full cache
          for (const [modelId, model] of fragments.list) {
            // Get local IDs for this model
            let localIds: number[] = [];
            try {
              const fetched = await model.getLocalIds();
              localIds = Array.isArray(fetched) 
                ? fetched 
                : (fetched && typeof (fetched as any)[Symbol.iterator] === 'function')
                  ? Array.from(fetched as Iterable<number>)
                  : [];
              console.log(`✅ [viewerApi.iterElements] Model ${modelId}: ${localIds.length} elements`);
            } catch (error) {
              console.error(`❌ [viewerApi.iterElements] Failed to get local IDs for model ${modelId}`, error);
              continue;
            }
            
            // Fetch in larger chunks for efficiency - use batchSize as chunk size
            const chunkSize = Math.min(500, Math.max(100, batchSize));
            for (let index = 0; index < localIds.length; index += chunkSize) {
              const chunk = localIds.slice(index, index + chunkSize);
              
              try {
                const itemsData = await model.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
                
                // Add to accumulator
                for (let i = 0; i < itemsData.length; i++) {
                  const data = itemsData[i];
                  if (data) {
                    accumulator.push({
                      modelId,
                      localId: chunk[i],
                      data: data as Record<string, unknown>,
                    });
                  }
                }
                
                // Yield when accumulator reaches batch size
                while (accumulator.length >= batchSize) {
                  const toYield = accumulator.splice(0, batchSize);
                  totalYielded += toYield.length;
                  if (totalYielded % 5000 === 0 || totalYielded === batchSize) {
                    console.log(`📤 [viewerApi.iterElements] Yielded ${totalYielded} elements...`);
                  }
                  yield toYield;
                }
              } catch (error) {
                console.error(`❌ [viewerApi.iterElements] Failed to fetch chunk at ${index}`, error);
              }
            }
          }
          
          // Yield remaining elements
          if (accumulator.length > 0) {
            totalYielded += accumulator.length;
            yield accumulator;
          }
          
          console.log(`✅ [viewerApi.iterElements] Complete: ${totalYielded} elements`);
        },
      };
    },
    // DEPRECATED: Use iterElements for incremental extraction instead
    // This method is kept for compatibility but triggers full cache build
    _iterElementsLegacy: (options?: { batchSize?: number }) => {
      const batchSize = Math.max(1, Math.floor(options?.batchSize ?? 100));
      return {
        async *[Symbol.asyncIterator]() {
          const cache = await ensureIdsCache();
          const records = Array.from(cache.records.values());
          for (let index = 0; index < records.length; index += batchSize) {
            const slice = records.slice(index, index + batchSize).map((record) => ({
              modelId: record.modelId,
              localId: record.localId,
              data: {
                ...record.raw,
                GlobalId: record.element.GlobalId,
              } as Record<string, unknown>,
            }));
            if (slice.length) {
              yield slice;
            }
          }
        },
      };
    },
    // Expose a buildIdsCache helper to force building the ids cache
    buildIdsCache: async (): Promise<number> => {
      try {
        const cache = await ensureIdsCache();
        return cache.elements.length;
      } catch (err) {
        console.error('viewerApi.buildIdsCache failed', err);
        throw err;
      }
    },
    // Get comprehensive model signature for cache validation
    getModelSignature: async () => {
      return await computeModelSignature();
    },
    addToCache: async (globalIds: string[]) => {
      // Add elements to the cache incrementally
      console.log(`📦 [addToCache] Adding ${globalIds.length} elements to cache`);
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.warn('📦 [addToCache] Fragments not available');
        return;
      }
      
      // Get or initialize cache
      let cache = idsCacheRef.current;
      if (!cache) {
        const signature = computeIdsSignature();
        cache = {
          signature,
          records: new Map(),
          elements: [],
          modelLocalIds: new Map()
        };
        idsCacheRef.current = cache;
      }
      
      // Add each element to cache
      const selection = selectedRef.current;
      console.log(`📦 [addToCache] Selection has ${selection.length} items`);
      
      for (const globalId of globalIds) {
        // Skip if already in cache
        if (cache.records.has(globalId)) {
          console.log(`📦 [addToCache] ${globalId} already in cache, skipping`);
          continue;
        }
        
        console.log(`📦 [addToCache] Searching for ${globalId} in ${selection.length} selected items...`);
        
        // Find the element in selection
        let found = false;
        for (const item of selection) {
          console.log(`📦 [addToCache] Checking item: modelId=${item.modelId}, localId=${item.localId}`);
          const model = fragments.list.get(item.modelId);
          if (!model) {
            console.log(`📦 [addToCache] Model not found: ${item.modelId}`);
            continue;
          }
          
          try {
            const [data] = await model.getItemsData([item.localId], FRAGMENTS_ITEM_DATA_OPTIONS);
            if (data) {
              // Extract GlobalId - it might be wrapped in an object with 'value' property
              let itemGlobalId = (data as any)._guid || (data as any).GlobalId;
              if (itemGlobalId && typeof itemGlobalId === 'object') {
                itemGlobalId = itemGlobalId.value || itemGlobalId;
              }
              console.log(`📦 [addToCache] Item GlobalId: ${itemGlobalId}, looking for: ${globalId}, match: ${itemGlobalId === globalId}`);
              if (itemGlobalId === globalId) {
                // Extract properties using same approach as getElementPropsFast
                const ifcClass = extractIfcClassFromData(data);
                
                // Extract psets
                const psets: Record<string, Record<string, unknown>> = {};
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
                });
                
                // Extract attributes
                const attributes: Record<string, unknown> = {
                  ifcClass,
                  GlobalId: globalId
                };
                const name = readName(data);
                if (name) attributes.Name = name;
                const category = findFirstValueByKeywords(data, ['category', 'ifccategory']);
                if (category) attributes.Category = category;
                const typeValue = findFirstValueByKeywords(data, ['type', 'typename']);
                if (typeValue) attributes.Type = typeValue;
                
                // Create element record
                const element: ElementData = {
                  GlobalId: globalId,
                  ifcClass,
                  properties: flattenPropertiesForIds(data, globalId, ifcClass)
                };
                
                const record: IdsElementRecord = {
                  element,
                  modelId: item.modelId,
                  localId: item.localId,
                  psets,
                  attributes,
                  raw: data as Record<string, unknown>
                };
                
                // Add to cache
                cache.records.set(globalId, record);
                cache.elements.push(element);
                
                // Update modelLocalIds
                const localIds = cache.modelLocalIds.get(item.modelId) || [];
                localIds.push(item.localId);
                cache.modelLocalIds.set(item.modelId, localIds);
                
                console.log(`📦 [addToCache] Added ${globalId} to cache (model: ${item.modelId}, localId: ${item.localId})`);
                found = true;
                break;
              }
            }
          } catch (error) {
            console.debug(`📦 [addToCache] Error checking selection item:`, error);
          }
        }
        
        if (!found) {
          console.warn(`📦 [addToCache] Could not find ${globalId} in selection`);
        }
      }
      
      console.log(`📦 [addToCache] Cache now has ${cache.records.size} elements`);
    },
    color: async (globalIds, rgba) => {
      if (!globalIds.length) return;
      const highlighter = highlighterRef.current;
      const fragments = fragmentsRef.current;
      const world = worldRef.current;
      if (!highlighter || !fragmentsReadyRef.current || !fragments || !world) return;
      
      console.log(`🎨 [color] Called with ${globalIds.length} GlobalIds, rgba:`, rgba);
      
      let grouped: Map<string, number[]>;
      let cache;
      try {
        console.log(`🎨 [color] Calling groupLocalIdsByModel...`);
        const result = await groupLocalIdsByModel(globalIds);
        grouped = result.grouped;
        cache = result.cache;
        console.log(`🎨 [color] groupLocalIdsByModel returned ${grouped.size} models`);
      } catch (error) {
        console.error(`🎨 [color] groupLocalIdsByModel failed:`, error);
        return;
      }
      
      const color = new THREE.Color(rgba.r, rgba.g, rgba.b);
      const colorHex = color.getHex();
      
      console.log(`🎨 [color] Grouped into ${grouped.size} models, colorHex: ${colorHex.toString(16)}`);
      
      // Store original colors so we can restore them later
      if (!idsOriginalColorsRef.current) {
        idsOriginalColorsRef.current = new Map();
      }
      
      for (const [modelId, localIds] of grouped) {
        const model = fragments.list.get(modelId);
        if (!model || !localIds.length) continue;
        
        console.log(`🎨 [color] Processing model ${modelId} with ${localIds.length} localIds`);
        
        try {
          const ids = Array.from(localIds);
          
          // Try the deprecated add method first (most reliable)
          if (typeof highlighter.add === 'function') {
            try {
              console.log(`🎨 [color] Trying highlighter.add with colorHex: ${colorHex.toString(16)}`);
              highlighter.add(model, ids, colorHex);
              console.log(`✅ Successfully colored ${ids.length} elements in model ${modelId} using add method`);
              
              // Force a render update
              if (world && typeof world.update === 'function') {
                try {
                  world.update();
                  console.log('🎨 [color] Forced world update');
                } catch (updateError) {
                  console.debug('World update failed:', updateError);
                }
              }
              
              continue;
            } catch (e) {
              console.debug('add failed:', e);
            }
          }
          
          // Try highlightById (lowercase 'd')
          if (typeof highlighter.highlightById === 'function') {
            try {
              console.log(`🎨 [color] Trying highlightById...`);
              await highlighter.highlightById(model, ids, colorHex);
              console.log(`✅ Successfully colored ${ids.length} elements in model ${modelId} using highlightById`);
              continue;
            } catch (e) {
              console.debug('highlightById failed:', e);
            }
          }
          
          // Try highlightByID (uppercase 'ID')
          if (typeof highlighter.highlightByID === 'function') {
            try {
              console.log(`🎨 [color] Trying highlightByID...`);
              await highlighter.highlightByID(model, ids, colorHex);
              console.log(`✅ Successfully colored ${ids.length} elements in model ${modelId} using highlightByID`);
              continue;
            } catch (e) {
              console.debug('highlightByID failed:', e);
            }
          }
          
          // Try the new styles.set() API (replaces deprecated add method)
          if (highlighter.styles && typeof highlighter.styles.set === 'function') {
            try {
              // Skip if no IDs to highlight
              if (!ids || ids.length === 0) {
                console.debug(`Skipping highlight for model ${modelId} - no IDs`);
                continue;
              }
              
              // Create a style name for this color
              const styleName = `ids-color-${colorHex.toString(16).padStart(6, '0')}`;
              
              // Set the style for these IDs
              highlighter.styles.set(styleName, {
                color: color,
                fillOpacity: 1
              });
              
              // Create the selection first if it doesn't exist
              if (typeof highlighter.create === 'function') {
                try {
                  // Create a selection for this style if it doesn't exist
                  if (!highlighter.list || !highlighter.list.has(styleName)) {
                    highlighter.create(styleName);
                  }
                } catch (createError) {
                  console.debug('highlighter.create failed:', createError);
                }
              }
              
              // Apply the style to the model and IDs
              if (typeof highlighter.select === 'function') {
                try {
                  highlighter.select(model, ids, styleName);
                } catch (selectError) {
                  console.debug('highlighter.select failed:', selectError);
                  throw selectError; // Re-throw to try next method
                }
              }
              
              console.log(`✅ Successfully colored ${ids.length} elements in model ${modelId} using styles.set`);
              continue;
            } catch (e) {
              console.debug('styles.set failed:', e);
            }
          }
          
          console.warn(`❌ Could not color model ${modelId} - all highlighter methods failed`);
        } catch (error) {
          console.error(`Failed to color model ${modelId}:`, error);
          // Continue with other models even if one fails
        }
      }
    },
    clearColors: async () => {
      const highlighter = highlighterRef.current;
      const fragments = fragmentsRef.current;
      
      if (!fragmentsReadyRef.current) return;
      
      // Restore original material properties (clear ghost effect)
      if (fragments && ghostOriginalMaterialsRef.current && ghostOriginalMaterialsRef.current.size > 0) {
        try {
          for (const [material, originalProps] of ghostOriginalMaterialsRef.current) {
            const { color, transparent, opacity } = originalProps;
            material.transparent = transparent;
            material.opacity = opacity;
            if (color !== undefined) {
              if ('color' in material) {
                material.color.setHex(color);
              } else if ('lodColor' in material) {
                material.lodColor.setHex(color);
              }
            }
            material.needsUpdate = true;
          }
          ghostOriginalMaterialsRef.current.clear();
          console.log('Restored original material properties');
        } catch (error) {
          console.warn('Failed to restore original materials', error);
        }
      }
      
      // Clear using highlighter - this will remove all highlights
      try {
        if (highlighter) {
          // Clear any ghost styles first
          if (highlighter.styles && typeof highlighter.styles.delete === 'function') {
            try {
              highlighter.styles.delete('ghost');
              console.log('Cleared ghost styles');
            } catch (error) {
              console.warn('Failed to clear ghost styles', error);
            }
          }
          
          // Try the new clear API first
          if (typeof highlighter.clear === 'function') {
            await Promise.resolve(highlighter.clear());
            console.log('Cleared highlighter colors using clear()');
          }
          
          // Also clear any styles we created
          if (highlighter.styles && typeof highlighter.styles.clear === 'function') {
            highlighter.styles.clear();
            console.log('Cleared highlighter styles');
          }
        }
      } catch (error) {
        console.warn('Failed to clear IDS highlights', error);
      }
      
      // Clear the stored original colors map
      if (idsOriginalColorsRef.current) {
        idsOriginalColorsRef.current.clear();
      }
      
      // Clear instance highlight
      try {
        const prev = prevInstanceHighlightRef.current;
        if (prev && prev.mesh && prev.mesh.instanceColor) {
          const white = new THREE.Color(1, 1, 1);
          prev.mesh.setColorAt(prev.index, white);
          prev.mesh.instanceColor.needsUpdate = true;
        }
      } catch (error) {
        console.warn('Failed to reset instanced mesh highlight', error);
      }
      prevInstanceHighlightRef.current = null;
    },
    isolate: async (globalIds) => {
      const hider = hiderRef.current;
      const fragments = fragmentsRef.current;
      if (!hider || !fragments || !fragmentsReadyRef.current) return;
      
      await Promise.resolve(hider.set(true));
      
      if (!globalIds.length || !fragmentsReadyRef.current) return;
      
      const { grouped } = await groupLocalIdsByModel(globalIds);
      
      if (grouped.size === 0) {
        console.warn('isolate: No elements found in cache for isolation');
        return;
      }
      
      const keepMap = new Map<string, Set<number>>();
      grouped.forEach((localIds, modelId) => {
        keepMap.set(modelId, new Set(localIds));
      });
      
      const hideMap: Record<string, Set<number>> = {};
      for (const [modelId, keepSet] of keepMap.entries()) {
        const model = fragments.list.get(modelId);
        if (!model) continue;
        
        try {
          let allLocalIds: number[] = [];
          const fetched = await model.getLocalIds();
          if (Array.isArray(fetched)) {
            allLocalIds = fetched;
          } else if (fetched && typeof (fetched as any)[Symbol.iterator] === 'function') {
            allLocalIds = Array.from(fetched as Iterable<number>);
          }
          
          const toHide = allLocalIds.filter((localId) => !keepSet.has(localId));
          if (toHide.length > 0) {
            hideMap[modelId] = new Set(toHide);
          }
        } catch (error) {
          console.error('isolate: Failed to get local IDs for model', modelId, error);
        }
      }
      
      if (Object.keys(hideMap).length > 0) {
        await Promise.resolve(hider.set(false, hideMap));
      }
    },
    clearIsolation: async () => {
      const hider = hiderRef.current;
      if (!hider) return;
      await Promise.resolve(hider.set(true));
    },
    ghost: async (globalIds) => {
      // Ghost mode: Since transparency doesn't work and highlighter.add() is deprecated,
      // we'll just color the matching elements using the color API
      console.log(`[ghost] Applying ghost mode by coloring ${globalIds.length} matching elements`);
      
      const fragments = fragmentsRef.current;
      const world = worldRef.current;
      if (!fragments || !fragmentsReadyRef.current || !world) {
        console.warn('[ghost] Fragments or world not ready');
        return;
      }
      
      // Group by model
      const { grouped } = await groupLocalIdsByModel(globalIds);
      if (grouped.size === 0) {
        console.warn('[ghost] No elements found');
        return;
      }
      
      // Get all materials and make them semi-transparent (ghost the whole model)
      const allMaterials = [...(fragments as any).core.models.materials.list.values()];
      console.log(`[ghost] Found ${allMaterials.length} materials to ghost`);
      
      // Save original material properties
      if (!ghostOriginalMaterialsRef.current) {
        ghostOriginalMaterialsRef.current = new Map();
      }
      
      // Ghost ALL materials
      for (const material of allMaterials) {
        if (material.userData?.customId) continue;
        
        // Save original if not saved
        if (!ghostOriginalMaterialsRef.current.has(material)) {
          let color: number | undefined;
          if ('color' in material) {
            color = material.color.getHex();
          } else if ('lodColor' in material) {
            color = material.lodColor.getHex();
          }
          
          ghostOriginalMaterialsRef.current.set(material, {
            color,
            transparent: material.transparent,
            opacity: material.opacity,
          });
        }
        
        // Make semi-transparent
        material.transparent = true;
        material.opacity = 0.15;
        material.needsUpdate = true;
      }
      
      console.log(`[ghost] Ghosted ${allMaterials.length} materials`);
      
      // Now color the matching elements in bright cyan using highlighter.add directly (deprecated but works)
      const highlighter = highlighterRef.current;
      if (!highlighter) {
        console.warn('[ghost] Highlighter not available');
        world.update();
        return;
      }
      
      const cyan = new THREE.Color(0, 1, 1);
      const cyanHex = cyan.getHex();
      
      let coloredCount = 0;
      for (const [modelId, localIds] of grouped.entries()) {
        const model = fragments.list.get(modelId);
        if (!model) continue;
        
        try {
          // Use add (even though deprecated) because it actually works
          if (typeof highlighter.add === 'function') {
            highlighter.add(model, Array.from(localIds), cyanHex);
            coloredCount += localIds.length;
            console.log(`[ghost] Colored ${localIds.length} elements in model ${modelId}`);
          }
        } catch (error) {
          console.error(`[ghost] Failed to color elements in model ${modelId}:`, error);
        }
      }
      
      // Force update
      world.update();
      
      console.log(`[ghost] Complete: ghosted ${allMaterials.length} materials, colored ${coloredCount} matching elements in cyan`);
    },
    // On-demand property loading (ThatOpen pattern)
    getItemsData: async (globalIds: string[], config?: any) => {
      console.log('🔍 [getItemsData] START', { globalIds: globalIds.length, config });
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.error('🔍 [getItemsData] Fragments not available');
        return [];
      }
      
      // Group by model
      const { grouped } = await groupLocalIdsByModel(globalIds);
      const results: any[] = [];
      
      for (const [modelId, localIds] of grouped.entries()) {
        const model = fragments.list.get(modelId);
        if (!model) continue;
        
        try {
          // Fetch data with ThatOpen config pattern
          const data = await model.getItemsData(Array.from(localIds), config);
          results.push(...data);
        } catch (error) {
          console.error(`🔍 [getItemsData] Failed for model ${modelId}`, error);
        }
      }
      
      console.log('✅ [getItemsData] Complete:', results.length, 'items');
      return results;
    },
    getItemsByCategory: async (categories: RegExp[]) => {
      console.log('🔍 [getItemsByCategory] START', { categories: categories.length });
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.error('🔍 [getItemsByCategory] Fragments not available');
        return {};
      }
      
      const result: Record<string, number[]> = {};
      
      for (const [modelId, model] of fragments.list) {
        try {
          const items = await model.getItemsOfCategories(categories);
          if (items && Object.keys(items).length > 0) {
            // Flatten and deduplicate
            const localIds = Object.values(items).flat();
            if (localIds.length > 0) {
              result[modelId] = localIds;
            }
          }
        } catch (error) {
          console.error(`🔍 [getItemsByCategory] Failed for model ${modelId}`, error);
        }
      }
      
      console.log('✅ [getItemsByCategory] Complete:', Object.keys(result).length, 'models');
      return result;
    },
    getItemsDataByModel: async (modelId: string, localIds: number[], config?: any) => {
      console.log('🔍 [getItemsDataByModel] START', { modelId, localIds: localIds.length, config });
      const fragments = fragmentsRef.current;
      if (!fragments) {
        console.error('🔍 [getItemsDataByModel] Fragments not available');
        return [];
      }
      
      const model = fragments.list.get(modelId);
      if (!model) {
        console.error(`🔍 [getItemsDataByModel] Model ${modelId} not found`);
        return [];
      }
      
      try {
        const data = await model.getItemsData(localIds, config);
        console.log('✅ [getItemsDataByModel] Complete:', data.length, 'items');
        return data as any; // Fragment's ItemData is compatible with our ItemData type
      } catch (error) {
        console.error(`🔍 [getItemsDataByModel] Failed for model ${modelId}`, error);
        return [];
      }
    },
    fitViewTo: async (globalIds) => {
      if (!globalIds.length) return;
      const world = worldRef.current;
      const fragments = fragmentsRef.current;
      if (!world || !fragments || !fragmentsReadyRef.current) return;
      const camera = world.camera ?? null;
      const controls = camera?.controls ?? null;
      const threeCamera = camera?.three ?? null;
      
      const { grouped } = await groupLocalIdsByModel(globalIds);
      
      const boundingBox = new THREE.Box3();
      let hasBox = false;
      
      for (const [modelId, localIds] of grouped.entries()) {
        const model = fragments.list.get(modelId);
        if (!model || !model.object) continue;
        
        const modelBox = new THREE.Box3().setFromObject(model.object);
        
        if (!modelBox.isEmpty()) {
          if (!hasBox) {
            boundingBox.copy(modelBox);
            hasBox = true;
          } else {
            boundingBox.union(modelBox);
          }
        }
      }
      
      if (!hasBox) return;
      
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      boundingBox.getCenter(center);
      boundingBox.getSize(size);
      
      const maxDim = Math.max(size.x, size.y, size.z) || 10;
      const dist = maxDim * 1.5;
      
      if (controls) {
        controls.setLookAt(center.x + dist, center.y + dist, center.z + dist, center.x, center.y, center.z, true);
      } else if (threeCamera) {
        threeCamera.position.set(center.x + dist, center.y + dist, center.z + dist);
        threeCamera.lookAt(center);
      }
    },
  }), [groupLocalIdsByModel]); // ensureIdsCache removed - no longer needed!

  viewerApiRef.current = viewerApi;

  const openIdsPanel = useCallback(() => {
    setIsIdsOpen(true);
    setIdsExpandSignal((value) => value + 1);
  }, []);

  const closeIdsPanel = useCallback(() => {
    setIsIdsOpen(false);
    const api = viewerApiRef.current;
    if (!api) return;
    Promise.resolve(api.clearColors()).catch(() => {});
    if (api.clearIsolation) {
      Promise.resolve(api.clearIsolation()).catch(() => {});
    }
  }, []);

  const toggleIdsPanel = useCallback(() => {
    setIsIdsOpen((prev) => {
      const next = !prev;
      if (next) {
        setIdsExpandSignal((value) => value + 1);
      }
      return next;
    });
  }, []);

  const handleValidateFromCreator = useCallback(async (idsXml: string) => {
    try {
      // Set the XML in the IDS store
      const { setIdsXmlText, runCheck } = await import('./ids/ids.store').then(m => m.idsStore);
      setIdsXmlText(idsXml);
      
      // Open the IDS Checker panel
      setIsIdsOpen(true);
      setIdsExpandSignal((value) => value + 1);
      
      // Run the validation after a short delay to ensure the panel is open
      setTimeout(async () => {
        if (viewerApiRef.current) {
          await runCheck(viewerApiRef.current);
        }
      }, 100);
    } catch (error) {
      console.error('Failed to validate from IDS Creator:', error);
      alert('Error: Could not run validation. See console for details.');
    }
  }, []);

  useEffect(() => {
    selectedRef.current = selectedItems;
  }, [selectedItems]);

  useEffect(() => {
    idsCacheRef.current = null;
    idsCachePromiseRef.current = null;
    try {
      idsStore.invalidateCaches();
    } catch (error) {
      console.warn('Failed to invalidate IDS caches', error);
    }
  }, [models]);


  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    let disposed = false;

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
    
    // Performance optimizations
    const threeRenderer = world.renderer.three;
    threeRenderer.shadowMap.enabled = false; // Disable shadows for better performance
    // Enable LOD (Level of Detail) for better performance with large models
    threeRenderer.sortObjects = false; // Faster rendering, less CPU overhead
    
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.camera.controls?.setLookAt(10, 10, 10, 0, 0, 0);
    world.camera.three.near = 0.1;
    world.camera.three.far = 1e9;
    world.camera.three.updateProjectionMatrix();
    
    // Configure camera controls: middle mouse button for pan, wheel scroll for zoom
    const cameraControls = world.camera.controls;
    if (cameraControls) {
      // Store reference for later modification
      cameraControlsRef.current = cameraControls;
      
      // Camera-controls library uses mouseButtons property to configure interactions
      if ('mouseButtons' in cameraControls) {
        (cameraControls as any).mouseButtons = {
          left: 1,    // ROTATE (orbit) - left mouse button
          middle: 2,  // TRUCK (pan) - middle mouse button (wheel click)
          right: 0,   // NONE - disable right click drag (we use it for context menu)
          wheel: 16,   // DOLLY (zoom) - mouse wheel scroll (default zoom behavior)
        };
      }
      // Adjust zoom speed for better control
      if ('dollySpeed' in cameraControls) {
        (cameraControls as any).dollySpeed = 1.0;
      }
    }

    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    world.scene.three.add(ambient);

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

    let detachHighlighterListeners: (() => void) | null = null;

    const highlightHandler = async (modelIdMap: Record<string, Set<number>>) => {
      if (!fragmentsReadyRef.current) {
        return;
      }
      const selections: Selection[] = [];
      for (const [modelId, ids] of Object.entries(modelIdMap)) {
        ids.forEach((id) => {
          if (Number.isInteger(id)) {
            selections.push({ modelId, localId: id });
          }
        });
      }
      const prevSelections = selectedRef.current;
      const selectionChanged = !selectionsMatch(selections, prevSelections);

      if (!selectionChanged) {
        return;
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
  const [data] = await model.getItemsData([primary.localId], FRAGMENTS_ITEM_DATA_OPTIONS);
        updateSelectedProperties(data || null);
      } catch (error) {
        console.warn('Failed to fetch properties for selection', error);
      }
    };

    const clearHandler = () => {
      setSelectedItems([]);
      updateSelectedProperties(null);
    };

    const init = async () => {
      try {
        await Promise.resolve(components.init());
      } catch (error) {
        console.error('Failed to initialize viewer components', error);
        return;
      }

      if (disposed) return;

      try {
        components.get(OBC.Grids).create(world);
      } catch (error) {
        console.warn('Failed to create grid component', error);
      }

      const fetched = await fetch('https://thatopen.github.io/engine_fragment/resources/worker.mjs');
      const blob = await fetched.blob();
      const workerUrl = URL.createObjectURL(new File([blob], 'worker.mjs', { type: 'text/javascript' }));
      workerUrlRef.current = workerUrl;

      const fragments = components.get(OBC.FragmentsManager);
      await fragments.init(workerUrl);
      fragmentsRef.current = fragments;
      fragmentsReadyRef.current = true;

      const highlighter = components.get(OBCF.Highlighter);
      highlighter.setup({ world });
      highlighter.zoomToSelection = true;
      
      // Ensure default "select" style exists to prevent "Selection select does not exist" error
      try {
        if (typeof (highlighter as any).create === 'function') {
          (highlighter as any).create('select');
        }
      } catch (error) {
        // Ignore if select already exists
      }
      
      highlighterRef.current = highlighter;

      const hider = components.get(OBC.Hider);
      hiderRef.current = hider;

      // Initialize measurement tool
      try {
        const measurementTool = components.get(OBCF.LengthMeasurement);
        measurementTool.world = world;
        
        // Setup color and other properties
        measurementTool.color = new THREE.Color('#ff0000'); // Red for better visibility
        
        // Setup snapDistance for better usability
        if ('snapDistance' in measurementTool) {
          (measurementTool as any).snapDistance = 0.5;
        }
        
        // Enable snap preview to show where measurements will snap
        if ('preview' in measurementTool) {
          const preview = (measurementTool as any).preview;
          if (preview) {
            preview.enabled = true;
            // Make the preview marker more visible
            if (preview.color) {
              preview.color = new THREE.Color('#00ff00'); // Green for snap preview
            }
          }
        }
        
        // Try to configure the workingPlane for better visibility
        if ('workingPlane' in measurementTool) {
          const workingPlane = (measurementTool as any).workingPlane;
          if (workingPlane && typeof workingPlane === 'object') {
            workingPlane.visible = true;
          }
        }
        
        // Listen for measurement creation to log distance and update display
        if ((measurementTool as any).list?.onItemAdded) {
          (measurementTool as any).list.onItemAdded.add((line: any) => {
            const distance = line.value || line.distance?.() || 0;
            console.log(`✅ Measurement created: ${distance.toFixed(3)} units`);
            
            // Update the displayed measurement value
            setLastMeasurementValue(distance.toFixed(3));
            
            // Try to make the dimension more visible
            if (line.dimensionLabel) {
              line.dimensionLabel.visible = true;
            }
          });
        }
        
        // Start disabled - will enable when user clicks the button
        measurementTool.enabled = false;
        
        measurementToolRef.current = measurementTool;
        console.log('✅ Measurement tool initialized:', measurementTool);
        console.log('Measurement tool properties:', Object.keys(measurementTool));
      } catch (error) {
        console.error('Failed to initialize measurement tool:', error);
      }

      highlighter.events.select.onHighlight.add(highlightHandler);
      highlighter.events.select.onClear.add(clearHandler);
      detachHighlighterListeners = () => {
        highlighter.events.select.onHighlight.remove?.(highlightHandler);
        highlighter.events.select.onClear.remove?.(clearHandler);
      };

  getWorldCamera()?.controls?.addEventListener('rest', () => fragments.core.update(true));

      try {
        const fragsModule = await import('@thatopen/fragments');
        const IfcImporter = fragsModule.IfcImporter;
        const ifcImporter = new IfcImporter();
        const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
        ifcImporter.wasm = {
          path: `${baseUrl}web-ifc/`,
          absolute: true,
        };
        ifcImporterRef.current = ifcImporter;
      } catch (err) {
        console.warn('Failed to lazy-load FRAGS.IfcImporter:', err);
      }

      if (!disposed) {
        setComponentsReady(true);
      }
    };
    init().catch((error) => {
      console.error('Failed to initialize viewer fragments', error);
    });

    return () => {
      disposed = true;
      (async () => {
        const wasReady = fragmentsReadyRef.current;
        fragmentsReadyRef.current = false;
        detachHighlighterListeners?.();
        detachHighlighterListeners = null;

        try {
          if (wasReady) {
            await hiderRef.current?.set?.(true);
          }
        } catch {}
        if (fragmentsRef.current) {
          const ids = [...fragmentsRef.current.list.keys()];
          await Promise.all(ids.map((id) => fragmentsRef.current!.core.disposeModel(id)));
        }
        try {
          if (wasReady) {
            highlighterRef.current?.clear?.();
          }
        } catch {}
  if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
  try { components.dispose(); } catch {}
  try { container.replaceChildren(); } catch { /* no-op */ }
        highlighterRef.current = null;
        hiderRef.current = null;
      })();
    };
  }, []);

  useEffect(() => {
    if (!componentsReady) return;
    const components = componentsRef.current;
    const fragments = fragmentsRef.current;
    if (!components || !fragments) return;

    const signature = modelsSignature;

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
      const needsUpdate = !modelsListElementRef.current.dataset.initialized || signature !== lastModelsSignatureRef.current;
      if (needsUpdate) {
        updateModelsListRef.current?.({ components });
      }
      if (!modelsListElementRef.current.dataset.initialized) {
        modelsListElementRef.current.dataset.initialized = 'true';
        modelsListElementRef.current.style.width = '100%';
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

    lastModelsSignatureRef.current = signature;
  }, [componentsReady, isExplorerOpen, modelTreeSearch, modelsSignature]);

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
  }, [componentsReady, modelsSignature]);

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

    const camera = getWorldCamera();
    const threeCamera = camera?.three ?? null;
    const cameraControls = camera?.controls ?? null;

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
      if (threeCamera) {
        model.useCamera(threeCamera);
      } else {
        console.warn('World camera not ready; skipping model camera binding.');
      }
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
        if (cameraControls) {
          await cameraControls.fitToBox(model.object, true);
        }
      } catch {
        // Fallback: basic look-at if fitToBox isn't available
        const size = new THREE.Vector3(); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const dist = maxDim * 2.5;
        if (cameraControls) {
          cameraControls.setLookAt(center.x + dist, center.y + dist, center.z + dist, center.x, center.y, center.z, true);
        } else if (threeCamera) {
          threeCamera.position.set(center.x + dist, center.y + dist, center.z + dist);
          threeCamera.lookAt(center);
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

  const modelsSectionMaxHeight = useMemo(
    () => Math.min(360, Math.max(180, explorerSize.height * 0.45)),
    [explorerSize.height]
  );

  const openDetailSectionCount = Number(!isSelectionPropertiesCollapsed) + Number(!isModelTreeCollapsed);
  const isModelsSectionFlexible = !isModelsSectionCollapsed && openDetailSectionCount === 0;

  useEffect(() => {
    const element = modelsListElementRef.current;
    if (!element) return;
    element.style.width = '100%';
    element.style.maxHeight = isModelsSectionFlexible ? '100%' : `${modelsSectionMaxHeight}px`;
    element.style.height = isModelsSectionFlexible ? '100%' : 'auto';
  }, [isModelsSectionFlexible, modelsSectionMaxHeight, modelsSignature]);

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
    if (!fragmentsReadyRef.current) {
      console.warn('AI selection requested before fragments were fully initialized.');
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
          batch = await model.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
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
  const [data] = await primary.model.getItemsData([firstId], FRAGMENTS_ITEM_DATA_OPTIONS);
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
                const [data] = await model.getItemsData([selection.localId], FRAGMENTS_ITEM_DATA_OPTIONS);
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
                batch = await record.getItemsData(chunk, FRAGMENTS_ITEM_DATA_OPTIONS);
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
    if (!world || !fragments || !id || !fragmentsReadyRef.current) return;
    const record = fragments.list.get(id);
    if (!record) return;

    // Ensure updates
    await fragments.core.update(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const obj = record.object;
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) {
      const camera = getWorldCamera();
      const controls = camera?.controls ?? null;
      const threeCamera = camera?.three ?? null;
      try {
        if (controls) {
          await controls.fitToBox(obj, true);
        }
      } catch (e) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const dist = maxDim * 2.5;
        if (controls) {
          controls.setLookAt(center.x + dist, center.y + dist, center.z + dist, center.x, center.y, center.z, true);
        } else if (threeCamera) {
          threeCamera.position.set(center.x + dist, center.y + dist, center.z + dist);
          threeCamera.lookAt(center);
        }
      }
    }
  }, []);

  const hideSelected = useCallback(async () => {
    const selection = selectedRef.current;
    const hider = hiderRef.current;
    if (!selection || selection.length === 0 || !hider || !fragmentsReadyRef.current) {
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
    if (!hider || !fragmentsReadyRef.current) {
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
    
    // Debounce to improve responsiveness - prevent multiple rapid picks
    let pickTimeout: ReturnType<typeof setTimeout> | null = null;
    
    const performRectangleSelection = async (left: number, top: number, right: number, bottom: number) => {
      console.log('🔷 Rectangle Selection Started (viewport coords)', { left, top, right, bottom });
      
      const fr = fragmentsRef.current;
      if (!fr) {
        console.warn('❌ No fragments manager');
        return;
      }
      
      console.log('📦 Models available:', fr.list.size);
      
      const threeCamera = getThreeCamera();
      if (!threeCamera) {
        console.warn('Rectangle selection skipped: viewer camera not ready.');
        return;
      }
      
      const rect = dom.getBoundingClientRect();
      console.log('📏 Canvas bounds:', { 
        rectLeft: rect.left, 
        rectTop: rect.top, 
        rectWidth: rect.width, 
        rectHeight: rect.height 
      });
      
      const raycaster = new THREE.Raycaster();
      const selectedMap = new Map<string, Set<number>>();
      
      // Sample points within the rectangle (grid sampling)
      const sampleSize = 10; // Sample every 10 pixels
      const width = right - left;
      const height = bottom - top;
      
      console.log('📐 Rectangle size:', { width, height, sampleSize });
      
      // If rectangle is too small, treat as click
      if (width < 3 || height < 3) {
        console.log('⚠️ Rectangle too small, using click selection');
        await pickAt((left + right) / 2, (top + bottom) / 2);
        return;
      }
      
      let samplePoints = 0;
      let hitCount = 0;
      
      // Debug: Log the first sample point for comparison with click
      let firstSample = true;
      
      for (let x = left; x <= right; x += sampleSize) {
        for (let y = top; y <= bottom; y += sampleSize) {
          samplePoints++;
          
          // Convert screen coordinates to normalized device coordinates (NDC)
          const mouseX = ((x - rect.left) / rect.width) * 2 - 1;
          const mouseY = -((y - rect.top) / rect.height) * 2 + 1;
          
          // Update the shared mouse vector with NDC coordinates
          mouse.set(mouseX, mouseY);
          
          if (firstSample) {
            console.log('🔍 First sample point:', {
              screenCoords: { x, y },
              rectBounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
              mouseNDC: { x: mouseX, y: mouseY },
              mouseVector: mouse.clone()
            });
          }
          
          // Check intersection with all models using ThatOpen's raycast method
          for (const model of fr.list.values()) {
            try {
              // Create a new Vector2 for each raycast to avoid reference issues
              const mouseVec = new THREE.Vector2(mouseX, mouseY);
              
              // Debug: Log raycast params for first sample only
              if (firstSample) {
                console.log('🔬 Raycast params:', {
                  mouseVec: mouseVec.clone(),
                  cameraType: threeCamera.type,
                  domElement: dom?.tagName,
                  modelId: model.modelId
                });
              }
              
              // Use ThatOpen's built-in raycast
              const hit = await model.raycast({ 
                camera: threeCamera, 
                mouse: mouseVec,
                dom: dom
              });
              
              // Debug: Log result for first sample
              if (firstSample) {
                console.log('🔬 Raycast result:', {
                  hit: hit,
                  hasDistance: hit && typeof hit.distance === 'number',
                  hitType: typeof hit
                });
              }
              
              if (hit && typeof hit.distance === 'number') {
                hitCount++;
                const localId = (hit as any).localId;
                
                console.log('🎯 Hit found:', { 
                  point: { x, y }, 
                  mouseNDC: { x: mouseX, y: mouseY },
                  localId, 
                  distance: hit.distance,
                  modelId: model.modelId 
                });
                
                if (localId !== undefined && localId !== null && Number.isInteger(localId)) {
                  if (!selectedMap.has(model.modelId)) {
                    selectedMap.set(model.modelId, new Set());
                  }
                  selectedMap.get(model.modelId)!.add(localId);
                }
              }
            } catch (error) {
              // Skip objects that cause raycasting errors
              if (firstSample) {
                console.warn('❌ Raycast error on first sample:', error);
              }
              console.debug('Skipping model due to raycast error:', error);
            }
          }
          
          // Mark that we've processed the first sample
          if (firstSample) {
            firstSample = false;
          }
        }
      }
      
      console.log('📊 Sampling complete:', { samplePoints, hitCount, uniqueObjects: selectedMap.size });
      
      // Convert to Selection array
      const selections: Selection[] = [];
      for (const [modelId, ids] of selectedMap.entries()) {
        for (const localId of ids) {
          selections.push({ modelId, localId });
        }
      }
      
      console.log('✅ Rectangle Selection Result:', {
        totalSelected: selections.length,
        byModel: Array.from(selectedMap.entries()).map(([modelId, ids]) => ({
          modelId,
          count: ids.size
        }))
      });
      
      if (selections.length === 0) {
        console.warn('⚠️ No objects found in rectangle');
        // No selection
        setSelectedItems([]);
        updateSelectedProperties(null);
        return;
      }
      
      // Update selection
      const prevSelections = selectedRef.current;
      const selectionChanged = !selectionsMatch(selections, prevSelections);
      
      if (!selectionChanged) {
        console.log('ℹ️ Selection unchanged');
        return;
      }
      
      console.log('🔄 Updating selection with', selections.length, 'objects');
      setSelectedItems(selections);
      handleExplorerOpen();
      
      // Update properties for first selected item
      if (selections.length > 0) {
        const primary = selections[0];
        const model = fr.list.get(primary.modelId);
        if (model) {
          try {
            const [data] = await model.getItemsData([primary.localId], FRAGMENTS_ITEM_DATA_OPTIONS);
            updateSelectedProperties(data || null);
          } catch (error) {
            console.warn('Failed to fetch properties for rectangle selection', error);
          }
        }
      }
    };
    
    const pickAt = async (clientX: number, clientY: number) => {
      const fr = fragmentsRef.current; if (!fr) return;
      const threeCamera = getThreeCamera();
      if (!threeCamera) {
        console.warn('Picking skipped: viewer camera not ready.');
        return;
      }
      const rect = dom.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      
      console.log('🖱️ Click selection:', {
        viewport: { x: clientX, y: clientY },
        canvasBounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        mouseNDC: { x: mouse.x, y: mouse.y }
      });
      let best: { dist: number; model: any; localId: number; point?: THREE.Vector3; object?: any; instanceId?: number } | null = null;
      const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, threeCamera);
    
    // Use Open Company's built-in raycasting for better performance
    for (const model of fr.list.values()) {
      try {
        const hit = await model.raycast({ camera: threeCamera, mouse, dom: world.renderer!.three.domElement! });
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
      } catch (error) {
        // Skip models that cause raycasting errors
        console.debug('Skipping model due to raycast error:', error);
      }
    }
      if (!best) return;
      
      // Always use Open Company's Highlighter API for consistent, performant highlighting
      const hl = highlighterRef.current;
      if (hl) {
        try {
          // Clear previous highlight
          if (typeof hl.clear === 'function') {
            hl.clear();
          }
          
          // Apply new highlight using the most compatible method
          const colorHex = 0x66ccff;
          if (typeof hl.highlightByID === 'function') {
            // Newer API
            await hl.highlightByID(best.model.uuid, [best.localId], colorHex);
          } else if (typeof hl.add === 'function') {
            // Alternative API
            hl.add(best.model.uuid, [best.localId]);
          } else if (typeof hl.highlight === 'function') {
            // Fallback API
            await hl.highlight(best.model, [best.localId], colorHex);
          }
        } catch (err) {
          console.warn('Highlighter failed, using fallback:', err);
          // Fallback: manual instance coloring
          try {
            const obj: any = best.object;
            const idx: any = best.instanceId;
            if (obj && obj.isInstancedMesh && Number.isInteger(idx)) {
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
        const cameraForFacing = getThreeCamera();
        if (cameraForFacing) {
          ringMesh.lookAt(cameraForFacing.position);
        }
        marker.visible = true;
      } catch { /* non-fatal */ }

      const prevSelections = selectedRef.current;
      const newSelection = [{ modelId: best.model.modelId, localId: best.localId }];
      if (!selectionsMatch(newSelection, prevSelections)) {
        setSelectedItems(newSelection);
        handleExplorerOpen();
        try {
          const [data] = await best.model.getItemsData([best.localId], FRAGMENTS_ITEM_DATA_OPTIONS);
          updateSelectedProperties(data || null);
        } catch {}
      }
    };
    
    // Debounced pick handler for better responsiveness
    const debouncedPickAt = (clientX: number, clientY: number) => {
      if (pickTimeout) {
        clearTimeout(pickTimeout);
      }
      pickTimeout = setTimeout(() => {
        pickAt(clientX, clientY);
      }, 50); // 50ms debounce - responsive but not excessive
    };
    
    const onPointerDown = async (ev: PointerEvent) => {
      setContextMenu(null);
      if (ev.button !== 0) return; // left button only
      
      console.log('👆 PointerDown:', { 
        mode: selectionModeRef.current, 
        measuring: isMeasuringRef.current,
        x: ev.clientX, 
        y: ev.clientY 
      });
      
      // Check selection mode
      if (selectionModeRef.current === 'rectangle' && !isMeasuringRef.current) {
        console.log('🟦 Starting rectangle selection');
        // Start rectangle selection
        isDrawingSelectionRef.current = true;
        selectionStartRef.current = { x: ev.clientX, y: ev.clientY };
        
        // Create or show selection box
        if (!selectionBoxRef.current) {
          const box = document.createElement('div');
          box.style.position = 'fixed';
          box.style.border = '2px solid #1976d2';
          box.style.backgroundColor = 'rgba(25, 118, 210, 0.1)';
          box.style.pointerEvents = 'none';
          box.style.zIndex = '10000';
          document.body.appendChild(box);
          selectionBoxRef.current = box;
        }
        
        const box = selectionBoxRef.current;
        box.style.left = `${ev.clientX}px`;
        box.style.top = `${ev.clientY}px`;
        box.style.width = '0px';
        box.style.height = '0px';
        box.style.display = 'block';
      } else {
        // Use immediate pick on click for responsiveness (click mode)
        await pickAt(ev.clientX, ev.clientY);
      }
    };
    
    const onPointerMove = (ev: PointerEvent) => {
      if (!isDrawingSelectionRef.current || !selectionStartRef.current || !selectionBoxRef.current) return;
      
      const start = selectionStartRef.current;
      const box = selectionBoxRef.current;
      
      const left = Math.min(ev.clientX, start.x);
      const top = Math.min(ev.clientY, start.y);
      const width = Math.abs(ev.clientX - start.x);
      const height = Math.abs(ev.clientY - start.y);
      
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    };
    
    const onPointerUp = async (ev: PointerEvent) => {
      console.log('👆 PointerUp:', { 
        drawing: isDrawingSelectionRef.current,
        x: ev.clientX, 
        y: ev.clientY 
      });
      
      if (isDrawingSelectionRef.current && selectionStartRef.current && selectionBoxRef.current) {
        console.log('🟦 Completing rectangle selection');
        // Complete rectangle selection
        const start = selectionStartRef.current;
        const box = selectionBoxRef.current;
        
        box.style.display = 'none';
        isDrawingSelectionRef.current = false;
        
        const left = Math.min(ev.clientX, start.x);
        const top = Math.min(ev.clientY, start.y);
        const right = Math.max(ev.clientX, start.x);
        const bottom = Math.max(ev.clientY, start.y);
        
        // Perform selection in rectangle
        await performRectangleSelection(left, top, right, bottom);
        
        selectionStartRef.current = null;
      }
    };
    
    const onClick = async (ev: MouseEvent) => {
      setContextMenu(null);
      
      // Always allow measurement tool events to pass through
      // Just skip our own selection logic when measuring
      if (!isMeasuringRef.current && selectionModeRef.current === 'click') {
        await pickAt(ev.clientX, ev.clientY);
      }
    };
    const onDoubleClick = () => {
      // According to That Open Company docs, double-click creates measurements
      if (isMeasuringRef.current) {
        const measurementTool = measurementToolRef.current;
        if (measurementTool && typeof measurementTool.create === 'function') {
          console.log('📏 Creating measurement point');
          measurementTool.create();
        }
      }
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
    // Keyboard handler for deleting measurements
    const onKeyDown = (event: KeyboardEvent) => {
      if (isMeasuringRef.current && (event.code === 'Delete' || event.code === 'Backspace')) {
        const measurementTool = measurementToolRef.current;
        if (measurementTool && typeof measurementTool.delete === 'function') {
          console.log('Deleting measurement under cursor');
          measurementTool.delete();
        }
      }
    };
    
    dom.addEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('click', onClick);
    dom.addEventListener('dblclick', onDoubleClick);
    dom.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    
    return () => {
      // Clear debounce timeout
      if (pickTimeout) {
        clearTimeout(pickTimeout);
      }
      
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('click', onClick);
      dom.removeEventListener('dblclick', onDoubleClick);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      
      // Cleanup selection box
      if (selectionBoxRef.current) {
        selectionBoxRef.current.remove();
        selectionBoxRef.current = null;
      }
      
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
    const camera = getWorldCamera();
    const controls = camera?.controls ?? null;
    const threeCamera = camera?.three ?? null;
    if (controls) {
      controls.reset(true);
    } else if (threeCamera) {
      threeCamera.position.set(10, 10, 10);
      threeCamera.lookAt(0, 0, 0);
    }
  }, []);

  const toggleClippingPlane = useCallback((axis: 'x' | 'y' | 'z') => {
    setClippingPlanes((prev) => {
      const newState = { ...prev, [axis]: !prev[axis] };
      
      // Update Three.js clipping planes
      const world = worldRef.current;
      if (!world) return newState;
      
      const renderer = world.renderer?.three;
      const scene = world.scene?.three;
      if (!renderer || !scene) return newState;
      
      const planes: THREE.Plane[] = [];
      const helpers = clippingHelpersRef.current;
      
      // Remove old helper if toggling off
      if (!newState[axis]) {
        const helper = helpers.get(axis);
        if (helper) {
          scene.remove(helper);
          helper.dispose();
          helpers.delete(axis);
        }
      }
      
      // Add planes and helpers for active axes
      if (newState.x) {
        const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), clippingPositions.x);
        planes.push(plane);
        if (!helpers.has('x')) {
          const helper = new THREE.PlaneHelper(plane, 10, 0xff0000);
          scene.add(helper);
          helpers.set('x', helper);
        }
      }
      if (newState.y) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), clippingPositions.y);
        planes.push(plane);
        if (!helpers.has('y')) {
          const helper = new THREE.PlaneHelper(plane, 10, 0x00ff00);
          scene.add(helper);
          helpers.set('y', helper);
        }
      }
      if (newState.z) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), clippingPositions.z);
        planes.push(plane);
        if (!helpers.has('z')) {
          const helper = new THREE.PlaneHelper(plane, 10, 0x0000ff);
          scene.add(helper);
          helpers.set('z', helper);
        }
      }
      
      renderer.clippingPlanes = planes;
      renderer.localClippingEnabled = planes.length > 0;
      clippingPlanesRef.current = planes;
      
      return newState;
    });
  }, [clippingPositions]);

  const updateClippingPosition = useCallback((axis: 'x' | 'y' | 'z', value: number) => {
    setClippingPositions((prev) => {
      const newPositions = { ...prev, [axis]: value };
      
      // Debounce the actual Three.js update for better performance during dragging
      const updateThreeJS = () => {
        const world = worldRef.current;
        if (!world) return;
        
        const renderer = world.renderer?.three;
        if (!renderer) return;
        
        const planes: THREE.Plane[] = [];
        const helpers = clippingHelpersRef.current;
        
        if (clippingPlanes.x) {
          const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), newPositions.x);
          planes.push(plane);
          const helper = helpers.get('x');
          if (helper) {
            helper.plane.constant = newPositions.x;
          }
        }
        if (clippingPlanes.y) {
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), newPositions.y);
          planes.push(plane);
          const helper = helpers.get('y');
          if (helper) {
            helper.plane.constant = newPositions.y;
          }
        }
        if (clippingPlanes.z) {
          const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), newPositions.z);
          planes.push(plane);
          const helper = helpers.get('z');
          if (helper) {
            helper.plane.constant = newPositions.z;
          }
        }
        
        renderer.clippingPlanes = planes;
        clippingPlanesRef.current = planes;
      };
      
      // Use requestAnimationFrame for smooth updates
      requestAnimationFrame(updateThreeJS);
      
      return newPositions;
    });
  }, [clippingPlanes]);

  const toggleClippingBox = useCallback(() => {
    setIsClippingBoxActive((prev) => {
      const newState = !prev;
      
      // For clipping box, we'd typically enable all three planes
      // This is a simplified implementation
      if (newState) {
        setClippingPlanes({ x: true, y: true, z: true });
      } else {
        setClippingPlanes({ x: false, y: false, z: false });
      }
      
      return newState;
    });
  }, []);

  const toggleMeasurement = useCallback(() => {
    console.log('🎯 toggleMeasurement called');
    setIsMeasuring((prev) => {
      const newState = !prev;
      isMeasuringRef.current = newState;
      
      const measurementTool = measurementToolRef.current;
      console.log('Measurement tool:', measurementTool);
      console.log('New state:', newState);
      
      if (measurementTool) {
        measurementTool.enabled = newState;
        console.log('Measurement tool enabled set to:', newState);
        console.log('Measurement tool world:', measurementTool.world);
        console.log('Measurement tool properties:', {
          enabled: measurementTool.enabled,
          world: !!measurementTool.world,
          // Check if it has the list of measurements
          list: (measurementTool as any).list?.size || 0
        });
        
        if (!newState) {
          try {
            // Clear all measurements when disabling
            if ((measurementTool as any).list && typeof (measurementTool as any).list.clear === 'function') {
              (measurementTool as any).list.clear();
              console.log('All measurements cleared');
            }
            // Clear the displayed measurement value
            setLastMeasurementValue(null);
          } catch (error) {
            console.warn('Failed to clear measurements:', error);
          }
        } else {
          console.log('📏 Measurement mode activated - DOUBLE-CLICK two points on the model to measure distance');
        }
      } else {
        console.warn('⚠️ Measurement tool not initialized!');
      }
      
      return newState;
    });
  }, []);

  const clearAllClipping = useCallback(() => {
    setClippingPlanes({ x: false, y: false, z: false });
    setClippingPositions({ x: 0, y: 0, z: 0 });
    setIsClippingBoxActive(false);
    
    const world = worldRef.current;
    if (world) {
      const renderer = world.renderer?.three;
      const scene = world.scene?.three;
      if (renderer) {
        renderer.clippingPlanes = [];
        renderer.localClippingEnabled = false;
      }
      
      // Remove all helpers
      if (scene) {
        const helpers = clippingHelpersRef.current;
        helpers.forEach((helper) => {
          scene.remove(helper);
          helper.dispose();
        });
        helpers.clear();
      }
    }
    clippingPlanesRef.current = [];
  }, []);

  const setCameraView = useCallback((view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso') => {
    console.log('setCameraView called with view:', view);
    const world = worldRef.current;
    const fragments = fragmentsRef.current;
    const id = currentModelIdRef.current;
    const camera = getWorldCamera();
    const threeCamera = camera?.three;
    
    console.log('Debug:', { hasWorld: !!world, hasFragments: !!fragments, id, hasCamera: !!camera, hasThreeCamera: !!threeCamera });
    
    if (!threeCamera || !world || !fragments || !id) {
      console.log('Early return: missing dependencies');
      return;
    }

    // Get the current model
    const record = fragments.list.get(id);
    console.log('Model record:', record);
    if (!record) {
      console.log('Early return: no record found for id:', id);
      return;
    }

    // Calculate bounding box from current model
    const bbox = new THREE.Box3().setFromObject(record.object);
    console.log('Bounding box:', bbox, 'isEmpty:', bbox.isEmpty());
    if (bbox.isEmpty()) {
      console.log('Early return: bounding box is empty');
      return;
    }

    // Get center and size
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);
    
    // Calculate distance based on model size (add 100% padding for better view)
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2 || 20; // Fallback to 20 if no models

    let position: THREE.Vector3;

    switch (view) {
      case 'top':
        position = new THREE.Vector3(center.x, center.y + distance, center.z);
        break;
      case 'bottom':
        position = new THREE.Vector3(center.x, center.y - distance, center.z);
        break;
      case 'front':
        position = new THREE.Vector3(center.x, center.y, center.z + distance);
        break;
      case 'back':
        position = new THREE.Vector3(center.x, center.y, center.z - distance);
        break;
      case 'left':
        position = new THREE.Vector3(center.x - distance, center.y, center.z);
        break;
      case 'right':
        position = new THREE.Vector3(center.x + distance, center.y, center.z);
        break;
      case 'iso':
        position = new THREE.Vector3(
          center.x + distance * 0.7,
          center.y + distance * 0.7,
          center.z + distance * 0.7
        );
        break;
      default:
        return;
    }

    // Use controls.setLookAt for smooth transition
    const controls = camera?.controls;
    if (controls && typeof controls.setLookAt === 'function') {
      // Use setLookAt with animation for smooth camera movement
      controls.setLookAt(
        position.x, position.y, position.z,
        center.x, center.y, center.z,
        true // enable transition
      );
      console.log('Camera moved to:', view, 'position:', position, 'looking at:', center);
    } else {
      // Fallback to direct camera manipulation
      threeCamera.position.copy(position);
      threeCamera.lookAt(center);
      threeCamera.updateProjectionMatrix();
      console.log('Camera moved (fallback) to:', view);
    }
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <AppBar position="static">
        <Toolbar>
          <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <img 
              src="/Fragments-AI-viewer/savora-logo.png" 
              alt="Savora Logo" 
              style={{ height: '32px' }}
            />
          </Box>
          <Tooltip title="Settings">
            <IconButton color="inherit" onClick={handleSettingsOpen} sx={{ mr: 1 }}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="About">
            <IconButton color="inherit" onClick={handleAboutOpen} sx={{ mr: 1 }}>
              <InfoOutlinedIcon />
            </IconButton>
          </Tooltip>
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
          <Button
            color="inherit"
            onClick={toggleIdsPanel}
            startIcon={<RuleIcon />}
            aria-pressed={isIdsOpen}
            sx={{
              mr: 1,
              borderRadius: 1.5,
              backgroundColor: isIdsOpen ? 'rgba(255,255,255,0.18)' : 'transparent',
              transition: 'background-color 0.2s ease',
              '&:hover': {
                backgroundColor: isIdsOpen ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)'
              }
            }}
            title={isIdsOpen ? 'Close IDS Checker' : 'Open IDS Checker'}
          >
            IDS Checker
          </Button>
          <Button
            color="inherit"
            onClick={toggleIdsCreatorPanel}
            startIcon={<EditNoteIcon />}
            aria-pressed={isIdsCreatorOpen}
            sx={{
              mr: 1,
              borderRadius: 1.5,
              backgroundColor: isIdsCreatorOpen ? 'rgba(255,255,255,0.18)' : 'transparent',
              transition: 'background-color 0.2s ease',
              '&:hover': {
                backgroundColor: isIdsCreatorOpen ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)'
              }
            }}
            title={isIdsCreatorOpen ? 'Close IDS Creator' : 'Open IDS Creator'}
          >
            IDS Creator
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

      {isExplorerOpen && (
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
                <IconButton 
                  size="small" 
                  color="inherit" 
                  onClick={toggleExplorerMinimized}
                  title={isExplorerMinimized ? "Expand panel" : "Minimize panel"}
                >
                  {isExplorerMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
                </IconButton>
                  <IconButton 
                  size="small" 
                  color="inherit" 
                  onClick={handleExplorerClose}
                  title="Close Model Explorer"
                >
                  <CloseIcon />
                </IconButton>
              </Box>
            </Box>

            {!isExplorerMinimized && (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
                  <Button variant="contained" size="small" onClick={() => fileInputRef.current?.click()} disabled={!componentsReady}>
                    Open IFC / FRAG
                  </Button>
                  <Tooltip title="Open parametric filter">
                    <span>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setIsFilterDialogOpen(true)}
                        disabled={!componentsReady}
                        startIcon={<FilterListIcon />}
                      >
                        Filter
                      </Button>
                    </span>
                  </Tooltip>
                    {import.meta.env.DEV && (
                      <Tooltip title="Dump raw .frag JSON (dev only)">
                        <span>
                          <Button
                            variant="outlined"
                            size="small"
                            color="inherit"
                            onClick={() => dumpModelRawData(currentModelIdRef.current ?? undefined)}
                            disabled={devDumpInProgress || !componentsReady || !models.length}
                          >
                            {devDumpInProgress ? 'Dumping…' : 'Dump Raw JSON'}
                          </Button>
                        </span>
                      </Tooltip>
                    )}
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

                <Tabs
                  value={explorerMainTab}
                  onChange={(_, value) => setExplorerMainTab(value as 'models' | 'properties' | 'tree')}
                  variant="fullWidth"
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    minHeight: 'auto',
                    '.MuiTab-root': {
                      minHeight: 48,
                      textTransform: 'none',
                      fontWeight: 500,
                    },
                  }}
                >
                  <Tab value="models" label="Models" />
                  <Tab value="properties" label="Properties" />
                  <Tab value="tree" label="Model Tree" />
                </Tabs>

                <Box
                  role="tabpanel"
                  hidden={explorerMainTab !== 'models'}
                  sx={{
                    display: explorerMainTab === 'models' ? 'flex' : 'none',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    px: 2,
                    py: 1,
                  }}
                >
                  <Box
                    ref={modelsListContainerRef}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1,
                      overflowY: 'auto',
                      flex: 1,
                      minHeight: 0,
                    }}
                  >
                    {!componentsReady && (
                      <Typography variant="body2" color="text.secondary">Initializing components…</Typography>
                    )}
                  </Box>
                </Box>

                <Box
                  role="tabpanel"
                  hidden={explorerMainTab !== 'properties'}
                  sx={{
                    display: explorerMainTab === 'properties' ? 'flex' : 'none',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    px: 2,
                    py: 1,
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minHeight: 0 }}>
                        <Tabs
                          value={selectedPropertyTab}
                          onChange={(_, value) => setSelectedPropertyTab(value as PropertyTabId)}
                          variant="scrollable"
                          allowScrollButtonsMobile
                          sx={{
                            minHeight: 'auto',
                            flexShrink: 0,
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
                            flex: selectedPropertyTab === 'favorites' ? 1 : 0,
                            minHeight: 0,
                          }}
                        >
                          {favoriteRows.length ? (
                            <Box sx={{ position: 'relative', flex: 1, minHeight: 200 }}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  position: 'absolute',
                                  inset: 0,
                                  p: 1,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 0.75,
                                  overflow: 'auto',
                                }}
                              >
                                {favoriteRows.map(renderPropertyRow)}
                              </Paper>
                            </Box>
                          ) : (
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 1,
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                              }}
                            >
                              <Typography variant="body2" color="text.secondary">
                                {favoritePropertyPaths.length
                                  ? 'The current selection does not expose any of your favourite properties yet. Try selecting another item.'
                                  : 'Mark properties as favourites from the All tab to pin them here.'}
                              </Typography>
                            </Paper>
                          )}
                          {missingFavoriteCount > 0 && favoritePropertyPaths.length > 0 && (
                            <Alert severity="info" variant="outlined" sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, m: 1, zIndex: 1 }}>
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
                            flex: selectedPropertyTab === 'all' ? 1 : 0,
                            minHeight: 0,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, mb: 1 }}>
                            <TextField
                              size="small"
                              fullWidth
                              value={selectionSearch}
                              onChange={(event) => setSelectionSearch(event.target.value)}
                              placeholder="Search properties…"
                              disabled={!propertyRows.length}
                            />
                            <Tooltip title="Copy raw element JSON">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={handleCopyRawData}
                                  disabled={!properties}
                                  color="primary"
                                >
                                  <ContentCopyIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
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
                            <Paper
                              variant="outlined"
                              sx={{
                                p: 1,
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                              }}
                            >
                              <Typography variant="body2" color="text.secondary">
                                Select an element in the viewer to view its Property Sets / NV_BIM / … breakdown.
                              </Typography>
                            </Paper>
                          ) : hasSelectionSearch ? (
                            matchedPropertyRows.length ? (
                              <Box sx={{ position: 'relative', flex: 1, minHeight: 200 }}>
                                <Paper
                                  variant="outlined"
                                  sx={{
                                    position: 'absolute',
                                    inset: 0,
                                    p: 1,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 0.75,
                                    overflow: 'auto',
                                  }}
                                >
                                  {matchedPropertyRows.map(renderPropertyRow)}
                                </Paper>
                              </Box>
                            ) : (
                              <Paper
                                variant="outlined"
                                sx={{
                                  p: 1,
                                  flex: 1,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  textAlign: 'center',
                                }}
                              >
                                <Typography variant="body2" color="text.secondary">
                                  {`No properties matched "${selectionSearchTerm}".`}
                                </Typography>
                              </Paper>
                            )
                          ) : (
                            <Box sx={{ position: 'relative', flex: 1, minHeight: 200 }}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  position: 'absolute',
                                  inset: 0,
                                  p: 1,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 0.75,
                                  overflow: 'auto',
                                }}
                              >
                                {limitedPropertyRows.map(renderPropertyRow)}
                              </Paper>
                              {truncatedPropertyCount > 0 && (
                                <Alert severity="info" variant="outlined" sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, m: 1, zIndex: 1 }}>
                                  {`Displaying the first ${limitedPropertyRows.length} properties. ${truncatedPropertyCount} more not shown.`}
                                </Alert>
                              )}
                            </Box>
                          )}
                        </Box>
                      </Box>
                  </Box>

                <Box
                  role="tabpanel"
                  hidden={explorerMainTab !== 'tree'}
                  sx={{
                    display: explorerMainTab === 'tree' ? 'flex' : 'none',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    px: 2,
                    py: 1,
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1, minHeight: 0 }}>
                        <TextField
                          size="small"
                          fullWidth
                          value={modelTreeSearch}
                          onChange={(event) => setModelTreeSearch(event.target.value)}
                          placeholder="Search the model tree…"
                          disabled={!models.length}
                          sx={{ flexShrink: 0 }}
                        />
                        <Box
                          sx={{
                            position: 'relative',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            minHeight: 200,
                            maxHeight: '100%',
                            height: '100%',
                            flex: 1,
                            overflow: 'hidden',
                            bgcolor: 'background.paper',
                          }}
                        >
                          <Box
                            ref={modelTreeContainerRef}
                            sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}
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
      )}

      {/* Model Explorer floating button - always visible */}
      <Paper 
        elevation={6} 
        sx={{ 
          position: 'fixed', 
          bottom: 20, 
          right: 90, 
          zIndex: 1700, 
          borderRadius: '50%',
          backgroundColor: isExplorerOpen ? 'primary.main' : 'background.paper',
          transition: 'background-color 0.2s ease'
        }}
      >
        <IconButton 
          onClick={toggleExplorerWindow} 
          title={isExplorerOpen ? 'Close Model Explorer' : 'Open Model Explorer'}
          sx={{ color: isExplorerOpen ? 'white' : 'inherit' }}
        >
          <ViewListIcon />
        </IconButton>
      </Paper>

      {/* Chat floating button - always visible */}
      <Paper 
        elevation={6} 
        sx={{ 
          position: 'fixed', 
          bottom: 20, 
          right: 30, 
          zIndex: 1700, 
          borderRadius: '50%',
          backgroundColor: isChatOpen ? 'primary.main' : 'background.paper',
          transition: 'background-color 0.2s ease'
        }}
      >
        <IconButton 
          onClick={toggleChatWindow} 
          title={isChatOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
          sx={{ color: isChatOpen ? 'white' : 'inherit' }}
        >
          <ChatIcon />
        </IconButton>
      </Paper>

      {/* IDS Checker floating button - always visible */}
      <Paper 
        elevation={6} 
        sx={{ 
          position: 'fixed', 
          bottom: 20, 
          right: 150, 
          zIndex: 1700, 
          borderRadius: '50%',
          backgroundColor: isIdsOpen ? 'primary.main' : 'background.paper',
          transition: 'background-color 0.2s ease'
        }}
      >
        <IconButton 
          onClick={toggleIdsPanel} 
          title={isIdsOpen ? 'Close IDS Checker' : 'Open IDS Checker'}
          sx={{ color: isIdsOpen ? 'white' : 'inherit' }}
        >
          <RuleIcon />
        </IconButton>
      </Paper>

      {/* IDS Creator floating button - always visible */}
      <Paper 
        elevation={6} 
        sx={{ 
          position: 'fixed', 
          bottom: 20, 
          right: 210, 
          zIndex: 1700, 
          borderRadius: '50%',
          backgroundColor: isIdsCreatorOpen ? 'primary.main' : 'background.paper',
          transition: 'background-color 0.2s ease'
        }}
      >
        <IconButton 
          onClick={toggleIdsCreatorPanel} 
          title={isIdsCreatorOpen ? 'Close IDS Creator' : 'Open IDS Creator'}
          sx={{ color: isIdsCreatorOpen ? 'white' : 'inherit' }}
        >
          <EditNoteIcon />
        </IconButton>
      </Paper>

      {/* View Controls Toolbar */}
      {isViewToolbarOpen ? (
        <Draggable
          handle=".drag-handle"
          defaultPosition={{ x: 20, y: -260 }}
        >
          <Paper 
            elevation={8} 
            sx={{ 
              position: 'absolute',
              bottom: 90,
              padding: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              zIndex: 1600,
              backgroundColor: 'rgba(245, 245, 245, 0.98)',
              backdropFilter: 'blur(10px)',
              borderRadius: 2,
              cursor: 'move',
              border: '1px solid rgba(0, 0, 0, 0.12)',
            }}
          >
            <Box 
              className="drag-handle"
              sx={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                mb: 0.5,
                cursor: 'grab',
                '&:active': { cursor: 'grabbing' }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <DragIndicatorIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main' }}>
                  View Controls
                </Typography>
              </Box>
              <IconButton 
                size="small" 
                onClick={() => setIsViewToolbarOpen(false)}
                title="Close toolbar"
                sx={{ ml: 1 }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>

          {/* Camera Controls */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Fit to model" PopperProps={{ sx: { zIndex: 9999 } }}>
              <IconButton 
                size="small" 
                onClick={fitToCurrentModel}
                disabled={!modelLoaded}
                sx={{ 
                  border: '2px solid',
                  borderColor: 'rgba(0, 0, 0, 0.23)',
                  backgroundColor: 'white',
                  '&:hover': { backgroundColor: 'primary.main', color: 'white', borderColor: 'primary.main' },
                  '&:disabled': { backgroundColor: 'rgba(0, 0, 0, 0.12)' }
                }}
              >
                <CenterFocusStrongIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset view" PopperProps={{ sx: { zIndex: 9999 } }}>
              <IconButton 
                size="small" 
                onClick={resetView}
                sx={{ 
                  border: '2px solid',
                  borderColor: 'rgba(0, 0, 0, 0.23)',
                  backgroundColor: 'white',
                  '&:hover': { backgroundColor: 'primary.main', color: 'white', borderColor: 'primary.main' }
                }}
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Camera View Presets */}
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, display: 'block', mb: 0.5 }}>
              View Presets
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5 }}>
              <Tooltip title="Top view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('top')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    '&:hover': { backgroundColor: 'primary.main', color: 'white' }
                  }}
                >
                  Top
                </Button>
              </Tooltip>
              <Tooltip title="Bottom view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('bottom')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    '&:hover': { backgroundColor: 'primary.main', color: 'white' }
                  }}
                >
                  Bot
                </Button>
              </Tooltip>
              <Tooltip title="Front view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('front')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    '&:hover': { backgroundColor: 'primary.main', color: 'white' }
                  }}
                >
                  Frt
                </Button>
              </Tooltip>
              <Tooltip title="Back view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('back')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    '&:hover': { backgroundColor: 'primary.main', color: 'white' }
                  }}
                >
                  Bck
                </Button>
              </Tooltip>
              <Tooltip title="Left view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('left')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    '&:hover': { backgroundColor: 'primary.main', color: 'white' }
                  }}
                >
                  Left
                </Button>
              </Tooltip>
              <Tooltip title="Right view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('right')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    '&:hover': { backgroundColor: 'primary.main', color: 'white' }
                  }}
                >
                  Rgt
                </Button>
              </Tooltip>
              <Tooltip title="Isometric view" PopperProps={{ sx: { zIndex: 9999 } }}>
                <Button 
                  size="small" 
                  onClick={() => setCameraView('iso')}
                  variant="outlined"
                  sx={{ 
                    minWidth: 'auto',
                    px: 0.5,
                    fontSize: '0.7rem',
                    gridColumn: 'span 2',
                    '&:hover': { backgroundColor: 'success.main', color: 'white' }
                  }}
                >
                  <ViewInArIcon fontSize="small" sx={{ mr: 0.5 }} />
                  ISO
                </Button>
              </Tooltip>
            </Box>
          </Box>

          {/* Clipping Planes */}
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, display: 'block', mb: 0.5 }}>
              Clipping Planes
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Toggle X-axis clipping" PopperProps={{ sx: { zIndex: 9999 } }}>
                <IconButton 
                  size="small" 
                  onClick={() => toggleClippingPlane('x')}
                  sx={{ 
                    border: '2px solid',
                    borderColor: clippingPlanes.x ? 'error.main' : 'rgba(0, 0, 0, 0.23)',
                    backgroundColor: clippingPlanes.x ? 'error.main' : 'white',
                    color: clippingPlanes.x ? 'white' : 'error.main',
                    '&:hover': { 
                      backgroundColor: clippingPlanes.x ? 'error.dark' : 'error.light', 
                      borderColor: 'error.main',
                      color: 'white'
                    }
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>X</Typography>
                </IconButton>
              </Tooltip>
              <Tooltip title="Toggle Y-axis clipping" PopperProps={{ sx: { zIndex: 9999 } }}>
                <IconButton 
                  size="small" 
                  onClick={() => toggleClippingPlane('y')}
                  sx={{ 
                    border: '2px solid',
                    borderColor: clippingPlanes.y ? 'success.main' : 'rgba(0, 0, 0, 0.23)',
                    backgroundColor: clippingPlanes.y ? 'success.main' : 'white',
                    color: clippingPlanes.y ? 'white' : 'success.main',
                    '&:hover': { 
                      backgroundColor: clippingPlanes.y ? 'success.dark' : 'success.light',
                      borderColor: 'success.main',
                      color: 'white'
                    }
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>Y</Typography>
                </IconButton>
              </Tooltip>
              <Tooltip title="Toggle Z-axis clipping" PopperProps={{ sx: { zIndex: 9999 } }}>
                <IconButton 
                  size="small" 
                  onClick={() => toggleClippingPlane('z')}
                  sx={{ 
                    border: '2px solid',
                    borderColor: clippingPlanes.z ? 'primary.main' : 'rgba(0, 0, 0, 0.23)',
                    backgroundColor: clippingPlanes.z ? 'primary.main' : 'white',
                    color: clippingPlanes.z ? 'white' : 'primary.main',
                    '&:hover': { 
                      backgroundColor: clippingPlanes.z ? 'primary.dark' : 'primary.light',
                      borderColor: 'primary.main',
                      color: 'white'
                    }
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>Z</Typography>
                </IconButton>
              </Tooltip>
            </Box>
            
            {/* Clipping Plane Position Sliders */}
            {clippingPlanes.x && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mb: 0.5 }}>
                  X Position: {clippingPositions.x.toFixed(1)}
                </Typography>
                <Slider
                  value={clippingPositions.x}
                  onChange={(_, value) => updateClippingPosition('x', value as number)}
                  min={-50}
                  max={50}
                  step={0.1}
                  size="small"
                  sx={{ color: 'error.main' }}
                />
              </Box>
            )}
            {clippingPlanes.y && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ color: 'success.main', display: 'block', mb: 0.5 }}>
                  Y Position: {clippingPositions.y.toFixed(1)}
                </Typography>
                <Slider
                  value={clippingPositions.y}
                  onChange={(_, value) => updateClippingPosition('y', value as number)}
                  min={-50}
                  max={50}
                  step={0.1}
                  size="small"
                  sx={{ color: 'success.main' }}
                />
              </Box>
            )}
            {clippingPlanes.z && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mb: 0.5 }}>
                  Z Position: {clippingPositions.z.toFixed(1)}
                </Typography>
                <Slider
                  value={clippingPositions.z}
                  onChange={(_, value) => updateClippingPosition('z', value as number)}
                  min={-50}
                  max={50}
                  step={0.1}
                  size="small"
                  sx={{ color: 'primary.main' }}
                />
              </Box>
            )}
          </Box>

          {/* Clipping Box */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Toggle clipping box" PopperProps={{ sx: { zIndex: 9999 } }}>
              <IconButton 
                size="small" 
                onClick={toggleClippingBox}
                sx={{ 
                  border: '2px solid',
                  borderColor: isClippingBoxActive ? 'warning.main' : 'rgba(0, 0, 0, 0.23)',
                  backgroundColor: isClippingBoxActive ? 'warning.main' : 'white',
                  color: isClippingBoxActive ? 'white' : 'warning.dark',
                  '&:hover': { 
                    backgroundColor: isClippingBoxActive ? 'warning.dark' : 'warning.light',
                    borderColor: 'warning.main',
                    color: 'white'
                  }
                }}
              >
                <CropIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Clear all clipping" PopperProps={{ sx: { zIndex: 9999 } }}>
              <IconButton 
                size="small" 
                onClick={clearAllClipping}
                disabled={!clippingPlanes.x && !clippingPlanes.y && !clippingPlanes.z && !isClippingBoxActive}
                sx={{ 
                  border: '2px solid',
                  borderColor: 'rgba(0, 0, 0, 0.23)',
                  backgroundColor: 'white',
                  '&:hover': { backgroundColor: 'error.main', color: 'white', borderColor: 'error.main' },
                  '&:disabled': { backgroundColor: 'rgba(0, 0, 0, 0.12)', borderColor: 'rgba(0, 0, 0, 0.12)' }
                }}
              >
                <ContentCutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Measurement Tool */}
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
            <Tooltip title={isMeasuring ? "Stop measuring" : "Start measuring"} PopperProps={{ sx: { zIndex: 9999 } }}>
              <IconButton 
                size="small" 
                onClick={toggleMeasurement}
                sx={{ 
                  border: '2px solid',
                  borderColor: isMeasuring ? 'success.main' : 'rgba(0, 0, 0, 0.23)',
                  backgroundColor: isMeasuring ? 'success.main' : 'white',
                  color: isMeasuring ? 'white' : 'success.dark',
                  '&:hover': { 
                    backgroundColor: isMeasuring ? 'success.dark' : 'success.light',
                    borderColor: 'success.main',
                    color: 'white'
                  }
                }}
              >
                <StraightenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {lastMeasurementValue && (
              <Typography 
                variant="caption" 
                sx={{ 
                  ml: 0.5,
                  px: 1,
                  py: 0.25,
                  backgroundColor: 'success.light',
                  color: 'success.dark',
                  borderRadius: 1,
                  fontWeight: 500,
                  fontSize: '0.75rem',
                  whiteSpace: 'nowrap'
                }}
              >
                {lastMeasurementValue} units
              </Typography>
            )}
          </Box>

          {/* Selection Mode Toggle */}
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, display: 'block', mb: 0.5 }}>
              Selection Mode
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Click selection" PopperProps={{ sx: { zIndex: 9999 } }}>
                <IconButton 
                  size="small" 
                  onClick={() => setSelectionMode('click')}
                  sx={{ 
                    border: '2px solid',
                    borderColor: selectionMode === 'click' ? 'primary.main' : 'rgba(0, 0, 0, 0.23)',
                    backgroundColor: selectionMode === 'click' ? 'primary.main' : 'white',
                    color: selectionMode === 'click' ? 'white' : 'primary.main',
                    '&:hover': { 
                      backgroundColor: selectionMode === 'click' ? 'primary.dark' : 'primary.light',
                      borderColor: 'primary.main',
                      color: selectionMode === 'click' ? 'white' : 'primary.dark'
                    }
                  }}
                >
                  <TouchAppIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Rectangle selection" PopperProps={{ sx: { zIndex: 9999 } }}>
                <IconButton 
                  size="small" 
                  onClick={() => setSelectionMode('rectangle')}
                  sx={{ 
                    border: '2px solid',
                    borderColor: selectionMode === 'rectangle' ? 'secondary.main' : 'rgba(0, 0, 0, 0.23)',
                    backgroundColor: selectionMode === 'rectangle' ? 'secondary.main' : 'white',
                    color: selectionMode === 'rectangle' ? 'white' : 'secondary.main',
                    '&:hover': { 
                      backgroundColor: selectionMode === 'rectangle' ? 'secondary.dark' : 'secondary.light',
                      borderColor: 'secondary.main',
                      color: selectionMode === 'rectangle' ? 'white' : 'secondary.dark'
                    }
                  }}
                >
                  <SelectAllIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {selectionMode === 'rectangle' && (
              <Alert 
                severity="info" 
                sx={{ 
                  mt: 0.5, 
                  py: 0, 
                  px: 1,
                  fontSize: '0.7rem',
                  '& .MuiAlert-icon': { fontSize: '0.9rem', py: 0.25 }
                }}
              >
                Rotation disabled. Use middle-click to pan.
              </Alert>
            )}
          </Box>
        </Paper>
        </Draggable>
      ) : (
        <Paper elevation={6} sx={{ position: 'fixed', bottom: 20, left: 20, zIndex: 1600, borderRadius: '50%' }}>
          <IconButton onClick={() => setIsViewToolbarOpen(true)} title="Open View Controls">
            <CenterFocusStrongIcon />
          </IconButton>
        </Paper>
      )}

      {/* Model Filter Dialog (lazy) */}
      <Suspense fallback={null}>
        {isFilterDialogOpen && (
          <ModelFilterPanel open={isFilterDialogOpen} onClose={() => setIsFilterDialogOpen(false)} viewerApi={viewerApiRef.current ?? null} />
        )}
      </Suspense>

      <Dialog open={isSettingsOpen} onClose={handleSettingsClose} fullWidth maxWidth="sm">
        <DialogTitle>Settings</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 1 }}>
            <FormControl component="fieldset">
              <FormLabel component="legend" sx={{ mb: 1 }}>AI Provider</FormLabel>
              <RadioGroup
                value={settingsProvider}
                onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
              >
                <FormControlLabel 
                  value="gemini" 
                  control={<Radio />} 
                  label="Google Gemini" 
                />
                <FormControlLabel 
                  value="openai" 
                  control={<Radio />} 
                  label="OpenAI (ChatGPT)" 
                />
                <FormControlLabel 
                  value="disabled" 
                  control={<Radio />} 
                  label="Disabled (No AI)" 
                />
              </RadioGroup>
            </FormControl>

            {settingsProvider !== 'disabled' && (
              <>
                <TextField
                  label="API Key"
                  type={showSettingsApiKey ? 'text' : 'password'}
                  value={settingsApiKey}
                  onChange={(e) => setSettingsApiKey(e.target.value)}
                  fullWidth
                  placeholder={`Enter your ${settingsProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'} API key`}
                  InputProps={{
                    endAdornment: (
                      <IconButton
                        onClick={() => setShowSettingsApiKey(!showSettingsApiKey)}
                        edge="end"
                        size="small"
                      >
                        {showSettingsApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    )
                  }}
                  helperText={
                    settingsProvider === 'gemini' 
                      ? 'Get your API key from: https://makersuite.google.com/app/apikey'
                      : 'Get your API key from: https://platform.openai.com/api-keys'
                  }
                />

                <TextField
                  select
                  label="Model"
                  value={settingsModel}
                  onChange={(e) => setSettingsModel(e.target.value)}
                  fullWidth
                  SelectProps={{
                    native: true,
                  }}
                  helperText="Select the AI model to use"
                >
                  {getAvailableModels(settingsProvider).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </TextField>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button
                    variant="outlined"
                    onClick={handleTestConnection}
                    disabled={!settingsApiKey || isTestingConnection}
                    size="small"
                  >
                    {isTestingConnection ? 'Testing...' : 'Test Connection'}
                  </Button>
                  {connectionTestResult === 'success' && (
                    <Typography variant="body2" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      ✓ Connection successful
                    </Typography>
                  )}
                  {connectionTestResult === 'error' && (
                    <Typography variant="body2" color="error.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      ✗ Connection failed
                    </Typography>
                  )}
                </Box>

                <Alert severity="info" variant="outlined">
                  <Typography variant="body2">
                    <strong>Security Note:</strong> Your API key is stored locally in your browser's localStorage and never sent to our servers. 
                    All AI requests are made directly from your browser to {settingsProvider === 'gemini' ? 'Google' : 'OpenAI'}.
                  </Typography>
                </Alert>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSettingsClose}>Cancel</Button>
          <Button 
            onClick={handleSettingsSave} 
            variant="contained" 
            color="primary"
            disabled={settingsProvider !== 'disabled' && !settingsApiKey}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isAboutOpen} onClose={handleAboutClose} fullWidth maxWidth="md">
        <DialogTitle>About Savora Viewer</DialogTitle>
        <DialogContent dividers sx={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <Typography variant="h6" gutterBottom>
            Version 0.2.1 Preview
          </Typography>
          
          <Typography variant="body2" color="text.secondary" paragraph>
            A powerful web-based 3D viewer for Building Information Modeling (BIM) files with integrated IDS validation and AI-powered assistance. Built on That Open Company BIM Toolkit and Three.js. <br />
            For bug reporting and more information, visit our <Link href="https://github.com/MattiasTech/Fragments-AI-viewer" target="_blank" rel="noopener">website</Link>. <br />
            <span style={{ fontWeight: 'bold' }}>Note: No data is collected or sent to any servers; all processing occurs locally in your browser.</span>
          </Typography>

          <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
            Features
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2, fontWeight: 'bold' }}>
            Model Viewing
          </Typography>
          <Typography variant="body2" component="div" sx={{ pl: 2 }}>
            • Multiple format support (IFC, Fragments)<br/>
            • Pan, zoom, rotate navigation<br/>
            • Selection via point-and-click or rectangular region<br/>
            • Orthogonal projection for accurate measurements<br/>
            • View management (zoom to fit, home, cube orientation)<br/>
            • Toggle performance stats<br/>
            • Object measurement tools<br/>
            • Clipping planes for sectional views
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2, fontWeight: 'bold' }}>
            Model Explorer
          </Typography>
          <Typography variant="body2" component="div" sx={{ pl: 2 }}>
            • Spatial and classification hierarchy navigation<br/>
            • Tree-based model structure view<br/>
            • Properties panel with expand/collapse<br/>
            • Search and filter functionality<br/>
            • Property export (CSV, JSON)<br/>
            • Favorites system for quick access<br/>
            • Parametric filtering with Ghost/Isolate modes
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2, fontWeight: 'bold' }}>
            IDS Checker
          </Typography>
          <Typography variant="body2" component="div" sx={{ pl: 2 }}>
            • Validate models against Information Delivery Specification (IDS)<br/>
            • Load IDS files from local storage<br/>
            • Visual feedback: green (pass) and red (fail) indicators<br/>
            • Filter models by validation results<br/>
            • Export validation reports
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2, fontWeight: 'bold' }}>
            IDS Creator
          </Typography>
          <Typography variant="body2" component="div" sx={{ pl: 2 }}>
            • Visual authoring tool for IDS specifications<br/>
            • Capture and define validation rules<br/>
            • Property picker for easy specification setup<br/>
            • Save and load IDS files<br/>
            • Integration with IDS Checker for immediate validation
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2, fontWeight: 'bold' }}>
            BIM AI Assistant
          </Typography>
          <Typography variant="body2" component="div" sx={{ pl: 2 }}>
            • Natural language queries about model contents<br/>
            • Intelligent model analysis and insights<br/>
            • Context-aware responses based on selected elements<br/>
            • Interactive chat interface<br/>
            • Selection and filtering via conversation
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2, fontWeight: 'bold' }}>
            User Experience
          </Typography>
          <Typography variant="body2" component="div" sx={{ pl: 2 }}>
            • Floating toolbar for model operations<br/>
            • Tooltips and keyboard shortcuts<br/>
            • Collapsible side panels<br/>
            • Responsive layout<br/>
            • Dark theme optimized for long viewing sessions
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAboutClose} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

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

        <Suspense fallback={null}>
          <IdsPanel
            isOpen={isIdsOpen}
            onOpen={openIdsPanel}
            onClose={closeIdsPanel}
            viewerApi={viewerApi}
            hasModel={models.length > 0}
            expandSignal={idsExpandSignal}
          />

          <IdsCreatorPanel
            isOpen={isIdsCreatorOpen}
            onClose={() => setIsIdsCreatorOpen(false)}
            viewerApi={viewerApi}
            selectedItemData={properties}
            onValidate={handleValidateFromCreator}
          />

          <ChatWindow
            getModelDataForAI={getModelDataForAI}
            isOpen={isChatOpen}
            onOpen={openChatWindow}
            onClose={closeChatWindow}
            expandSignal={chatExpandSignal}
            onRequestSelection={handleAISelection}
            onOpenSettings={handleSettingsOpen}
          />
        </Suspense>

      <Menu
        open={Boolean(contextMenu)}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        disableAutoFocus
        disableAutoFocusItem
        disableEnforceFocus
        disablePortal
        hideBackdrop
        disableScrollLock
        disableRestoreFocus
        MenuListProps={{ 
          autoFocusItem: false,
          'aria-label': 'Element context menu'
        }}
        slotProps={{
          paper: {
            sx: { 
              pointerEvents: 'auto',
              boxShadow: 3
            }
          }
        }}
        TransitionProps={{
          onExited: () => {
            // Ensure focus is properly restored without aria-hidden conflicts
            document.body.removeAttribute('aria-hidden');
          }
        }}
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
