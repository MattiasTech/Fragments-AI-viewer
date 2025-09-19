import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import * as THREE from 'three';
import Stats from 'stats.js';

type Selected = { modelId: string; localId: number } | null;

const App: React.FC = () => {
  // DOM & engine refs
  const viewerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const worldRef = useRef<OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer> | null>(null);
  const fragmentsRef = useRef<FRAGS.FragmentsModels | null>(null);
  const ifcImporterRef = useRef<FRAGS.IfcImporter | null>(null);
  const currentModelIdRef = useRef<string | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [explorerTree, setExplorerTree] = useState<any | null>(null);
  const [explorerModelId, setExplorerModelId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [properties, setProperties] = useState<Record<string, any> | null>(null);
  const navCubeRef = useRef<HTMLCanvasElement | null>(null);
  const navCubeState = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; cube: THREE.Mesh } | null>(null);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    // Ensure the container is empty (avoids duplicate canvases in React StrictMode)
    try { container.replaceChildren(); } catch { /* no-op */ }

    // 1) Set up That Open world (scene + renderer + camera)
    const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.renderer = new OBC.SimpleRenderer(components, container);
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  world.camera.controls?.setLookAt(10, 10, 10, 0, 0, 0);
    // Loosen clipping planes for large IFCs
world.camera.three.near = 0.1;
world.camera.three.far = 1e9;
world.camera.three.updateProjectionMatrix();

// Optional: a bit of ambient to ensure visibility if materials are lit
const ambient = new THREE.AmbientLight(0xffffff, 1.0);
world.scene.three.add(ambient);

  components.init();
    components.get(OBC.Grids).create(world);
    worldRef.current = world;

  // Stats.js overlay (FPS/MS/MB) in top-left similar to your screenshot
  const stats = new Stats();
  stats.showPanel(2); // 0: fps, 1: ms, 2: mb (default to memory like screenshot)
  stats.dom.style.position = 'absolute';
  stats.dom.style.left = '8px';
  stats.dom.style.top = '8px';
  stats.dom.style.zIndex = '1000';
  container.appendChild(stats.dom);
  // Hook begin/end to renderer update loop
  world.renderer.onBeforeUpdate.add(() => stats.begin());
  world.renderer.onAfterUpdate.add(() => stats.end());

    // 2) Init Fragments engine + IFC importer
    const init = async () => {
      const fetched = await fetch('https://thatopen.github.io/engine_fragment/resources/worker.mjs');
      const blob = await fetched.blob();
      const workerUrl = URL.createObjectURL(new File([blob], 'worker.mjs', { type: 'text/javascript' }));
      workerUrlRef.current = workerUrl;

      const fragments = new FRAGS.FragmentsModels(workerUrl);
      fragmentsRef.current = fragments;

      // Update fragments visibility after camera settles (nice perf)
  world.camera.controls?.addEventListener('rest', () => fragments.update(true));

      // IFC importer -> load WASM from your app (avoid CDN mismatch)
      const ifcImporter = new FRAGS.IfcImporter();
      ifcImporter.wasm = {
        path: '/web-ifc/', // requires /public/web-ifc/web-ifc-api.js and /public/web-ifc/web-ifc.wasm
        absolute: true
      };
      ifcImporterRef.current = ifcImporter;
    };
    init();

    // Create a small navigation cube canvas overlay
    const navCanvas = document.createElement('canvas');
    navCanvas.width = 110; navCanvas.height = 110;
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
    const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(5,10,7); nScene.add(dl);
    navCubeState.current = { scene: nScene, camera: nCamera, renderer: nRenderer, cube };

    world.renderer.onAfterUpdate.add(() => {
      const st = navCubeState.current; if (!st) return;
      st.cube.quaternion.copy(world.camera.three.quaternion);
      st.renderer.render(st.scene, st.camera);
    });

    // Click faces to snap camera
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onNavClick = async (ev: MouseEvent) => {
      const st = navCubeState.current; if (!st) return;
      const rect = navCanvas.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, st.camera);
      const hit = raycaster.intersectObject(st.cube, true)[0];
      if (!hit || !hit.face) return;
      const normal = hit.face.normal.clone().transformDirection(st.cube.matrixWorld);
      const target = new THREE.Vector3(0,0,0);
      // Try compute bounding sphere from all models
      const fr = fragmentsRef.current;
      if (fr && fr.models.list.size) {
        const full = new THREE.Box3();
        for (const m of fr.models.list.values()) full.expandByObject(m.object);
        full.getCenter(target);
        const s = new THREE.Sphere(); full.getBoundingSphere(s);
        const dist = Math.max(3, s.radius * 3);
        const eye = target.clone().add(normal.multiplyScalar(dist));
        await world.camera.controls?.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true);
        return;
      }
      // Fallback to origin
      const dist = 10; const eye = target.clone().add(normal.multiplyScalar(dist));
      await world.camera.controls?.setLookAt(eye.x, eye.y, eye.z, 0, 0, 0, true);
    };
    navCanvas.addEventListener('click', onNavClick);

    // Cleanup
    return () => {
      (async () => {
        if (fragmentsRef.current) {
          const ids = [...fragmentsRef.current.models.list.values()].map(m => m.modelId);
          await Promise.all(ids.map(id => fragmentsRef.current!.disposeModel(id)));
        }
        if (workerUrlRef.current) URL.revokeObjectURL(workerUrlRef.current);
        // Remove any renderer canvases appended to the container
        try { container.replaceChildren(); } catch { /* no-op */ }
      })();
    };
  }, []);

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

    try {
  const modelId = `${file.name}-${Date.now()}`;
  let model: any;

      if (ext === 'ifc') {
        if (!ifcImporter) throw new Error('IFC importer is not ready.');
        const ifcBytes = new Uint8Array(await file.arrayBuffer());
        const processed = await ifcImporter.process({
          bytes: ifcBytes,
          progressCallback: (p, msg) => console.log(`IFC conversion progress: ${p.toFixed(1)}%`, msg),
        });
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
        model = await fragments.load(fragArrayBuffer, { modelId });
      } else if (ext === 'frag') {
        const fragBytes = await file.arrayBuffer();
        model = await fragments.load(fragBytes, { modelId });
      } else {
        alert('Unsupported file type. Please choose a .ifc or .frag file.');
        return;
      }

    currentModelIdRef.current = modelId;
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);

      // Ensure fragments finish building GPU buffers before computing bounds
      await fragments.update(true);
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

      setModelLoaded(true);
      setModels((prev) => [...prev, { id: modelId, label: file.name }]);
      try {
        const tree = await model.getSpatialStructure();
        setExplorerTree(tree);
        setExplorerModelId(modelId);
      } catch (e) {
        console.warn('Failed to read spatial structure', e);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load model. See console for more details.');
      setModelLoaded(false);
    } finally {
      // safe even after awaits
      if (inputEl) inputEl.value = '';
    }
  };

  const fitToCurrentModel = useCallback(async () => {
    const world = worldRef.current;
    const fragments = fragmentsRef.current;
    const id = currentModelIdRef.current;
    if (!world || !fragments || !id) return;
    const record = fragments.models.list.get(id);
    if (!record) return;

    // Ensure updates
    await fragments.update(true);
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

  // Simple picking to show properties
  useEffect(() => {
    const container = viewerRef.current; const world = worldRef.current;
    if (!container || !world) return;
    const mouse = new THREE.Vector2();
    const onClick = async (ev: MouseEvent) => {
      const fr = fragmentsRef.current; if (!fr) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      let best: { dist: number; model: any; localId: number } | null = null;
      for (const model of fr.models.list.values()) {
        const hit = await model.raycast({ camera: world.camera.three, mouse, dom: world.renderer!.three.domElement! });
        if (hit && typeof hit.distance === 'number') {
          if (!best || hit.distance < best.dist) best = { dist: hit.distance, model, localId: hit.localId } as any;
        }
      }
      if (!best) return;
      setSelected({ modelId: best.model.modelId, localId: best.localId });
      try {
        const [data] = await best.model.getItemsData([best.localId], { attributesDefault: true });
        setProperties(data || null);
      } catch {}
    };
    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
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
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.8 }}>
            {modelLoaded ? 'Model: loaded' : 'Model: none'}
          </Typography>
          <Button color="inherit" onClick={fitToCurrentModel} disabled={!modelLoaded} sx={{ mr: 1 }}>
            Fit to Model
          </Button>
          <Button color="inherit" onClick={resetView} sx={{ mr: 1 }}>
            Reset View
          </Button>
          <Button color="inherit" component="label">
            Open IFC/FRAG
            <input
              ref={fileInputRef}
              type="file"
              accept=".ifc,.IFC,.frag,.FRAG"
              hidden
              onChange={handleFileChange}
            />
          </Button>
        </Toolbar>
      </AppBar>

      <div
        ref={viewerRef}
        style={{ width: '100%', height: 'calc(100% - 64px)', background: '#151515', position: 'relative' }}
      />

      {/* Right docked panel */}
      <div className="right-panel">
        <div className="panel">
          <div className="panel-header">Fragments Models</div>
          <div className="panel-section">
            <div className="section-title">Loaded Models</div>
            {models.length ? (
              <ul className="models-list">
                {models.map((m) => (
                  <li key={m.id}>
                    <button style={{
                      background:'transparent', border:'none', padding:0, cursor:'pointer', color:'#1976d2'
                    }} onClick={async () => {
                      const fr = fragmentsRef.current; if (!fr) return;
                      const model = fr.models.list.get(m.id); if (!model) return;
                      try {
                        const tree = await model.getSpatialStructure();
                        setExplorerTree(tree);
                        setExplorerModelId(m.id);
                      } catch {}
                    }}>{m.label}</button>
                  </li>
                ))}
              </ul>
            ) : (<div className="muted">No models loaded</div>)}
          </div>
          <div className="panel-section">
            <div className="section-title">Model Explorer</div>
            {explorerTree ? (
              <div className="tree-root" style={{ maxHeight: 260, overflow: 'auto' }}>
                <ExplorerTree
                  tree={explorerTree}
                  onPick={async (localId) => {
                    const fr = fragmentsRef.current; if (!fr || !explorerModelId) return;
                    const model = fr.models.list.get(explorerModelId); if (!model) return;
                    setSelected({ modelId: explorerModelId, localId });
                    try {
                      const [data] = await model.getItemsData([localId], { attributesDefault: true });
                      setProperties(data || null);
                    } catch {}
                  }}
                />
              </div>
            ) : (
              <div className="muted">Load a model or click a model name to view its structure.</div>
            )}
          </div>
          <div className="panel-section">
            <div className="section-title">Properties</div>
            {selected ? (
              <div className="props-table">
                <div className="prop-row"><span className="k">Model</span><span className="v">{selected.modelId}</span></div>
                <div className="prop-row"><span className="k">Local ID</span><span className="v">{selected.localId}</span></div>
                {properties ? Object.entries(properties).map(([k,v]) => (
                  <div className="prop-row" key={k}><span className="k">{k}</span><span className="v">{formatVal(v)}</span></div>
                )) : <div className="muted">No properties</div>}
              </div>
            ) : (<div className="muted">Click an element to view its properties.</div>)}
          </div>
        </div>
      </div>
    </div>
  );
};

function formatVal(v: any) {
  try {
    if (v && typeof v === 'object') {
      if ('value' in v && typeof (v as any).value !== 'object') return String((v as any).value);
      return JSON.stringify(v);
    }
    return String(v);
  } catch { return String(v); }
}

// Minimal recursive explorer using <details>/<summary>
const ExplorerTree: React.FC<{ tree: any; onPick: (localId: number) => void }>
  = ({ tree, onPick }) => {
  const renderNode = (node: any) => {
    const id = typeof node.expressID === 'number' ? node.expressID : undefined;
    const label = node.name || node.type || (id != null ? `#${id}` : 'Item');
    const children: any[] = Array.isArray(node.children) ? node.children : [];
    return (
      <details open key={`${label}-${id ?? Math.random()}`}>
        <summary onClick={(e) => { e.stopPropagation(); if (id != null) onPick(id); }}>{label}{id != null ? ` (#${id})` : ''}</summary>
        {children.map((c) => renderNode(c))}
      </details>
    );
  };
  return <div>{renderNode(tree)}</div>;
};

export default App;
