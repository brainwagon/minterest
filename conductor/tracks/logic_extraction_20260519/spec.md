# Specification: logic_extraction_20260519

## Goal
Extract data-mutation logic from `app.js` into a new `logic.js` module of pure functions over plain JavaScript data, then cover that module with a Node-based test suite that runs in CI. The motivation is to make logic bugs catchable before they reach the browser — today, none of `app.js`'s ~2300 lines are tested.

## Non-Goals
- No behavior changes. Bugs discovered during extraction are pinned down in tests and fixed in **separate commits** after the refactor lands.
- No tests for DOM rendering, drag-and-drop event wiring, or IndexedDB itself — those stay covered by the existing browser harnesses (or remain uncovered for this round).
- No test runner, mocking library, or build step beyond what `node --test` provides out of the box.
- No migration of existing browser-based tests (`tests/storage.test.js`, `tests/bug*.test.js`, etc.) — they continue to run via their HTML harnesses.

## Scope

### Functions to extract
Each becomes a pure function in `logic.js` taking plain data and returning plain data. `app.js` becomes a thin glue layer that reads from IDB/DOM, calls the pure function, and writes results back.

| Pure function | Today's location in `app.js` | Signature |
|---|---|---|
| `mergeData` | line 1842 | `({existingTopics, existingItems}, incomingData) → {topics, items}` |
| `collectDescendants` | line 1143 (`deleteRecursive`) | `(topicId, allTopics, allItems) → {topicIds[], itemIds[]}` |
| `getNextOrder` | line 1106 | `(parentId, topics, items) → number` |
| `computeReorder` | inside `reorderItem` (line 720) | `(currentOrderIds, draggedId, targetId, position) → newOrderIds[] \| null` |
| `applyOrder` | inside `reorderItem` (line 720) | `(newOrderIds, topics, items) → {topicUpdates[], itemUpdates[]}` |

### Behavior to preserve exactly
- `mergeData`: incoming records overwrite same-ID local records (IDB `put` semantics); `null`/`undefined` `parentId`/`topicId` → `""`; nested `items` arrays in topics are flattened with `topicId` backfilled from the parent.
- `collectDescendants`: recursive descent through `parentId`; orphan items (matching `topicId` but parent in different tree) follow today's behavior.
- `getNextOrder`: counts topics + items under the parent; treats `null`/`undefined`/`""` parentId as equivalent.
- `computeReorder`: returns `null` when the drag results in no change; applies the `toIndex--` adjustment when moving downward; `position` is `'before'` or `'after'`.
- `applyOrder`: only returns records whose `order` actually changed; silently ignores IDs in the new order that aren't in topics/items.

### Test suite
- New `tests/node/merge.test.js`, `tests/node/delete.test.js`, `tests/node/order.test.js`, `tests/node/reorder.test.js`.
- Each uses Node's built-in `node:test` and `node:assert/strict`.
- `package.json` at the project root with `"test": "node --test tests/node/*.test.js"` (subfolder isolates Node tests from the browser-only HTML harnesses in `tests/`). No dependencies, no lockfile.

### CI
- `.github/workflows/test.yml` running `npm test` on push and pull request.

## Technical Details
- **New files:** `logic.js`, `tests/node/merge.test.js`, `tests/node/delete.test.js`, `tests/node/order.test.js`, `tests/node/reorder.test.js`, `package.json`, `.github/workflows/test.yml`.
- **Modified files:** `app.js` (replace inlined logic with calls to `logic.js`).
- **No new runtime dependencies.** `logic.js` is plain ES modules, importable in both browser and Node.
- **Style:** Google JavaScript Style Guide per `conductor/code_styleguides/javascript.md` — named exports, `const`/`let`, single quotes, semicolons, JSDoc on exports.

## Verification
- All new tests pass under `node --test tests/*.test.js`.
- Existing browser test harnesses still pass when opened manually.
- Manual smoke in the browser: create topic / add item / drag-reorder / delete topic / import backup / sync with peer — all behave identically to before.
- GH Actions workflow shows green on the PR.
