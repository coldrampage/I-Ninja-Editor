# Changelog — Step 10

- Added `prefabs.js` as a dedicated ES module for prefab discovery, class/resource dependency checks, prefab placement, linked-child deep copy, and cross-level movement of added linked groups.
- Moved source-entity lookup, source-link parsing/cache, and prefab/dependency caches into the new module.
- Injected the prefab manager's narrow services into Entity Editor and its source-class lookup into Project Manager.
- Kept the sound-plan helper in the coordinator because both prefab validation and patched VOL/AVL export use it.
- Added prefab cache reset on new VOL loads and dependency-check invalidation on new AVL loads.
- Added `tests/prefabs-smoke.mjs` and regression assertions for the new module boundary.
- Bumped GitHub Pages cache versions to `step10-prefab-module`.
- No intended project-schema or game-data algorithm changes.

## Prior Step 9d

- Restored the shared `summary()` and `rmList()` coordinator services. The project owner has since confirmed the Step 9d live-browser checklist passes.
