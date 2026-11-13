# I-Ninja Editor v18 — source dependency map and migration state

The five application files retain the original dependency relationships described below. The first ES-module conversion step makes `vol-core.js` an actual module and uses `bootstrap.js` as a temporary bridge so the still-classic scripts continue to see its API.

## Current execution model

1. `three-fallback.js` runs as a classic script after the Three.js CDN script.
2. `bootstrap.js` runs as an ES module and imports `vol-core.js`.
3. The bootstrap copies the exported core API onto `window` and then loads the remaining classic scripts sequentially: `viewer.js`, `editor-core.js`, `strat-assembler.js`, `editor-ui.js`.
4. This preserves the original execution order and classic-script global environment while establishing the first explicit module boundary.

## Main responsibilities and dependencies

| File | Current state | Responsibility | Depends on |
|---|---|---|---|
| `three-fallback.js` | Classic script | Supplies local Three.js fallback | `window`, `document` |
| `bootstrap.js` | ES module | Imports core API, exposes temporary compatibility bridge, loads legacy scripts | `vol-core.js` |
| `vol-core.js` | ES module | VOL/BIGB/LCS parsing, model/texture/collision parsing, entity extraction, script analysis and metadata | Browser typed arrays and `DataView` |
| `viewer.js` | Classic script | Renderer, scene/camera, loaded files/levels, selection, script browser and inspection | `THREE`, core API globals and DOM |
| `editor-core.js` | Classic script, IIFE API `EC` | Archive/resource copying, patching, rebuilding and prefab/model helpers | Core API globals |
| `strat-assembler.js` | Classic script, IIFE API `IA` | Script decoding, formatting, assembly, relocation and verification | `SI_OPS`, `SI_CAT`, `fixups`, `siCstr` |
| `editor-ui.js` | Classic script | Project state, entity edits, prefab copying, register/link editing, model assignment and UI | Core globals, viewer globals, `EC`, `IA`, DOM |

## Migration sequence

1. **Complete:** Convert `vol-core.js` to an ES module while leaving its algorithms unchanged. The named exports are temporarily bridged onto `window` for legacy consumers.
2. Convert `editor-core.js` to a module with explicit imports from `vol-core.js`; retain its public `EC` API during this step.
3. Convert `strat-assembler.js` to a module with explicit imports from `vol-core.js`; retain its public `IA` API.
4. Convert the viewer to a module and establish a narrow interface for state/actions consumed by the editor UI.
5. Convert `editor-ui.js` last, replacing its current direct global dependencies with explicit imports.
6. Remove the temporary `window` bridge and produce a bundled standalone HTML distribution build if still desired.

## Important constraints

- ES modules require HTTP(S) in common browsers; use GitHub Pages for the hosted development build. Opening `index.html` via `file://` is not a supported test path for this build.
- Keep relative file paths so repository subpath hosting works.
- Module code runs in strict mode. When viewer/editor scripts are migrated, replace accidental implicit globals such as `onresize = rs` with explicit `window` properties or event listeners.
- Do not combine module conversion with parser changes, project format changes, imported-resource persistence, or new features.
