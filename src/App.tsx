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
import Collapse from '@mui/material/Collapse';
import Draggable from 'react-draggable';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import ViewListIcon from '@mui/icons-material/ViewList';
import ChatIcon from '@mui/icons-material/Chat';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import * as THREE from 'three';
import Stats from 'stats.js';
import ChatWindow from './ChatWindow';

type Selected = { modelId: string; localId: number } | null;

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

    const fullLabel = labelParts.join(' / ');
    const idBase = keyParts.length ? keyParts.join('/') : sanitizeKey(fullLabel || 'value');
    const label = labelParts[labelParts.length - 1] ?? 'Value';

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
        const childLabel = childName ?? `${label} ${index + 1}`;
        const childKey = childName ? sanitizeKey(childName) : String(index);
        const childNode = visit(child, [...labelParts.slice(0, -1), label, childLabel], [...keyParts, childKey]);
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
          const nominalLabel = 'NominalValue';
          const childNode = visit(childVal, [...labelParts, nominalLabel], [...keyParts, 'nominal-value']);
          if (childNode) children.push(childNode);
          continue;
        }
        const friendly = TOP_LEVEL_LABELS[entryKey] ?? entryKey;
        const childName = readName(childVal);
        const nextLabelParts = childName ? [...labelParts, childName] : [...labelParts, friendly];
        const childKeyPart = childName ? sanitizeKey(childName) : sanitizeKey(friendly);
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
  const [selected, setSelected] = useState<Selected>(null);
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
  const highlighterRef = useRef<any>(null);
  const [explorerSize, setExplorerSize] = useState({ width: 360, height: 520 });
  const explorerResizeOriginRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const explorerResizingRef = useRef(false);
  const explorerNodeRef = useRef<HTMLDivElement | null>(null);
  const uiInitializedRef = useRef(false);
  const modelsListContainerRef = useRef<HTMLDivElement | null>(null);
  const modelsListElementRef = useRef<HTMLElement | null>(null);
  const updateModelsListRef = useRef<ReturnType<typeof BUIC.tables.modelsList>[1] | null>(null);
  const itemsDataContainerRef = useRef<HTMLDivElement | null>(null);
  const itemsDataElementRef = useRef<HTMLElement | null>(null);
  const updateItemsDataRef = useRef<ReturnType<typeof BUIC.tables.itemsData>[1] | null>(null);
  const hiderRef = useRef<OBC.Hider | null>(null);
  const selectedRef = useRef<Selected>(null);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [propertyRows, setPropertyRows] = useState<PropertyRow[]>([]);
  const [propertySearch, setPropertySearch] = useState('');
  const [isModelsSectionCollapsed, setIsModelsSectionCollapsed] = useState(false);
  const [isPropertiesSectionCollapsed, setIsPropertiesSectionCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chatExpandSignal, setChatExpandSignal] = useState(0);
  const [modelSummaries, setModelSummaries] = useState<Record<string, ModelSummary>>({});

  const matchedPropertyRows = useMemo(() => {
    const term = propertySearch.trim().toLowerCase();
    if (!term) return [] as PropertyRow[];
    return propertyRows.filter((row) => row.searchText.includes(term)).slice(0, 50);
  }, [propertySearch, propertyRows]);

  const updateSelectedProperties = useCallback((data: Record<string, any> | null) => {
    const normalized = data ?? null;
    setProperties(normalized);
    const { rows } = buildPropertyData(normalized);
    setPropertyRows(rows);
  }, []);

  const openChatWindow = useCallback(() => {
    setIsChatOpen(true);
    setChatExpandSignal((prev) => prev + 1);
  }, []);

  const closeChatWindow = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);


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
      const firstEntry = Object.entries(modelIdMap)[0];
      if (!firstEntry) return;
      const [modelId, ids] = firstEntry;
      const iterator = ids.values().next();
      if (iterator.done) return;
      const localId = iterator.value;
      setSelected({ modelId, localId });
      handleExplorerOpen();
      const fragments = fragmentsRef.current;
      if (!fragments) return;
      const model = fragments.list.get(modelId);
      if (!model) return;
      try {
        const [data] = await model.getItemsData([localId]);
        updateSelectedProperties(data || null);
      } catch (error) {
        console.warn('Failed to fetch properties for selection', error);
      }
    };

    const clearHandler = () => {
      setSelected(null);
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

    ensureChild(itemsDataContainerRef.current, itemsDataElementRef, () => {
      const [element, update] = BUIC.tables.itemsData({
        components,
        modelIdMap: {},
        emptySelectionWarning: true,
      });
      updateItemsDataRef.current = update;
      element.style.width = '100%';
      element.style.height = '100%';
      element.style.overflow = 'auto';
      const tableElement = element as BUI.Table<any> & {
        queryString: string | null;
        preserveStructureOnFilter?: boolean;
        indentationInText?: boolean;
      };
      tableElement.preserveStructureOnFilter = true;
      tableElement.indentationInText = false;
      tableElement.queryString = propertySearch.trim() ? propertySearch.trim() : null;
      const currentSelection = selectedRef.current;
      const modelIdMap = currentSelection
        ? { [currentSelection.modelId]: new Set<number>([currentSelection.localId]) }
        : {};
      update({
        components,
        modelIdMap,
        emptySelectionWarning: true,
      });
      return element;
    });

  }, [componentsReady, isExplorerOpen, propertySearch]);

  useEffect(() => {
    if (!componentsReady) return;
    const components = componentsRef.current;
    const updateItemsData = updateItemsDataRef.current;
    if (!components || !updateItemsData) return;

    const modelIdMap = selected
      ? { [selected.modelId]: new Set<number>([selected.localId]) }
      : {};

    updateItemsData({
      components,
      modelIdMap,
      emptySelectionWarning: true,
    });
  }, [componentsReady, selected]);

  useEffect(() => {
    const table = itemsDataElementRef.current as (BUI.Table<any> & { queryString?: string | null }) | null;
    if (!table) return;
    const term = propertySearch.trim();
    table.queryString = term ? term : null;
  }, [propertySearch]);

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

  const handleExplorerClose = useCallback(() => {
    setIsExplorerOpen(false);
  }, []);

  const toggleExplorerMinimized = useCallback(() => {
    setIsExplorerMinimized((prev) => !prev);
  }, []);

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

    if (selected) {
      lines.push(`Selected element => modelId: ${selected.modelId}, localId: ${selected.localId}`);
      let selectedProps = properties;
      if ((!selectedProps || Object.keys(selectedProps).length === 0) && fr) {
        const model = fr.list.get(selected.modelId);
        if (model) {
          try {
            const [data] = await model.getItemsData([selected.localId]);
            selectedProps = data || null;
          } catch (err) {
            console.warn('Failed to fetch properties for AI context', err);
          }
        }
      }
      if (selectedProps) {
        lines.push('Selected element properties (raw snapshot):');
        lines.push(stringifyLimited(selectedProps, 8000));
      } else {
        lines.push('Selected element properties are not currently available.');
      }
  const rows = propertyRows.length ? propertyRows : buildPropertyData(selectedProps).rows;
      if (rows.length) {
        lines.push(`Selected element property count: ${rows.length}`);
        lines.push('Selected element flattened properties:');
        for (const row of rows) {
          lines.push(`- ${row.label}: ${row.value}`);
        }
      }
    }

    if (lines.length === 0) {
      lines.push('Viewer is idle: no models or selections to describe.');
    }

    return lines.join('\n');
  }, [models, selected, properties, propertyRows, modelSummaries]);

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
    if (!selection || !hider) {
      setContextMenu(null);
      return;
    }
    const modelIdMap: Record<string, Set<number>> = {
      [selection.modelId]: new Set([selection.localId]),
    };
    try {
      await hider.set(false, modelIdMap);
      try { highlighterRef.current?.clear?.(); } catch {}
      setSelected(null);
      updateSelectedProperties(null);
    } catch (error) {
      console.warn('Failed to hide selected element', error);
    } finally {
      setContextMenu(null);
    }
  }, [setContextMenu, setSelected, updateSelectedProperties]);

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

      setSelected({ modelId: best.model.modelId, localId: best.localId });
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
      if (!currentSelection) {
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
          <Button color="inherit" onClick={handleExplorerOpen} sx={{ mr: 1 }} startIcon={<ViewListIcon />} title="Open Model Explorer">
            Model Explorer
          </Button>
          <Button color="inherit" onClick={openChatWindow} sx={{ mr: 1 }} startIcon={<ChatIcon />}>
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
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="subtitle2">Selected Item Data</Typography>
                    <IconButton size="small" onClick={() => setIsPropertiesSectionCollapsed((prev) => !prev)}>
                      {isPropertiesSectionCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                    </IconButton>
                  </Box>
                  <Collapse in={!isPropertiesSectionCollapsed} timeout="auto">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={propertySearch}
                        onChange={(event) => setPropertySearch(event.target.value)}
                        placeholder="Search properties…"
                        disabled={!componentsReady}
                      />
                    </Box>
                    {propertySearch.trim() && (
                      <Paper
                        variant="outlined"
                        sx={{
                          mb: 1,
                          maxHeight: 160,
                          overflowY: 'auto',
                          p: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.75,
                        }}
                      >
                        {matchedPropertyRows.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            No properties matched “{propertySearch.trim()}”.
                          </Typography>
                        ) : (
                          matchedPropertyRows.map((row) => (
                            <Box key={row.path} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {row.label}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {row.value ? row.value : '—'}
                              </Typography>
                            </Box>
                          ))
                        )}
                      </Paper>
                    )}
                    <Box
                      ref={itemsDataContainerRef}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        minHeight: 200,
                        maxHeight: 320,
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        position: 'relative',
                      }}
                    >
                      {!componentsReady && (
                        <Box sx={{ p: 2 }}>
                          <Typography variant="body2" color="text.secondary">
                            Viewer is initializing…
                          </Typography>
                        </Box>
                      )}
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

      <ChatWindow
        getModelDataForAI={getModelDataForAI}
        isOpen={isChatOpen}
        onOpen={openChatWindow}
        onClose={closeChatWindow}
        expandSignal={chatExpandSignal}
      />

      <Menu
        open={Boolean(contextMenu)}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={hideSelected} disabled={!selected}>
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
