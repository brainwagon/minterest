# Implementation Plan: logic_extraction_20260519

Each extraction task follows Red → Green → Refactor per `conductor/workflow.md`.
- **Red:** write the failing test against the *not-yet-existing* exported function.
- **Green:** add the function to `logic.js` by lifting today's behavior out of `app.js`. Tests pass.
- **Refactor:** replace the inlined logic in `app.js` with a call to the new pure function. Existing browser smoke still works.

## Phase 1: Scaffolding
- [x] **Task: Create `package.json`**
    - [x] Minimal: `{ "name": "minterest", "private": true, "type": "module", "scripts": { "test": "node --test tests/node/*.test.js" } }`
    - [x] Verify `npm test` runs (zero tests, exit 0). Tests live in `tests/node/` to avoid the npm glob picking up the existing browser-only HTML harness scripts in `tests/`.
- [x] **Task: Create empty `logic.js`** with a top-of-file JSDoc explaining the module's role (pure data ops, no DOM, no IDB).

## Phase 2: Extract `getNextOrder` (warm-up — simplest function)
- [x] **Red: Write `tests/node/order.test.js`** covering: empty parent → 0; topics only; items only; both; `null`/`undefined`/`""` parentId equivalence.
- [x] **Green: Add `getNextOrder` to `logic.js`** with signature `(parentId, topics, items) → number`.
- [x] **Refactor: Replace `getNextOrder` in `app.js`** with `import { getNextOrder } from './logic.js'` and pass `state.topics`, `state.items`.

## Phase 3: Extract `collectDescendants`
- [x] **Red: Write `tests/node/delete.test.js`** covering: leaf topic; topic with direct items; one-level nesting; deep nesting (3+ levels); orphan-item edge case.
- [x] **Green: Add `collectDescendants`** to `logic.js` with signature `(topicId, allTopics, allItems) → {topicIds[], itemIds[]}`.
- [x] **Refactor: Replace `deleteRecursive` in `app.js`** — `app.js` now calls `collectDescendants` to get the ID lists, then performs the deletes in a single transaction.

## Phase 4: Extract reorder logic (`computeReorder` + `applyOrder`)
- [x] **Red: Write `tests/node/reorder.test.js`** covering both functions: drop-on-self → null; drop before first / after last; "before" vs "after" same target; downward move (`toIndex--`); upward move; non-existent IDs silently skipped in `applyOrder`; unchanged records excluded from `applyOrder` output.
- [x] **Green: Add `computeReorder` and `applyOrder`** to `logic.js`.
- [x] **Refactor: Rewrite `reorderItem` in `app.js`** to read the current order from the DOM, call `computeReorder`, call `applyOrder`, and write back. DOM/IDB calls stay in `app.js`.

## Phase 5: Extract `mergeData` (highest risk — done last after pattern is established)
- [x] **Red: Write `tests/node/merge.test.js`** covering: empty existing + non-empty incoming; same-ID conflict (incoming wins); `parentId: null`/`undefined` → `""`; `topicId: null`/`undefined` → `""`; nested items flattened with backfilled `topicId`; disjoint IDs unioned.
- [x] **Green: Add `mergeData`** to `logic.js` with signature `({existingTopics, existingItems}, incomingData) → {topics, items}`. Pure transformation — no IDB.
- [x] **Refactor: Rewrite `mergeData` in `app.js`** to read existing topics/items, call `logic.mergeData`, then write the result back in a single transaction. `replaceData` continues to call the new flow after `clearAll`.

## Phase 6: CI
- [x] **Task: Add `.github/workflows/test.yml`** running `npm test` on push and PR with Node 20.
- [ ] **Task: Manual verification** — push a branch, confirm the workflow runs green on the PR. Note the URL in commit message.

## Phase 7: Conductor — User Manual Verification
- [ ] **Task: Manual smoke in browser** (Protocol in `workflow.md`)
    - [ ] Create / edit / delete topics and items
    - [ ] Drag-reorder cards in a board
    - [ ] Export backup → clear data → import backup → state restored
    - [ ] P2P sync between two browser tabs

## Out of scope (deferred)
- Bug fixes uncovered during extraction → file a separate track per bug after this one lands.
- Migration of existing browser tests to Node.
- Extraction of DnD math (`getClosestCard`), backup/restore parsing, or pure helpers (`getPastelColor`, `getMimeType`).
