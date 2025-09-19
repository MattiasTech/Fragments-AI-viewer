import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import * as THREE from 'three';

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

    // Remove previous model
    if (currentModelIdRef.current) {
      await fragments.disposeModel(currentModelIdRef.current);
      currentModelIdRef.current = null;
    }

    try {
      const modelId = 'model_1';
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
        style={{ width: '100%', height: 'calc(100% - 64px)', background: '#151515' }}
      />
    </div>
  );
};

export default App;
