# Savora Viewer

A powerful web-based 3D viewer for BIM models with integrated IDS (Information Delivery Specification) validation and AI-powered assistance. Built with React, Vite, Three.js, and That Open Engine libraries, it runs fully in the browser and is optimized for hosting on GitHub Pages.

**All data is processed localy in the users browser PC, Phone, Tablet etc. (Exeption AI Chat, sends data to AI provider). NB: If the AI chat is not used no data leavs the users device.** 


## Features

### 🏗️ Model Viewing
- **Multi-format support**: Load IFC (`.ifc`) and Fragments (`.frag`) files directly in the browser
- **Multiple models**: Open and view multiple models simultaneously in one scene
- **3D Navigation**: Orbit, pan, zoom with mouse controls
- **Navigation cube**: Clickable cube for quick camera orientation
- **View controls**: Fit to model, reset view, and focus on selections
- **Ground grid**: Toggle grid display for better spatial orientation
- **Performance monitoring**: Built-in FPS and renderer stats overlay

### 📊 Model Explorer
- **Interactive hierarchy**: Browse spatial structure (sites, buildings, stories, spaces)
- **Model tree**: Expandable tree view of all loaded models
- **Property inspection**: Click any element to view its properties
- **Property organization**: View properties by sets (Pset, NV_BIM, etc.)
- **Favorites system**: Star frequently-used properties for quick access
- **Property search**: Real-time filtering of property lists
- **Export capabilities**: Export properties to CSV format (selection or entire model)
- **Copy functionality**: Copy raw element JSON data to clipboard
- **Draggable panel**: Resizable Model Explorer window

### ✅ IDS Checker (Validation)
- **Load IDS files**: Import IDS XML definitions for validation
- **Automated checking**: Validate models against IDS specifications
- **Summary view**: Overview of pass/fail results by rule
- **Detailed results**: Drill down into individual element validation
- **Visual feedback**: Highlight passed (green) and failed (red) elements in 3D viewer
- **Filtering**: Filter results by rule, status (pass/fail), or search term
- **Export results**: Export validation results to CSV or JSON
- **Rule isolation**: Isolate and fit camera to elements affected by specific rules
- **Unicode normalization**: Handles en-dash vs hyphen character differences

### 🔧 IDS Creator (Authoring)
- **Create IDS files**: Author IDS specifications visually from models
- **Multiple specifications**: Manage multiple specifications in one document
- **Visual capture**: Select 3D elements to capture their properties as rules
- **Applicability rules**: Define which elements specifications apply to
- **Requirement rules**: Capture property requirements with operators (equals, contains, etc.)
- **Property picker**: Browse and select specific properties from captured elements
- **Rule editing**: Edit captured requirements with custom operators and values
- **Copy functionality**: Copy applicability rules to requirements
- **Direct validation**: Validate specifications immediately without export/import
- **Customizable filenames**: Set filename in header before saving
- **Load/Save**: Import existing IDS files for editing, save as `.ids` XML

### 🤖 BIM AI Assistant
- **Natural language queries**: Ask questions about your model in plain English
- **Model analysis**: Get insights about elements, properties, and structure
- **AI-powered responses**: Leverages OpenAI GPT for intelligent answers
- **Context awareness**: AI has access to selected element properties
- **Persistent chat**: Maintain conversation history across queries
- **Draggable window**: Movable chat interface

### 🎯 User Experience
- **Floating toolbar**: Quick-access circular buttons for Explorer, IDS Checker, and IDS Creator
- **Comprehensive tooltips**: Hover hints on all buttons and controls
- **Collapsible sections**: Minimize panel sections to maximize workspace
- **Resizable panels**: Drag panel corners to resize
- **Dark theme**: Professional dark UI with Material Design components

**Tech stack**: `React`, `Vite`, `Three.js`, `@thatopen/components`, `@thatopen/fragments`, `Material-UI`, `OpenAI API`

## Prerequisites
- **Node.js 18+** (LTS recommended)
- **npm 9+**
- **OpenAI API Key** (optional, required only for AI Assistant feature)

Verify versions:

```powershell
node -v
npm -v
```

### Google Gemini API Configuration
To use the AI Assistant feature:

1. Get an API key from Google AI.
2. Configure the API key in your .env
3. The AI Assistant uses the Gemeni 2.5 light by default. You can modify the model in `ChatWindow.tsx` if needed.

## Usage Guide

### Loading Models
1. Click **Model Explorer** button in the top toolbar (or the floating circular icon in the lower-right)
2. In the Model Explorer panel, click **Open IFC / FRAG**
3. Select one or more `.ifc` or `.frag` files from your computer
4. The model(s) will load and display in the 3D viewer
5. Use **Fit to Model** to center the view on your loaded models

### Exploring Properties
1. Click any element in the 3D viewer to select it
2. The **Selection Properties** panel shows all property sets for that element
3. Switch between **Favorites** and **All Properties** tabs
4. Click the ⭐ icon next to any property to add it to favorites
5. Use the search box to filter properties by name or value
6. Click **Export** to save properties as CSV (selection or entire model)
7. Click the copy icon to copy raw element JSON to clipboard

### IDS Validation Workflow
1. Click the **IDS Checker** floating button (circular icon with checkmark)
2. Click **Load IDS XML** and select your `.ids` validation file
3. Click **Run Check** to validate the loaded model against IDS rules
4. View the **Summary** tab for pass/fail statistics by rule
5. Switch to **Details** tab to see individual element validation results
6. Use filters to narrow results by rule, status (pass/fail), or search term
7. Click the highlight icon next to any rule to visualize results in 3D (green = pass, red = fail)
8. Click any detail row to isolate and focus the camera on that element
9. Export results to CSV or JSON for reporting

### IDS Creation Workflow
1. Click the **IDS Creator** floating button (circular icon with pencil)
2. Click **Add Specification** to create a new validation rule
3. **Capture Applicability** (which elements to check):
   - Select an element in the 3D viewer
   - Click **Use current selection** under "Applicability"
   - The element's IFC class and properties are captured
4. **Capture Requirements** (what must be true):
   - Select the same or different element
   - Click **Use current selection** under "Requirements"
   - Click the edit icon to choose specific properties and set validation rules
   - In the property picker, select a property set and property name
   - Choose an operator (equals, contains, matches, etc.) and enter expected value
   - Click **Save Rule**
5. Repeat for multiple specifications as needed
6. Set the filename in the header text field (without `.ids` extension)
7. Click the **Validate** (play) button to test immediately in IDS Checker
8. Click **Save** to download the `.ids` XML file
9. Click **Load** to import and edit existing IDS files

### Using the AI Assistant
1. Click the **Chat** button in the top toolbar (or floating icon in the lower-right)
2. Ensure you have your OpenAI API key configured
3. Select an element in the 3D viewer for context (optional)
4. Type your question in natural language (e.g., "What fire rating does this wall have?")
5. The AI will analyze your model and provide answers based on element properties

### Tips & Shortcuts
- **Mouse Navigation**:
  - Left click + drag: Rotate view
  - Right click + drag: Pan view
  - Scroll wheel: Zoom in/out
  - Click element: Select and view properties

- **Panel Management**:
  - All panels are draggable by their header bar
  - Most panels are resizable by dragging the resize handle (bottom-right corner)
  - Click minimize icon to collapse panels while keeping them open
  - Close panels completely to show floating toolbar icons

- **Performance**:
  - For large models, consider using `.frag` format (pre-processed)
  - IFC conversion happens in browser and may take time for large files
  - Web Workers handle validation in background without blocking UI

- **IDS Best Practices**:
  - Start with simple specifications and test frequently
  - Use the direct validation button (▶) to test without saving
  - Filter validation results to focus on specific issues
  - Export validation results for sharing with team members

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

4) Use the toolbar buttons or Model Explorer to load models and explore features.

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

## Known Issues & Limitations
- **Memory Usage**: Multiple large models loaded simultaneously may cause memory issues in some browsers.
- **Unicode Characters**: Some property names with special characters (en-dash vs hyphen) are normalized for validation accuracy.
- **Browser Compatibility**: Best experience on Chrome/Edge. Firefox and Safari are supported but may have minor rendering differences.
- **AI Assistant**: Requires valid Google Gemini API key in .env local file and internet connection. Responses depend on API availability and rate limits.

## Troubleshooting

### Deployment Issues
- **404s for CSS/JS on GitHub Pages**:
  - Ensure `vite.config.ts` has `base: '/Fragments-AI-viewer/'` (exactly matching the repo name) and redeploy.
  
- **404 right after deploying**:
  - Pages sometimes takes a minute to publish—wait and hard refresh (Ctrl+F5).

### Model Loading Issues
  - Check browser console for specific error messages.
  
- **Properties not showing**:
  - Some IFC files may have incomplete or non-standard property structures.
  - Try clicking different elements to ensure proper selection.

### Build Issues
- **TypeScript type errors during build**:
  ```powershell
  npm i -D @types/react @types/react-dom @types/node
  ```

- **Worker or WASM errors when opened from `file://`**:
  - Always use `npm run dev` or another HTTP server; browsers restrict Workers/WASM over `file://`.

### IDS Validation Issues
- **Validation not running**:
  - Ensure model is loaded before running IDS check.
  - Check that IDS XML file is valid and follows buildingSMART IDS specification.
  
- **Elements not highlighting**:
  - Some older `.frag` files may not support highlighting.
  - Check console for warnings about highlight capabilities.

### AI Assistant Issues
- **No response from AI**:
  -  Now only availabel in local dev mode. Investigating multi user support ongoing.
  - Verify Gemini API key is correctly configured in .env local file.
  - Check browser console for API errors (rate limits, invalid key, etc.).
  - Ensure internet connection is active.



### Key Technologies
- **React 18** with TypeScript for UI components
- **Vite** for fast development and optimized production builds
- **Three.js** for 3D rendering
- **@thatopen/components** and **@thatopen/fragments** for BIM model handling
- **Material-UI (MUI)** for professional UI components
- **Zustand** for lightweight state management
- **IndexedDB** for client-side IDS data persistence
- **Web Workers** for non-blocking validation and property extraction
- **OpenAI API** for AI-powered assistance

## Roadmap

Planned features and improvements:

- [ ] **Enhanced Measurement**: Distance, area, and volume measurement tools
- [ ] **Annotations**: Add comments and markups to 3D elements
- [ ] **Comparison Mode**: Visual diff between model versions
- [ ] **Advanced IDS Editor**: Visual rule builder with drag-and-drop
- [ ] **Collaboration**: Share annotations and validation results with team
- [ ] **Custom Property Mappings**: Map non-standard property schemas
- [ ] **Performance Optimizations**: LOD (Level of Detail) and frustum culling improvements

## Contributing

Contributions are welcome! If you'd like to contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices and existing code style
- Add tooltips to new interactive elements
- Test with both IFC and FRAG files before submitting
- Update README.md if adding new features
- Ensure `npm run build` completes without errors

## Acknowledgments

Built with excellent open-source tools:
- [That Open Company](https://thatopen.com/) - `@thatopen/components` and `@thatopen/fragments`
- [Three.js](https://threejs.org/) - 3D rendering library
- [Material-UI](https://mui.com/) - React component library
- [buildingSMART](https://www.buildingsmart.org/) - IDS specification and validation
- [Web-IFC](https://github.com/ThatOpen/engine_web-ifc) - Browser-based IFC parsing

## License
This project is open source. See `LICENSE` for details.
---

**Made with ❤️ for the BIM community**
