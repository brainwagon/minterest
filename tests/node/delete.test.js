import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDescendants } from '../../logic.js';

test('collectDescendants: leaf topic with nothing under it', () => {
  const topics = [{ id: 'a', parentId: '' }];
  const items = [];
  const { topicIds, itemIds } = collectDescendants('a', topics, items);
  assert.deepEqual(topicIds.sort(), ['a']);
  assert.deepEqual(itemIds, []);
});

test('collectDescendants: topic with direct items only', () => {
  const topics = [{ id: 'a', parentId: '' }];
  const items = [
    { id: 'i1', topicId: 'a' },
    { id: 'i2', topicId: 'a' },
    { id: 'i3', topicId: 'b' },
  ];
  const { topicIds, itemIds } = collectDescendants('a', topics, items);
  assert.deepEqual(topicIds.sort(), ['a']);
  assert.deepEqual(itemIds.sort(), ['i1', 'i2']);
});

test('collectDescendants: one level of subtopics with items', () => {
  const topics = [
    { id: 'a', parentId: '' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'a' },
  ];
  const items = [
    { id: 'i1', topicId: 'a' },
    { id: 'i2', topicId: 'b' },
    { id: 'i3', topicId: 'c' },
  ];
  const { topicIds, itemIds } = collectDescendants('a', topics, items);
  assert.deepEqual(topicIds.sort(), ['a', 'b', 'c']);
  assert.deepEqual(itemIds.sort(), ['i1', 'i2', 'i3']);
});

test('collectDescendants: deep nesting (3+ levels)', () => {
  const topics = [
    { id: 'a', parentId: '' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'd', parentId: 'c' },
    { id: 'unrelated', parentId: '' },
  ];
  const items = [
    { id: 'i_a', topicId: 'a' },
    { id: 'i_d', topicId: 'd' },
    { id: 'i_unrelated', topicId: 'unrelated' },
  ];
  const { topicIds, itemIds } = collectDescendants('a', topics, items);
  assert.deepEqual(topicIds.sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(itemIds.sort(), ['i_a', 'i_d']);
});

test('collectDescendants: does not touch siblings or parents', () => {
  const topics = [
    { id: 'root_a', parentId: '' },
    { id: 'root_b', parentId: '' },
    { id: 'child_b', parentId: 'root_b' },
  ];
  const items = [
    { id: 'i_a', topicId: 'root_a' },
    { id: 'i_b', topicId: 'root_b' },
  ];
  const { topicIds, itemIds } = collectDescendants('root_a', topics, items);
  assert.deepEqual(topicIds, ['root_a']);
  assert.deepEqual(itemIds, ['i_a']);
});
