/**
 * Pure data-ops logic for minterest.
 *
 * Functions here take plain JavaScript data and return plain JavaScript data.
 * No DOM, no IndexedDB, no module-level state. The browser glue in app.js is
 * responsible for reading from the DB / DOM, calling these functions, and
 * writing results back.
 *
 * This module is also importable in Node so that its logic can be exercised
 * by the test suite (`node --test`) without a browser.
 */

/**
 * Compute the `order` value for a new topic or item appended under a parent.
 * Treats `null`, `undefined`, and `''` parentId/topicId as equivalent (root).
 *
 * @param {string|null|undefined} parentId
 * @param {Array<{parentId?: string|null}>} topics
 * @param {Array<{topicId?: string|null}>} items
 * @return {number} The count of topics and items currently under that parent.
 */
export function getNextOrder(parentId, topics, items) {
  const p = parentId || '';
  const topicCount = topics.filter(t => (t.parentId || '') === p).length;
  const itemCount = items.filter(i => (i.topicId || '') === p).length;
  return topicCount + itemCount;
}

/**
 * Walk the topic tree rooted at `topicId` and return the IDs of every topic
 * and item that would be removed by a recursive delete. Pure function — does
 * not mutate inputs and does not perform the delete.
 *
 * @param {string} topicId The root of the subtree to collect.
 * @param {Array<{id: string, parentId?: string}>} allTopics
 * @param {Array<{id: string, topicId?: string}>} allItems
 * @return {{topicIds: string[], itemIds: string[]}}
 */
export function collectDescendants(topicId, allTopics, allItems) {
  const topicIds = [];
  const itemIds = [];
  const stack = [topicId];
  while (stack.length > 0) {
    const current = stack.pop();
    topicIds.push(current);
    for (const item of allItems) {
      if (item.topicId === current) itemIds.push(item.id);
    }
    for (const t of allTopics) {
      if (t.parentId === current) stack.push(t.id);
    }
  }
  return { topicIds, itemIds };
}

/**
 * Compute the new ID order resulting from a drag-and-drop reorder.
 * Returns `null` when the drag would not change the order (e.g. dropping
 * an element onto itself, or dropping it immediately adjacent to its
 * current position).
 *
 * @param {string[]} currentOrderIds The current visible order, by ID.
 * @param {string} draggedId
 * @param {string} targetId
 * @param {'before'|'after'} position Where to drop relative to the target.
 * @return {string[]|null}
 */
export function computeReorder(currentOrderIds, draggedId, targetId, position) {
  const fromIndex = currentOrderIds.indexOf(draggedId);
  let toIndex = currentOrderIds.indexOf(targetId);
  if (position === 'after') toIndex++;
  // Adjust if moving downwards: removing the dragged element first will shift
  // the target index down by one.
  if (fromIndex < toIndex) toIndex--;
  if (fromIndex === toIndex) return null;
  const next = currentOrderIds.slice();
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, draggedId);
  return next;
}

/**
 * Given the desired new ID order, compute which topic/item records need their
 * `order` property updated. Unknown IDs are silently skipped. The returned
 * records are shallow clones — the input arrays are not mutated.
 *
 * @param {string[]} newOrderIds
 * @param {Array<{id: string, order?: number}>} topics
 * @param {Array<{id: string, order?: number}>} items
 * @return {{topicUpdates: Array, itemUpdates: Array}}
 */
export function applyOrder(newOrderIds, topics, items) {
  const topicUpdates = [];
  const itemUpdates = [];
  newOrderIds.forEach((id, index) => {
    const topic = topics.find(t => t.id === id);
    if (topic) {
      if (topic.order !== index) {
        topicUpdates.push({ ...topic, order: index });
      }
      return;
    }
    const item = items.find(i => i.id === id);
    if (item && item.order !== index) {
      itemUpdates.push({ ...item, order: index });
    }
  });
  return { topicUpdates, itemUpdates };
}

/**
 * Merge an incoming backup/peer-sync payload into the existing topics/items.
 * Same-ID records are overwritten by the incoming version (matching IndexedDB
 * `put` semantics). Sanitizes `parentId` / `topicId` (`null`/`undefined` → `''`)
 * and flattens any nested `items` arrays inside topics, backfilling each
 * nested item's `topicId` from its parent topic.
 *
 * Pure function — does not mutate inputs.
 *
 * @param {{existingTopics: Array, existingItems: Array}} existing
 * @param {{topics: Array, items: Array}} incoming
 * @return {{topics: Array, items: Array}} The merged record set.
 */
export function mergeData({ existingTopics, existingItems }, incoming) {
  const topicById = new Map();
  const itemById = new Map();

  for (const t of existingTopics) topicById.set(t.id, t);
  for (const i of existingItems) itemById.set(i.id, i);

  for (const t of incoming.topics || []) {
    const { items: nestedItems, ...topicData } = t;
    if (topicData.parentId === null || topicData.parentId === undefined) {
      topicData.parentId = '';
    }
    if (Array.isArray(nestedItems)) {
      for (const ni of nestedItems) {
        const item = { ...ni };
        if (item.topicId === null || item.topicId === undefined) {
          item.topicId = topicData.id;
        }
        itemById.set(item.id, item);
      }
    }
    topicById.set(topicData.id, topicData);
  }

  for (const i of incoming.items || []) {
    const item = { ...i };
    if (item.topicId === null || item.topicId === undefined) {
      item.topicId = '';
    }
    itemById.set(item.id, item);
  }

  return {
    topics: Array.from(topicById.values()),
    items: Array.from(itemById.values()),
  };
}
