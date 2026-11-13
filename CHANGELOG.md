# Changelog

## Step 4 — editor UI module

- Built on the owner-confirmed step 3 baseline: usual editor tests passed and the browser console was clear.
- Converted `js/editor-ui.js` from a classic script to an ES module loaded with dynamic `import()`.
- Added explicit module dependencies for `parseVol`, `EC`, `IA` and the viewer's `exposeViewerGlobals()` interface.
- Moved installation of viewer live accessors to the UI module, immediately before its existing UI initialisation.
- Simplified `bootstrap.js`: it no longer injects classic scripts or separately imports the viewer; the UI module's dependency graph loads the viewer in the correct order.
- Kept the existing UI implementation body unchanged. Temporary `window` compatibility remains intentionally in place and will be removed in a separate cleanup step.
- No intentional changes to level parsing, rendering, script analysis, entity editing, copying, project data or asset handling.

## Earlier steps

See the Git history and prior step archives for steps 1–3.
