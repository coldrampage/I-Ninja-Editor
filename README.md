# I-Ninja Editor v18 — staged ES-module migration (Step 10: Prefab System)

This build continues from the Step 9d package, which the project owner has now tested successfully on GitHub Pages. Step 10 moves prefab discovery and dependency checks, linked-object deep copying, and cross-level movement into a dedicated `prefabs.js` module.

## What moved

- Prefab source discovery across loaded `.LCS` files, including sources from levels not currently open in the 3D view.
- Per-class dependency reports and dry-run checks for copying missing classes/resources into the target level.
- Prefab placement through the existing target-level/class dropdown and Add button.
- Optional deep copy of linked child objects, including rewiring links between the copied objects.
- Cross-level movement of an added object and its linked group, including target-class checks and link cleanup.
- The prefab module's source-entity lookup and caches.

`editor-ui.js` remains the coordinator and injects the live archive/project services. `entity-editor.js` receives the narrow prefab callbacks it already needs for paste and ID allocation. The sound-plan helper remains in the coordinator because both prefab dependency checks and patched VOL/AVL export use it.

## Behaviour-preservation details

- The Editor panel markup is still inserted before any prefab handlers are attached.
- The prefab module exposes cache reset/invalidation functions; new VOLs clear prefab source/link/dependency caches, and newly loaded AVLs invalidate dependency-check results.
- The `ed_lv`, `ed_cl`, `ed_add`, and `ed_deep` controls retain their existing IDs and behaviour.
- Entity copy/paste continues to use the prefab module's `ensureClass`, `pushAdds`, `stripLinkRegs`, `addMaxId`, and `srcEnt` services.
- The project schema, class-transplant algorithm, sound-resource logic, parser, copier, and VOL/AVL rebuilding algorithm were not intentionally changed.
- The bootstrap cache query was bumped to `step10-prefab-module`.

## Automated checks

Run from the project root with Node.js:

```sh
for f in js/*.js; do node --check "$f"; done
for t in tests/*.mjs; do node "$t"; done
```

The Step 10 package passes all nine Node smoke-test suites, including the new `tests/prefabs-smoke.mjs` test and updated startup/deployment boundary checks. This does not replace the interactive GitHub Pages test below.

## Owner verification still required

Use this package on the GitHub `test` branch, not `main`. Repeat the prefab-specific checks in `REGRESSION-CHECKLIST.md`, especially source discovery, dependency validation, missing-class copying, linked-child deep copy, and cross-level movement. Keep the Step 9d package available for rollback until those checks pass.
