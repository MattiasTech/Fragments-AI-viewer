# Savora Viewer

A powerful web-based 3D viewer for BIM models with integrated IDS (Information Delivery Specification) validation and AI-powered assistance. Built with React, Vite, Three.js, and That Open Engine libraries, it runs fully in the browser and is optimized for hosting on GitHub Pages.

**All data is processed locally in the user's browser (PC, phone, tablet, etc.). Exception: AI Chat sends data to the configured AI provider. If AI Chat is not used, no model data leaves the user's device.** 

## Recent Changes

- **Grid alignment fixes (ThatOpen coordinates):** Grid placement now follows That Open's IFC coordinate system using `model.getCoordinates()` so grids align precisely with IFC storey elevations.
- **Grid controls updated:** Grid settings use a visibility toggle and an offset slider (no color picker). You can select storeys and apply an offset from the storey bottom.
- **IDS "Visible only" fixed:** The IDS checker now correctly runs when validating only visible elements; viewer fallbacks ensure checks proceed when visibility queries return empty by default.
- **Debug logs removed:** Development console logs used during debugging were cleaned up for a quieter console in production builds.
- **Bumped version:** Package version set to `0.2.2` (see `package.json`).

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
2. Ensure you have your Google Gemini or OpenAI API key configured
3. Select an element in the 3D viewer for context (optional)
4. Type your question in natural language (e.g., "What fire rating does this wall have?")
5. The AI will analyze your model and provide answers based on element properties

### Tips & Shortcuts
- **Mouse Navigation**:
  - Left click + drag: Rotate view
  - Right click + drag: Pan view
  - Scroll wheel: Zoom in/out
  - Scroll wheel cklick: Pan view
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

```powershell
npm run deploy
```

## Known Issues & Limitations
- **Memory Usage**: Multiple large models loaded simultaneously may cause memory issues in some browsers.
- **Unicode Characters**: Some property names with special characters (en-dash vs hyphen) are normalized for validation accuracy.
- **Browser Compatibility**: Best experience on Chrome/Edge. Firefox and Safari are supported but may have minor rendering differences.
- **AI Assistant**: Requires valid Google Gemini API key or OpenAI API key and internet connection. Responses depend on API availability and rate limits.

## Troubleshooting

### Model Loading Issues
  - Check browser console for specific error messages.
  
- **Properties not showing**:
  - Some IFC files may have incomplete or non-standard property structures.
  - Try clicking different elements to ensure proper selection.

### IDS Validation Issues
- **Validation not running**:
  - Ensure model is loaded before running IDS check.
  - Check that IDS XML file is valid and follows buildingSMART IDS specification.
  
- **Elements not highlighting**:
  - Some older `.frag` files may not support highlighting.
  - Check console for warnings about highlight capabilities.

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

- [ ] **QTO**: Extract QTO from the model and add cost and labor hours.

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
