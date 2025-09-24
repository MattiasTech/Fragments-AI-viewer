# Fragments AI Viewer

A lightweight web-based 3D viewer for BIM models that supports both IFC (`.ifc`) and Fragments (`.frag`) files. Built with React, Vite, Three.js, and That Open Engine libraries, it runs fully in the browser and is optimized for hosting on GitHub Pages.

## What this viewer does
- Loads and displays IFC and FRAG models directly in the browser (no backend).
- Supports multiple models in one scene; you can open additional files at any time.
- Navigation and orientation tools: orbit/pan/zoom, ground grids, and a clickable navigation cube to snap views.
- Fit/Reset/Open controls to quickly center and manage the view.
- 3D picking: click model elements to view basic property data.
- Model explorer and simple properties panel to browse the spatial structure.
- Performance overlay (FPS, renderer stats) for quick diagnostics.

Tech stack: `React`, `Vite`, `three`, `@thatopen/components`, `@thatopen/fragments`, `MUI`.

## Prerequisites
- Node.js 18+ (LTS recommended)
- npm 9+

Verify versions:

```powershell
node -v
npm -v
```

## Install and run locally
1) Install dependencies:

```powershell
npm install
```

2) Start the dev server:

```powershell
npm run dev
```

3) Open the app (Vite will print the local URL, commonly `http://localhost:5173`).

4) Use the top bar to `Open` models (`.ifc` or `.frag`), `Fit` the view, or `Reset` the camera.

## Build for production
Generate a static build in the `dist/` folder:

```powershell
npm run build
```

Optionally preview the build locally:

```powershell
npm run preview
```

## Deploy to GitHub Pages
This project is preconfigured to deploy to GitHub Pages using the `gh-pages` branch.

- Vite base path is set to the repo subpath in `vite.config.ts`:
  - `base: '/Fragments-AI-viewer/'`
- Web-IFC assets are located at `public/web-ifc/` and are referenced using the Vite base URL at runtime.

Deploy steps:

1) Ensure your repo exists on GitHub and your local branch is pushed.
2) Build and publish the site to `gh-pages`:

```powershell
npm run deploy
```

3) Configure GitHub Pages (one-time):
   - On GitHub: `Settings` → `Pages`
   - Build and deployment → Source: `Deploy from a branch`
   - Branch: `gh-pages` and Folder: `/ (root)`

4) Your site will be available at:
   - `https://<your-username>.github.io/Fragments-AI-viewer/`
   - For this repo: `https://mattiastech.github.io/Fragments-AI-viewer/`

Notes:
- If you fork or rename the repository, update `base` in `vite.config.ts` to match the new repo name, then `npm run build` and `npm run deploy` again.
- If you switch to a custom domain, set `base: '/'` and configure your DNS and a `CNAME` file in the `public/` folder (advanced).

## Troubleshooting
- 404s for CSS/JS on GitHub Pages:
  - Ensure `vite.config.ts` has `base: '/Fragments-AI-viewer/'` (exactly matching the repo name) and redeploy.
- IFC import fails:
  - Confirm `public/web-ifc/web-ifc.wasm` and `public/web-ifc/web-ifc-api.js` exist. They’re required for parsing IFC.
- TypeScript type errors during build:
  - Run:

```powershell
npm i -D @types/react @types/react-dom @types/node
```

- 404 right after deploying:
  - Pages sometimes takes a minute to publish—wait and hard refresh (Ctrl+F5).
- Local dev shows Worker or WASM errors when opened from `file://`:
  - Always use `npm run dev` or another HTTP server; browsers restrict Workers/WASM over `file://`.

## Project structure (key files)
- `src/` — React app source (viewer logic, scene setup, loaders, picking, UI)
- `public/web-ifc/` — Web-IFC WASM and API shim used by the IFC importer
- `vite.config.ts` — Vite configuration (includes GitHub Pages base path)
- `index.html` — App entry HTML

## License
This project is open source. See `LICENSE` for details.
