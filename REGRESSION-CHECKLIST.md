# I-Ninja Editor v18 — regression checklist

## Recorded baseline before ES-module migration

Copier self-test (`10.vol`), as reported by the project owner:

- Class pairs copied: **224 / 236**.
- Copy identical to source: **224 / 224**.
- Same structure as target level's own copy: **221 / 224**.
- Patched WAD well-formed: **224 / 224**.
- Excluded pairs: **12**, due to resource-leaf or data-structure differences.

The 12 exclusions are retained as compatibility safeguards; they are not treated as copier failures. The three target-structure mismatches remain diagnostic items to investigate separately.

## ES-module step 2 checks

Owner-reported GitHub Pages verification after step 2:

- [x] Copier self-test matched the recorded baseline.
- [x] Additional barrels were copied between levels.
- [x] A patched `.vol` was rebuilt and appeared to work as expected.

Node checks performed during packaging:

- [x] `node --check` passes for all JavaScript files.
- [x] `vol-core.js`, `editor-core.js` and `strat-assembler.js` import successfully as modules.
- [x] Core named exports, `EC` public methods and `IA` public methods are present.
- [x] GitHub Pages starts and the copier test matches the recorded baseline (owner-reported).
- [x] Additional barrel copies and patched `.vol` rebuild appear to work (owner-reported).
- [ ] Assembly self-test result recorded.

## Browser regression checks

### Loading and viewing

- [ ] Open the editor and confirm there are no startup errors in the browser console.
- [ ] Load the same VOL/AVL set used with the original editor.
- [ ] Load the same level(s) and confirm geometry, textures, collision display and entity points appear.
- [ ] Switch between 3D view and Scripts view.
- [ ] Search/filter the Models list and change model-group selections.
- [ ] Select an entity, inspect its script/registers, and navigate to it in the 3D view.

### Entity and resource operations

- [ ] Copy an entity from one level to another.
- [ ] Confirm its model and texture dependencies are copied correctly.
- [ ] Confirm its sound dependencies are copied correctly where applicable.
- [ ] Confirm script/class reassignment and linked-entity references behave correctly.
- [ ] Move, rotate and edit registers on a copied entity.
- [ ] Reopen the source level and confirm the original entity remains unchanged.

### Project and export operations

- [ ] Save a project JSON, close/reload the project, and confirm edits remain.
- [ ] Build patched VOL/AVL output and confirm it can be reopened by the editor.
- [ ] Confirm untouched files/resources are retained.
- [ ] Confirm the original game archives are not modified.

## Change discipline

For each migration step, change one module boundary at a time, run relevant checks, and keep the previous known-good ZIP available for rollback. Do not combine module conversion with new feature work or binary-format changes.


## Step 3 — viewer ES-module conversion

Packaging checks:
- [x] `node tests/viewer-module-smoke.mjs` passes: viewer module initialises against lightweight DOM/Three.js mocks and its legacy bridge exposes 27 checked names with live setter behaviour.
- [x] All JS syntax checks pass.
- [ ] Full browser and game-data regression checks below remain to be performed by the project owner.

Repeat on GitHub Pages:
- [ ] Editor starts and `document.documentElement.dataset.editorReady` becomes `true`.
- [ ] Browser console has no module import / `ReferenceError` / global bridge errors.
- [ ] Open `10.vol` and load several levels.
- [ ] 3D geometry, collision, trigger outlines, points, labels and camera controls work.
- [ ] Scripts tab search, class detail, entity links and message navigation work.
- [ ] Entity inspector and editor panel still work; position/register/link edits update the scene.
- [ ] Model viewer opens, filters, previews and assigns overlays.
- [ ] Copier self-test remains at the established step-2 baseline (224/236, 224/224 source-identical, 221/224 structure-identical, 224/224 well-formed WADs; 12 excluded pairs).
- [ ] Copy multiple barrels across levels, rebuild the `.vol`, and verify in-game.

## Step 4 — editor UI ES-module conversion

Packaging checks:
- [ ] All JavaScript files pass syntax checks.
- [ ] `editor-ui.js` imports `parseVol`, `EC`, `IA` and `exposeViewerGlobals` from the intended modules.
- [ ] `bootstrap.js` dynamically imports the UI module and no longer injects `editor-ui.js` as a classic script.
- [ ] No classic-script loader remains in the application startup.

Repeat on GitHub Pages:
- [ ] Editor starts and `document.documentElement.dataset.editorReady` becomes `true`.
- [ ] Browser console has no module import, `ReferenceError`, or startup errors.
- [ ] 3D viewer, Scripts tab, entity inspector, Models panel and overlay assignments behave as before.
- [ ] Copier self-test matches the established baseline (224/236 copied; 224/224 source-identical; 221/224 target-structure-identical; 224/224 well-formed; 12 excluded pairs).
- [ ] Copy several barrels, rebuild a patched `.vol`, and verify it behaves as expected.

Node checks for step 4:
- [x] `node tests/viewer-module-smoke.mjs` passes.
- [x] `node tests/module-global-binding-smoke.mjs` passes.
- [x] Core, editor and assembler modules import successfully; 57 Core exports, `EC`, and `IA` are present.
- [x] All `js/*.js` files pass `node --check`.
- [x] HTML entry points remain identical and reference the relative module bootstrap.


## Step 4a — cross-level model overlay refresh fix

Owner-reported issue in step 4: an instance copied from another level could be present in the project and in the patched VOL, but its model overlay did not appear in the live viewer until the VOL was reloaded.

Fix in this build:
- The viewer exposes `setEntityOverlayRefresh()` as an explicit module callback.
- The editor UI registers `drawModels()` with that callback instead of replacing the viewer's global `buildEnts` function.
- Entity visual rebuilds now notify the overlay renderer, including the no-visible-entities branch.

Repeat on GitHub Pages:
- [ ] Load two levels whose models are available from their respective level data.
- [ ] Copy an object with a visible model from one level into the other.
- [ ] Confirm its model appears immediately without reloading/reopening the VOL.
- [ ] Move or rotate the copied object and confirm its model overlay follows it.
- [ ] Rebuild the patched VOL and confirm the in-game result remains correct.
- [ ] Re-run the copier self-test and compare with the established baseline.


## Step 5 — remove parser/editor/assembler globals

Packaging checks:
- [x] `bootstrap.js` no longer assigns `vol-core.js`, `EC`, or `IA` APIs to `window`.
- [x] `viewer.js` explicitly imports its 12 `vol-core.js` dependencies.
- [x] `editor-ui.js` explicitly imports its 9 `vol-core.js` dependencies plus the `EC` and `IA` modules.
- [x] All JavaScript files pass `node --check`.
- [x] Viewer smoke test passes with no parser/editor/assembler globals pre-populated.
- [x] Existing live viewer accessor and model-overlay refresh smoke checks still pass.

Repeat on GitHub Pages:
- [ ] Start the editor and confirm there are no startup/import errors.
- [ ] Confirm the parser/editor/assembler APIs are not published as `window.parseVol`, `window.EC`, or `window.IA` (run `Object.keys(window).filter(k => ['parseVol','EC','IA'].includes(k))` in the console; expected result: `[]`).
- [ ] Repeat the normal viewer, Scripts, Models, entity-copy and patched-VOL tests.
- [ ] Confirm cross-level model overlays still appear immediately after copying, without reloading the VOL.

The temporary viewer compatibility surface is still intentional in this step; only the parser/editor/assembler global bridge has been removed.


## Step 6 — explicit viewer API and global bridge removal

Packaging checks:
- [x] All JavaScript files pass syntax checks.
- [x] `editor-ui.js` contains no free references to the former viewer-global identifiers (scope-aware Acorn scan).
- [x] `viewer.js` no longer exports or invokes `exposeViewerGlobals()`.
- [x] `Viewer` live getters/setters pass the Node smoke test.
- [x] Former viewer bridge names are not added to `globalThis` by the viewer module.
- [x] Model overlay refresh callback remains functional.
- [x] Inspector close and entity-navigation actions use delegated event handling.

Repeat on GitHub Pages:
- [ ] Editor starts and `document.documentElement.dataset.editorReady` becomes `true`.
- [ ] No console errors; verify there are no missing `Viewer` API properties.
- [ ] Select an entity, inspect its script/registers, close the inspector, and navigate via linked-register and referenced-by links.
- [ ] Confirm the Scripts tab's class links and message navigation still work.
- [ ] Verify Models panel, overlay assignments, and immediate overlay refresh after cross-level copying.
- [ ] Copier self-test remains at the established baseline (224/236 copied; 224/224 source-identical; 221/224 target-structure-identical; 224/224 well-formed; 12 excluded pairs).
- [ ] Copy several barrels, rebuild a patched `.vol`, and verify it behaves as expected.

## Step 6 — owner-reported final verification

The project owner reported that the following all worked on GitHub Pages with no console errors:

- [x] Copied a box across levels; the model overlay appeared immediately.
- [x] Patched VOL rebuilt successfully.
- [x] Editor updated correctly.
- [x] Link display and link reassignment worked.
- [x] Models page worked.

## Step 7 — split UI feature modules

Packaging checks:
- [x] `editor-ui.js` reduced from 441 to 243 lines by moving Models and Scripts UI into separate modules.
- [x] `models-panel.js` exports `installModelEditor()` and uses live project access plus an explicit model-cache reset API.
- [x] `script-editor.js` exports `installScriptEditor()` and returns the script-edit fingerprint callback.
- [x] All JavaScript files pass `node --check`.
- [x] `node tests/viewer-module-smoke.mjs` passes.
- [x] `node tests/module-global-binding-smoke.mjs` passes.
- [x] `node tests/feature-modules-smoke.mjs` passes.
- [ ] Full interactive GitHub Pages and game-data tests remain to be performed by the project owner.

Repeat on GitHub Pages:
- [ ] Editor starts with no console errors.
- [ ] Model viewer opens, filters, previews, groups and assigns overlays.
- [ ] A copied object with a model from another level displays immediately without reloading the VOL.
- [ ] Scripts tab assembly editor opens for a class, checks, saves, reloads and removes a code edit.
- [ ] Project JSON save/load preserves model assignments and script edits.
- [ ] Build patched VOL still works; sound-copy/AVL path remains unaffected.
- [ ] Copier self-test remains at its established baseline: 224/236 copied; 224/224 source-identical; 221/224 target-structure-identical; 224/224 well-formed; 12 excluded pairs.
- [ ] Repeat actual cross-level barrel/box copy and rebuild checks.

## Step 7a — Scripts assembly editor regression

- [ ] Open Scripts tab and select a class with a code block.
- [ ] Confirm the assembly editor details section appears beneath the class details.
- [ ] Confirm no `wadOf is not defined` or `isVol is not defined` errors appear in the console.
- [ ] Load the original `.vol` and confirm the assembly code editor, Check, Save, and self-test controls appear as before.


## Step 8 — project manager module regression checks

- [ ] Open an editor project through the Editor panel's `open project` button.
- [ ] Open a script-info JSON through the normal file picker and confirm it is still handled by the viewer's original loader.
- [ ] Confirm opening an editor project updates the current project rather than leaving Models/Scripts panels on stale project state.
- [ ] Run `Save project` with a base VOL loaded; this is a module-boundary check only, not a validation of the legacy project format.
- [ ] Build a patched VOL and, where copied sounds are involved, confirm the paired patched AVL is produced.
- [ ] Repeat copier self-test, cross-level model copy/refresh, link display/reassignment and model-page checks.


## Step 8 — owner-reported verification

The project owner reported all six checks passed: editor opened without console errors; levels/models loaded; Scripts assembly editor opened; objects copied and links reassigned; copier self-test ran; patched VOL rebuilt.

## Step 9 — entity editor module

Packaging checks:
- [x] All `js/*.js` files pass `node --check`.
- [x] `node tests/entity-editor-smoke.mjs` passes.
- [x] Viewer, global-binding, feature-module and project-manager smoke tests pass.
- [x] Entity inspector renders from an explicit module installer.
- [x] Entity position changes update the entity record, project-relative offset and viewport.
- [x] Entity copy/paste creates and selects a project-added instance in the smoke test.
- [x] Ground projection remains exposed for the prefab add control.
- [x] Manual link-pick and keyboard handlers install without publishing entity state globally.
- [ ] Full interactive browser/game-data checks remain for the project owner.

Repeat on GitHub Pages:
- [ ] Editor starts without console errors.
- [ ] Select an entity; verify position, yaw, pitch, roll, nudge and register controls.
- [ ] Copy/paste an entity in the same level and across levels.
- [ ] Confirm copied model overlays appear immediately after cross-level copying.
- [ ] Test G-drag placement on the ground plane.
- [ ] Test manual link reassignment, link reset and Escape cancellation.
- [ ] Remove an original entity with no referrers and delete a project-added entity.
- [ ] Test adding a prefab through the existing prefab dropdown; ground placement should still work.
- [ ] Verify linked child/deep-copy and moving an added linked group still work.
- [ ] Copier self-test remains at the recorded baseline (224/236 copied; 224/224 source-identical; 221/224 target-structure-identical; 224/224 well-formed; 12 excluded pairs).
- [ ] Rebuild patched VOL (and AVL if sound resources are involved).


## Step 9a startup regression

- [ ] On initial startup, the Editor panel appears under the level-loading controls.
- [ ] No `Cannot set properties of null (setting 'onfocus')` error is shown.
- [ ] Open Project, Save Project, Build Patched VOL, Models, and Copier Self-test buttons are present.
- [ ] Prefab target-level/class selectors and Add button are present.
- [ ] Selecting an entity displays the inspector in the editor panel.
- [ ] Models and Scripts feature modules initialise successfully.

## Step 9b — cached WAD accessor regression

Packaging checks:
- [x] All JavaScript files pass `node --check`.
- [x] Startup smoke test asserts `getWad(w)` is defined in `editor-ui.js`.
- [x] Startup smoke test asserts `getWad` is injected into Models, Scripts, Project Manager and Entity Editor.
- [x] Startup smoke test confirms the parsed-WAD cache is reset when new volumes are opened.
- [x] All existing Node smoke tests pass.

Repeat on GitHub Pages:
- [ ] No `ReferenceError: getWad is not defined` at startup.
- [ ] Models tab and overlay assignments work.
- [ ] Scripts tab and assembly editor appear.
- [ ] Levels and object models load into the editor.
- [ ] Copier self-test and patched VOL build buttons are present and work.
- [ ] Copy objects across levels, reassign links, and rebuild a patched VOL.



## Step 9c — cache/deployment verification

- [x] `editor-ui.js` defines the cached `getWad(w)` accessor before installer calls.
- [x] The accessor is injected into Models, Scripts, Project Manager and Entity Editor.
- [x] `index.html` version-pins the bootstrap module URL.
- [x] `bootstrap.js` version-pins the coordinator module URL.
- [ ] Browser console confirms the expected coordinator loads without `ReferenceError: getWad is not defined`.


## Step 9d — shared UI service regression

Packaging checks:
- [x] `summary()` is defined in `editor-ui.js` before feature installers run.
- [x] `rmList()` is defined in `editor-ui.js` before feature installers run.
- [x] Models receives `summary()`.
- [x] Entity Editor receives `summary()` and `rmList()`.
- [x] Startup smoke test asserts the definitions and injections.
- [x] Cache-busting query versions updated for this package.

Repeat on GitHub Pages (`test` branch):
- [ ] No startup `ReferenceError` for `summary` or `rmList`.
- [ ] Models tab opens and overlay assignment updates project summary.
- [ ] Entity inspector opens and project summary updates after edits/copies.
- [ ] Remove an entity, confirm it appears in the removed list, then Restore it.
- [ ] Repeat copier self-test and patched VOL build.


## Step 10 — Prefab System module

Packaging checks:
- [x] `prefabs.js` exports `installPrefabManager()` and imports no coordinator globals.
- [x] Prefab source lookup, dependency reporting, dry-run class transplant, linked-child copying and cross-level move logic are owned by the new module.
- [x] Entity Editor receives prefab copy/paste callbacks from the module.
- [x] Project Manager receives its source-class lookup from the module.
- [x] New VOL loads reset prefab/source/link caches; new AVL loads invalidate dependency-check results.
- [x] All JavaScript files pass `node --check`.
- [x] All nine Node smoke-test suites pass, including `tests/prefabs-smoke.mjs`.
- [ ] Interactive GitHub Pages testing remains for the project owner.

Repeat on GitHub Pages (`test` branch):
- [ ] Editor starts without console errors; Models and Scripts tabs still appear.
- [ ] Load a volume containing multiple `.LCS` levels and open at least two levels.
- [ ] Open the prefab dropdown and confirm it lists classes from the target level and other loaded levels.
- [ ] Select a prefab whose class already exists in the target level; confirm the dependency report and Add placement work.
- [ ] Select a prefab whose class is missing in the target level; confirm the dry-run check reports whether its class/resources can be copied.
- [ ] Add a copyable missing-class prefab and verify the target project's class dependencies are prepared.
- [ ] Test with and without the paired `.avl` loaded when the prefab uses sound resources; missing sound archives should produce a clear reason.
- [ ] Enable “also copy the objects it links to”, place a spawner and verify its linked objects are copied as separate objects with their internal links rewired.
- [ ] Move an added object to another level and verify the object and any linked group move together, with links intact.
- [ ] Copy/paste an object across levels from the Entity Inspector; confirm class checks and link cleanup still work.
- [ ] Re-run copier self-test and rebuild a patched `.vol`; compare with the Step 9d baseline.

## Step 9d — owner-reported live verification

The project owner reported all seven checks passed on GitHub Pages: editor startup without console errors; Models tab; Scripts assembly editor; Entity Inspector and project summary; remove/Restore; copier self-test; and patched VOL build.
