import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReorder, applyOrder } from '../../logic.js';

// --- computeReorder ---

test('computeReorder: drop on self returns null', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(computeReorder(order, 'b', 'b', 'before'), null);
});

test('computeReorder: move first to after last', () => {
  const order = ['a', 'b', 'c'];
  // Move a after c → [b, c, a]
  assert.deepEqual(computeReorder(order, 'a', 'c', 'after'), ['b', 'c', 'a']);
});

test('computeReorder: move last to before first', () => {
  const order = ['a', 'b', 'c'];
  // Move c before a → [c, a, b]
  assert.deepEqual(computeReorder(order, 'c', 'a', 'before'), ['c', 'a', 'b']);
});

test('computeReorder: before vs after on same target produces different result', () => {
  const order = ['a', 'b', 'c', 'd'];
  // Move d before b: [a, d, b, c]
  assert.deepEqual(computeReorder(order, 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
  // Move d after b: [a, b, d, c]
  assert.deepEqual(computeReorder(order, 'd', 'b', 'after'), ['a', 'b', 'd', 'c']);
});

test('computeReorder: downward move applies toIndex-- adjustment', () => {
  // Moving a (index 0) before c (index 2): direct splice would yield [b, a, c, d]
  // because removing a first shifts c to index 1, then inserting at 1 gives [b, a, c, d].
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(computeReorder(order, 'a', 'c', 'before'), ['b', 'a', 'c', 'd']);
});

test('computeReorder: upward move (no adjustment)', () => {
  const order = ['a', 'b', 'c', 'd'];
  // Move d before b: [a, d, b, c]
  assert.deepEqual(computeReorder(order, 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
});

test('computeReorder: dropping immediately after self is no-op', () => {
  const order = ['a', 'b', 'c'];
  // Moving b "before" b → no change; "after" b also no change after adjustment
  assert.equal(computeReorder(order, 'b', 'b', 'after'), null);
});

test('computeReorder: drop adjacent forward "after target=previous" is a no-op', () => {
  const order = ['a', 'b', 'c'];
  // Moving b after a → b stays where it is.
  assert.equal(computeReorder(order, 'b', 'a', 'after'), null);
});

// --- applyOrder ---

test('applyOrder: returns only records whose order changed', () => {
  const topics = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
  ];
  const items = [{ id: 'c', order: 2 }];
  // New order swaps a and b, c unchanged.
  const newOrder = ['b', 'a', 'c'];
  const { topicUpdates, itemUpdates } = applyOrder(newOrder, topics, items);
  // Both a and b changed order; c stayed at 2.
  assert.equal(topicUpdates.length, 2);
  assert.equal(topicUpdates.find(t => t.id === 'a').order, 1);
  assert.equal(topicUpdates.find(t => t.id === 'b').order, 0);
  assert.deepEqual(itemUpdates, []);
});

test('applyOrder: mixes topics and items in the correct output arrays', () => {
  const topics = [{ id: 't1', order: 0 }];
  const items = [{ id: 'i1', order: 1 }];
  const newOrder = ['i1', 't1'];
  const { topicUpdates, itemUpdates } = applyOrder(newOrder, topics, items);
  assert.equal(topicUpdates.length, 1);
  assert.equal(topicUpdates[0].id, 't1');
  assert.equal(topicUpdates[0].order, 1);
  assert.equal(itemUpdates.length, 1);
  assert.equal(itemUpdates[0].id, 'i1');
  assert.equal(itemUpdates[0].order, 0);
});

test('applyOrder: unknown IDs in newOrder are silently skipped', () => {
  const topics = [{ id: 'a', order: 0 }];
  const items = [];
  const { topicUpdates, itemUpdates } = applyOrder(['ghost', 'a'], topics, items);
  // 'a' goes to index 1 → order changed from 0 to 1.
  assert.equal(topicUpdates.length, 1);
  assert.equal(topicUpdates[0].order, 1);
  assert.deepEqual(itemUpdates, []);
});

test('applyOrder: no-op when newOrder matches current order', () => {
  const topics = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }];
  const { topicUpdates, itemUpdates } = applyOrder(['a', 'b'], topics, []);
  assert.deepEqual(topicUpdates, []);
  assert.deepEqual(itemUpdates, []);
});

test('applyOrder: does not mutate input arrays', () => {
  const topics = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }];
  const before = JSON.parse(JSON.stringify(topics));
  applyOrder(['b', 'a'], topics, []);
  assert.deepEqual(topics, before);
});
