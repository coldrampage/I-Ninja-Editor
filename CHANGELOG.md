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


## Step 11 — project-wide prefab favourites

- Added a project-wide Prefab Favourites panel to the Editor section.
- Save the selected entity as a reusable favourite with a custom name/category.
- Store source LCS + instance identity, source fingerprints, root rotation/register overrides, and linked-child preference.
- Place a favourite into the selected target level using the existing dependency validation and linked-child deep-copy path.
- Deep placement retains internal parent/child links by remapping them to the new copies.
- Added standalone prefab-library JSON import/export for reuse across projects; duplicate source/name entries are skipped on import.
- Favourite details warn when the existing 24-instance linked-copy safety limit is reached.
- Persist favourites in project JSON as the optional `prefabs` array; older projects without it load with an empty library.
- Added prefab-manager and project-manager smoke coverage for saving, placement, link rewiring, import/deduplication, deletion and project normalization.
- Bumped entry-point/coordinator cache keys to `step11-prefab-favourites`.
- No binary game-data format or patched VOL/AVL algorithm changes.
