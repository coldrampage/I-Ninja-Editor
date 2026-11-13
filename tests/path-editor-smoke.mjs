import assert from 'node:assert/strict';
import { normalizePath, normalizePathMap, movePathNode, insertDuplicatePathNode } from '../js/path-editor.js';

const source = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
assert.deepEqual(normalizePath(source), source);
assert.deepEqual(movePathNode(source, 1, 0, -12.25), [[1, 2, 3], [-12.25, 5, 6], [7, 8, 9]]);
assert.deepEqual(source, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], 'waypoint edits do not mutate the caller path');
assert.deepEqual(normalizePathMap([0, 1, 1, 2], 4, 3), [0, 1, 1, 2]);
assert.deepEqual(insertDuplicatePathNode(source, 1), {
  path: [[1, 2, 3], [4, 5, 6], [4, 5, 6], [7, 8, 9]],
  pathMap: [0, 1, 1, 2], insertedIndex: 2,
}, 'duplicate is inserted directly after the selected node and inherits its source template');
assert.deepEqual(insertDuplicatePathNode(source, 2, [0, 1, 2]).path,
  [[1, 2, 3], [4, 5, 6], [7, 8, 9], [7, 8, 9]],
  'insertion after the final node appends a duplicate');
assert.throws(() => normalizePath([]), /1 to 64/);
assert.throws(() => normalizePath(Array.from({ length: 65 }, () => [0, 0, 0])), /1 to 64/);
assert.throws(() => movePathNode(source, 99, 0, 0), /Invalid waypoint/);
assert.throws(() => movePathNode(source, 0, 3, 0), /Invalid waypoint/);
assert.throws(() => insertDuplicatePathNode(source, -1), /insertion index/);
assert.throws(() => normalizePathMap([0, 3], 2, 3), /source-node map/);
assert.throws(() => insertDuplicatePathNode(Array.from({ length: 64 }, () => [0, 0, 0]), 0), /64 nodes/);
console.log('PASS waypoint path validation, immutable node edits, and duplicate insertion');
