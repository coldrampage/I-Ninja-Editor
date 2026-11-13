import assert from 'node:assert/strict';
import { normalizePath, movePathNode } from '../js/path-editor.js';

const source = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
assert.deepEqual(normalizePath(source), source);
assert.deepEqual(movePathNode(source, 1, 0, -12.25), [[1, 2, 3], [-12.25, 5, 6], [7, 8, 9]]);
assert.deepEqual(source, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], 'waypoint edits do not mutate the caller path');
assert.throws(() => normalizePath([]), /1 to 64/);
assert.throws(() => normalizePath(Array.from({ length: 65 }, () => [0, 0, 0])), /1 to 64/);
assert.throws(() => movePathNode(source, 99, 0, 0), /Invalid waypoint/);
assert.throws(() => movePathNode(source, 0, 3, 0), /Invalid waypoint/);
console.log('PASS waypoint path validation and immutable node edits');
