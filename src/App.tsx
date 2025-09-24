import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import LinearProgress from '@mui/material/LinearProgress';
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
  const [nameCache, setNameCache] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<Selected>(null);
  const [properties, setProperties] = useState<Record<string, any> | null>(null);
  const [ifcProgress, setIfcProgress] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const ifcAbortRef = useRef<AbortController | null>(null);
  const ifcCancelledRef = useRef<boolean>(false);
  const navCubeRef = useRef<HTMLCanvasElement | null>(null);
  const navCubeState = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; cube: THREE.Mesh } | null>(null);
  const selectionMarkerRef = useRef<THREE.Group | null>(null);
  const prevInstanceHighlightRef = useRef<{ mesh: THREE.InstancedMesh; index: number } | null>(null);
  const highlighterRef = useRef<any>(null);

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
    // Try to set up That Open Highlighter if available in this version
    try {
      const HighlighterClass = (OBC as any).Highlighter ?? (FRAGS as any).FragmentHighlighter ?? null;
      if (HighlighterClass) {
        const hl = new HighlighterClass(components);
        // Some implementations may require setup with world; protect with try/catch
        try { hl.world = world; } catch {}
        try { hl.setup?.(world); } catch {}
        // Optional: outline enabled if supported
        try { if (hl.outlines) hl.outlines.enabled = true; } catch {}
        highlighterRef.current = hl;
      }
    } catch { /* ignore, fallback to manual coloring */ }
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
      const baseUrl = (import.meta as any).env?.BASE_URL ?? '/';
      ifcImporter.wasm = {
        path: `${baseUrl}web-ifc/`, // resolves under Pages base
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
        try { highlighterRef.current?.clear?.(); } catch {}
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
        setNameCache(new Map());
        // Debug: sample the spatial structure to understand node shapes
        try { console.debug('[Explorer] spatial structure sample:', sampleExplorerTree(tree)); } catch {}
      } catch (e) {
        console.warn('Failed to read spatial structure', e);
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
      for (const model of fr.models.list.values()) {
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
          if (fr2 && fr2.models.list.size) {
            for (const m of fr2.models.list.values()) full.expandByObject(m.object);
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
      try {
        const [data] = await best.model.getItemsData([best.localId], { attributesDefault: true });
        setProperties(data || null);
      } catch {}
    };
    const onPointerDown = async (ev: PointerEvent) => {
      if (ev.button !== 0) return; // left button only
      await pickAt(ev.clientX, ev.clientY);
    };
    const onClick = async (ev: MouseEvent) => {
      await pickAt(ev.clientX, ev.clientY);
    };
    // Use capture on pointerdown to avoid controls stopping propagation
    dom.addEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions);
    dom.addEventListener('click', onClick);
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions);
      dom.removeEventListener('click', onClick);
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
                  modelId={explorerModelId}
                  labelFor={(id, fallback) => nameCache.get(id) ?? fallback}
                  requestLabel={async (id) => {
                    if (!explorerModelId) return;
                    if (nameCache.has(id)) return;
                    const fr = fragmentsRef.current; if (!fr) return;
                    const model = fr.models.list.get(explorerModelId); if (!model) return;
                    try {
                      const [data] = await model.getItemsData([id], { attributesDefault: true });
                      const nameFromProps = extractName(data);
                      const typeText = toText((data as any)?.type);
                      const name: string = nameFromProps ?? typeText ?? `#${id}`;
                      setNameCache(prev => {
                        const next = new Map(prev);
                        next.set(id, name);
                        return next;
                      });
                    } catch {}
                  }}
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
                {properties ? (
                  <GroupedProperties props={properties} />
                ) : (
                  <div className="muted">No properties</div>
                )}
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

// Group properties into IFC Attributes and Property Sets (Psets)
const GroupedProperties: React.FC<{ props: Record<string, any> }> = ({ props }) => {
  // Heuristics: Psets often come prefixed with 'Pset_' or vendor prefixes, and many core IFC attributes use leading underscore
  const attributes: Array<[string, any]> = [];
  const psetsMap: Map<string, Array<[string, any]>> = new Map();

  for (const [k, v] of Object.entries(props)) {
    // Skip internal/empty
    if (v == null) continue;
    // Group known non-pset attributes
    const isCore = k.startsWith('_') || ['GlobalId','ObjectType','IfcClass','IfcSystem','Name','Description','Tag'].includes(k);
    // Detect pset names like 'Pset_*' or vendor prefixes like 'NV_*', 'BS_*', etc.
    const psetMatch = /^([A-Za-z]+_[A-Za-z0-9]+)(?:\.|_|:)?(.*)$/.exec(k);
    if (!isCore && psetMatch && psetMatch[1] && k.includes('_')) {
      const psetName = psetMatch[1];
      const propKey = psetMatch[2] || k.replace(psetName, '').replace(/^[_:.]/, '') || k;
      const arr = psetsMap.get(psetName) ?? [];
      arr.push([propKey || k, v]);
      psetsMap.set(psetName, arr);
    } else {
      attributes.push([k, v]);
    }
  }

  // Also accept nested Pset objects if present (e.g., props.Psets = { Pset_X: { A:1 } })
  const nestedPsets = (props as any).Psets && typeof (props as any).Psets === 'object' ? (props as any).Psets : null;
  if (nestedPsets) {
    for (const [psetName, pObj] of Object.entries(nestedPsets)) {
      const target = psetsMap.get(psetName) ?? [];
      if (pObj && typeof pObj === 'object') {
        for (const [pk, pv] of Object.entries(pObj as any)) {
          target.push([pk, pv]);
        }
      }
      psetsMap.set(psetName, target);
    }
  }

  // Render
  return (
    <div>
      <details open>
        <summary style={{ fontWeight: 600 }}>IFC Attributes</summary>
        {attributes.length ? attributes.map(([k,v]) => (
          <div className="prop-row" key={`attr-${k}`}><span className="k">{k}</span><span className="v">{formatVal(v)}</span></div>
        )) : <div className="muted">No attributes</div>}
      </details>

      {[...psetsMap.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([pset, kvs]) => (
        <details key={`pset-${pset}`} open style={{ marginTop: 8 }}>
          <summary style={{ fontWeight: 600 }}>{pset}</summary>
          {kvs.length ? kvs.map(([k,v], i) => (
            <div className="prop-row" key={`pset-row-${pset}-${i}`}><span className="k">{k}</span><span className="v">{formatVal(v)}</span></div>
          )) : <div className="muted">No properties</div>}
        </details>
      ))}
    </div>
  );
};

// Minimal recursive explorer using <details>/<summary>
const ExplorerTree: React.FC<{
  tree: any;
  modelId: string | null;
  onPick: (localId: number) => void;
  labelFor: (id: number, fallback: string) => string;
  requestLabel: (id: number) => void;
}> = ({ tree, modelId, onPick, labelFor, requestLabel }) => {
  const Node: React.FC<{ node: any }> = ({ node }) => {
    const id = getNodeId(node);
    const baseType = getTypeText(node);
    const children: any[] = Array.isArray(node.children) ? node.children : [];
    const cached = id != null ? labelFor(id, '') : '';
    React.useEffect(() => {
      if (id != null && modelId) {
        // Request name for this ID; parent will no-op if already cached
        requestLabel(id);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, modelId]);
    const key = id != null ? `${id}` : `${baseType ?? 'Group'}-${Math.random()}`;
    // Show only Name when available; otherwise show category/group fallbacks without ID
    const decorated = (() => {
      if (cached) {
        return `${cached}`;
      }
      if (id == null) {
        if (baseType && children.length) return `${baseType} (${children.length})`;
        if (baseType) return baseType;
        if (children.length) return `Group (${children.length})`;
        return 'Item';
      }
      // id present but no name yet — show only category/type without ID
      if (baseType) return `${baseType}`;
      return 'Item';
    })();

    return (
      <details open key={key}>
        <summary onClick={(e) => { e.stopPropagation(); if (id != null) onPick(id); }}>{decorated}</summary>
        {children.map((c, i) => {
          const cid = getNodeId(c);
          return <Node node={c} key={(cid != null ? cid : i)} />
        })}
      </details>
    );
  };
  return <div><Node node={tree} /></div>;
};

function getNodeId(node: any): number | undefined {
  if (!node) return undefined;
  // Direct primitives
  if (typeof node === 'number' && Number.isFinite(node)) return node;
  if (typeof node !== 'object') return undefined;
  const direct = tryParseId(node);
  if (direct != null) return direct;
  // Shallow nested scan (one level) for common wrappers
  for (const key of Object.keys(node)) {
    const v = (node as any)[key];
    if (v && typeof v === 'object') {
      const nested = tryParseId(v);
      if (nested != null) return nested;
    }
  }
  return undefined;
}

function tryParseId(obj: any): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const candidates = ['expressID', 'expressId', 'id', 'ID', 'localId', 'LocalId'];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function getTypeText(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  // Prefer category labels in fragments spatial trees
  const catRaw = (node as any).category ?? (node as any).Category ?? (node as any)._category ?? (node as any).categoryName;
  const catText = toText(catRaw?.name ?? catRaw?.type ?? catRaw?.value ?? catRaw);
  if (catText && catText.trim()) return catText;
  const typeKeys = ['type','Type','TYPE','ifcType'];
  for (const k of typeKeys) {
    const v = (node as any)[k];
    const t = toText(v);
    if (t && t.trim()) return t;
  }
  return null;
}

function sampleExplorerTree(root: any) {
  const limitChildren = 8;
  const pick = (n: any, depth = 0): any => {
    if (n == null) return n;
    if (depth > 2) return '…';
    if (typeof n !== 'object') return n;
    const id = getNodeId(n);
    const type = getTypeText(n);
    const keys = Object.keys(n);
    const children: any[] = Array.isArray((n as any).children) ? (n as any).children : [];
    return {
      id,
      type,
      keys,
      children: children.slice(0, limitChildren).map(c => pick(c, depth + 1)),
      moreChildren: Math.max(0, children.length - limitChildren)
    };
  };
  return pick(root, 0);
}

function extractName(props: any): string | null {
  if (!props) return null;
  let v: any = props.Name ?? props.name ?? props.NAME
    ?? props.LongName ?? props.longName ?? props.LONGNAME
    ?? props.ObjectType ?? props.objectType ?? props.OBJECTTYPE
    ?? props.Tag ?? props.tag ?? props.TAG
    ?? props.Description ?? props.description ?? props.DESCRIPTION
    ?? props.GlobalId ?? props.globalId ?? props.GLOBALID;
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    // Common patterns: { value: '...' } or { value: { value: '...' } }
    if (typeof v === 'object') {
      if ('value' in v) {
        const val = (v as any).value;
        if (typeof val === 'string') return val || null;
        if (val && typeof val === 'object' && 'value' in val) {
          const val2 = (val as any).value;
          if (typeof val2 === 'string') return val2 || null;
        }
        if (val != null && typeof val !== 'object') return String(val);
      }
    }
  } catch {}
  return null;
}

function toText(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    if (typeof v === 'object' && 'value' in v) {
      return toText((v as any).value);
    }
  } catch {}
  return null;
}

export default App;
