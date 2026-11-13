# I-Ninja Editor v18 — dependency map and migration state

## Current execution model (ES-module step 4)

1. `index.html` loads Three.js (CDN), `three-fallback.js`, then `bootstrap.js` as an ES module.
2. `bootstrap.js` statically imports `vol-core.js`, `editor-core.js` and `strat-assembler.js`, then temporarily publishes their public APIs on `window` for code not yet migrated away from global names.
3. `bootstrap.js` dynamically imports `editor-ui.js`.
4. `editor-ui.js` statically imports `parseVol`, `EC`, `IA` and `exposeViewerGlobals`.
5. The `editor-ui.js` dependency graph evaluates `viewer.js` after the core bridge is ready. The UI module then installs the viewer's live compatibility accessors and starts the existing editor UI.

## Responsibilities and dependencies

| File | State | Responsibility | Direct dependencies |
|---|---|---|---|
| `three-fallback.js` | Classic script | Existing local Three.js fallback | `window`, `document` |
| `bootstrap.js` | ES module | Module startup and temporary core compatibility bridge | `vol-core.js`, `editor-core.js`, `strat-assembler.js`, `editor-ui.js` (dynamic) |
| `vol-core.js` | ES module | VOL/BIGB/LCS parsing, model/texture/collision parsing, entity extraction, script analysis and metadata | Browser typed arrays and `DataView` |
| `editor-core.js` | ES module; exports `EC` | Archive/resource copying, patching, rebuilding, prefab/model helpers | Explicit imports from `vol-core.js` |
| `strat-assembler.js` | ES module; exports `IA` | Script decoding, formatting, assembly, relocation and verification | Explicit imports from `vol-core.js` |
| `viewer.js` | ES module | Renderer, scene/camera, loaded files/levels, selection, script browser and inspection; exports live compatibility accessors | `THREE`, temporary core globals, DOM |
| `editor-ui.js` | ES module | Project state, entity edits, prefab copying, register/link editing, model assignment and UI | Explicit module imports plus temporary `window` compatibility accessors for legacy identifiers |

## Migration sequence

1. **Complete:** Convert `vol-core.js` to an ES module.
2. **Complete:** Convert `editor-core.js` to an ES module with explicit imports and the existing `EC` API.
3. **Complete:** Convert `strat-assembler.js` to an ES module with explicit imports and the existing `IA` API.
4. **Complete:** Convert `viewer.js` to an ES module with a temporary live compatibility interface.
5. **Complete:** Load `editor-ui.js` as an ES module and establish its module dependencies explicitly. Its implementation still uses the temporary global compatibility surface to avoid a behaviour-changing rewrite.
6. **Next:** Replace the UI's remaining bare global references with explicit `Core`, `Viewer`, `EC` and `IA` module APIs; remove the temporary global bridge and viewer accessors.
7. **Later:** Add a single-file standalone distribution build if desired.

## Constraints

- Use GitHub Pages (HTTP(S)) to run the module build; `file://` is not a supported test path.
- Keep paths relative so repository subpath hosting works.
- Do not combine the module cleanup with parser changes, project-format changes, imported-resource persistence or new features.
- Keep the last known-good archive available for rollback.

## Step 4 — editor UI module boundary

`bootstrap.js` initialises the core compatibility surface, then dynamically imports `editor-ui.js`. The UI module statically imports the core parser entry point, `EC`, `IA` and `exposeViewerGlobals`. This causes the viewer module to evaluate after the core bridge is ready. The UI module installs the viewer's live accessors before entering the preserved UI IIFE.

The UI implementation body is intentionally unchanged in this step. Its free identifiers continue to resolve through the browser's global object environment, where the compatibility accessors and core API bridge are installed. The next cleanup step will replace those names with explicit module API references and remove the compatibility surface.
