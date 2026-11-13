# I-Ninja Editor v18 — dependency map (Step 10)

## Current execution model

1. `index.html` loads Three.js (CDN), `three-fallback.js`, then `bootstrap.js` as an ES module.
2. `bootstrap.js` dynamically imports `editor-ui.js` and reports startup errors on the page; it does not publish application APIs on `window`.
3. `editor-ui.js` imports parser helpers, `EC`, `IA`, `Viewer`, and the feature installers for Models, Scripts, Project Manager, Entity Editor and Prefabs. It owns the cached `getWad(w)` accessor, sound-plan service, shared project status/removal UI and volume ingestion. The dedicated Prefab module receives live project/archive services and returns the source-entity and prefab operations needed by the other modules.
4. `viewer.js` imports parser/render-data helpers from `vol-core.js` and exports the explicit `Viewer` API plus `setEntityOverlayRefresh()`.
5. `models-panel.js` imports `siWad`/`SiAn` and the viewer overlay hook. Its installer receives `Viewer`, `THREE`, `EC`, and getter/callback services for project state and WAD lookup.
6. `script-editor.js` imports `siWad`. Its installer receives `Viewer`, `IA`, `EC`, WAD lookup helpers and live getters for project/volume state; it returns the script-edit fingerprint function.
7. `project-manager.js` receives the live project getter/setter, archive lookup, volume/sound helpers and script-fingerprint callback; it owns project JSON open/save and patched VOL/AVL generation.
8. `entity-editor.js` receives live project/archive/entity mutation helpers plus prefab-placement callbacks; it owns the selected-entity inspector, transforms, register editing, copy/paste, drag placement and manual link reassignment.

## Module responsibilities

| File | State | Responsibility | Direct dependencies |
|---|---|---|---|
| `three-fallback.js` | Classic script | Existing local Three.js fallback | `window`, `document` |
| `bootstrap.js` | ES module | Application startup and error reporting | `editor-ui.js` (dynamic) |
| `vol-core.js` | ES module | VOL/BIGB/LCS parsing, model/texture/collision parsing, entity extraction, script analysis and metadata | Typed arrays, `DataView` |
| `editor-core.js` | ES module; exports `EC` | Archive/resource copying, patching, rebuilding, prefab/model helpers | Explicit imports from `vol-core.js` |
| `strat-assembler.js` | ES module; exports `IA` | Script decoding, formatting, assembly, relocation and verification | Explicit imports from `vol-core.js` |
| `viewer.js` | ES module; exports `Viewer` and overlay-refresh hook | Renderer, scene/camera, loaded files/levels, selection, script browser and inspection | Explicit imports from `vol-core.js`, global Three.js library, DOM |
| `editor-ui.js` | ES module | Application coordination, volume ingestion, shared project status/removal UI, sound-plan service and copier self-test | `vol-core.js`, `EC`, `IA`, `Viewer`, feature installers |
| `models-panel.js` | ES module; exports `installModelEditor` | Model browsing, grouping, preview, overlay assignment and drawing | `vol-core.js`, `Viewer` overlay hook, injected controller services |
| `script-editor.js` | ES module; exports `installScriptEditor` | Assembly editor UI, assembly checks, script-edit storage and fingerprints | `vol-core.js`, injected `Viewer`, `IA`, `EC`, controller services |
| `project-manager.js` | ES module; exports `installProjectManager` | Project JSON loading/saving, fingerprint checks and patched VOL/AVL generation | Injected `Viewer`, `EC`, `IA`, project accessors and archive/sound/script services |
| `entity-editor.js` | ES module; exports `installEntityEditor` | Entity inspector, transforms, register editing, remove/delete, copy/paste, drag placement and manual link reassignment | Injected `Viewer`, `EC`, project/archive/entity helpers and prefab callbacks |
| `prefabs.js` | ES module; exports `installPrefabManager` | Prefab source library, dependency reports/checks, class preparation, linked-child deep copy, and cross-level move of added groups | Injected `Viewer`, `EC`, project/archive/sound helpers and lazy entity-editor callbacks |

## Migration status

1. **Complete:** Convert `vol-core.js` to an ES module.
2. **Complete:** Convert `editor-core.js` to an ES module with explicit imports and the `EC` API.
3. **Complete:** Convert `strat-assembler.js` to an ES module with explicit imports and the `IA` API.
4. **Complete:** Convert `viewer.js` to an ES module and remove the legacy viewer-global bridge.
5. **Complete:** Load the application coordinator as an ES module.
6. **Complete:** Remove global publication of parser/editor/assembler APIs and use the explicit `Viewer` API.
7. **Complete and owner-tested:** Split the Models panel and Scripts-tab assembly editor into `models-panel.js` and `script-editor.js`.
8. **Complete and owner-tested:** Move project JSON loading/saving and patched VOL/AVL building into `project-manager.js`.
9. **Complete and owner-tested:** Move entity inspection, transforms, register editing, remove/delete, clipboard copy/paste, drag placement and manual link reassignment into `entity-editor.js`. Step 9a restored the shared Editor panel markup, Step 9b restored the cached WAD accessor and explicit injections, and Step 9d restored shared `summary()`/`rmList()` services. The project owner has confirmed the Step 9d live-browser checks pass.
10. **Complete in code; owner testing pending:** Move prefab discovery/dependency checks, prefab placement, linked-child deep copy, and cross-level movement into `prefabs.js`. Verify this step on GitHub Pages before proceeding.
11. **Later:** Add an optional single-file standalone distribution build.

## Important behaviour-preservation details

- `models-panel.js` registers `drawModels()` through `setEntityOverlayRefresh()`. This preserves immediate model-overlay updates when entity visuals rebuild, including after cross-level copies.
- The controller calls the model module's `resetCaches()` and the prefab module's `resetCaches()` when new volumes are opened. Newly loaded AVLs invalidate cached prefab dependency checks because sound-resource availability may have changed.
- The project object can be replaced when a project JSON is loaded, so feature modules receive `getProject()` rather than a stale snapshot.
- `script-editor.js` wraps the controller's existing `Viewer.openFiles` and `Viewer.scrDetail` handlers in the same order as the prior monolithic code. It returns `scriptWadsFp()` for the save/patch pipeline.
- No project schema, resource-copy logic, parser, assembler, or VOL/AVL rebuild algorithms were intentionally changed during this migration.

## Constraints

- Use GitHub Pages (HTTP(S)) to run the module build; `file://` is not supported.
- Keep paths relative so repository subpath hosting works.
- Do not combine UI-module splitting with imported-resource persistence or new game-data features.
- Keep the last owner-tested package available for rollback.

## Script editor injected services (Step 7a)

`installScriptEditor` receives `wadOf` and `isVol` from `editor-ui.js` explicitly. These helpers are scoped to the coordinator module and are not globals; modules cannot read another module's lexical declarations.

## Project manager injected services (Step 8)

`installProjectManager` receives `getProject()` and `setProject()` so opening a project replaces shared state without leaving dependent modules with stale references. Archive access (`getWad`, `volOf`), sound support (`sndPlan`, `avlLoad`, `getAvl`), and the script fingerprint callback are passed from the coordinator.


## Entity editor injected services (Step 9)

`installEntityEditor()` receives `Viewer`, `EC`, live project access, WAD lookup and project-record helpers, entity base/mutation helpers, source-entity lookup, prefab class validation/placement callbacks, link cleanup, summary/removal-list callbacks and coordinate rounding. It returns the `update()`, `rec()` and `ground()` callbacks needed by the coordinator plus narrow entity-edit helpers. The module owns clipboard, link-pick, drag and inspector state; no entity-editing globals are published.

## Coordinator WAD access (Step 9b)

`editor-ui.js` owns `getWad(w)`, backed by the `WC` parsed-WAD cache. It locates the matching loaded file in `Viewer.files`, calls `readWad(f.buf, f)`, and stores `{A, B, cls}`. The accessor is explicitly injected into Models, Scripts, Project Manager and Entity Editor. `WC` is cleared when new VOLs are ingested so parsed data cannot leak across volume replacements.


## Step 9d shared UI services

- `editor-ui.js` owns `summary()` and `rmList()` because they depend on shared project state and DOM hosts.
- `models-panel.js` receives `summary()` for overlay-assignment status updates.
- `entity-editor.js` receives `summary()` and `rmList()` for inspector refreshes and restore-removed-entity UI.


## Prefab module injected services (Step 10)

- `prefabs.js` receives the live project getter, target/source WAD lookup, parser helpers, volume/AVL state, class mutation service (`WS`) and shared sound-plan helper.
- It returns `srcEnt`, `sourceClass`, `ensureClass`, `pushAdds`, `stripLinkRegs`, `addMaxId`, `injectMoveControl`, `resetCaches` and `invalidateChecks`.
- Entity Editor receives the copy/paste services; Project Manager receives `sourceClass`; the coordinator calls `injectMoveControl()` after the entity inspector re-renders.
- Lazy callbacks for the selected entity record, ground projection and inspector update avoid a circular module dependency.
