import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNextOrder } from '../../logic.js';

test('getNextOrder: empty parent returns 0', () => {
  assert.equal(getNextOrder('parent-1', [], []), 0);
});

test('getNextOrder: counts topics under parent', () => {
  const topics = [
    { id: 't1', parentId: 'p' },
    { id: 't2', parentId: 'p' },
    { id: 't3', parentId: 'other' },
  ];
  assert.equal(getNextOrder('p', topics, []), 2);
});

test('getNextOrder: counts items under parent', () => {
  const items = [
    { id: 'i1', topicId: 'p' },
    { id: 'i2', topicId: 'p' },
    { id: 'i3', topicId: 'other' },
  ];
  assert.equal(getNextOrder('p', [], items), 2);
});

test('getNextOrder: counts topics and items combined', () => {
  const topics = [{ id: 't1', parentId: 'p' }, { id: 't2', parentId: 'p' }];
  const items = [{ id: 'i1', topicId: 'p' }];
  assert.equal(getNextOrder('p', topics, items), 3);
});

test('getNextOrder: null parentId equivalent to empty string (root)', () => {
  const topics = [
    { id: 't1', parentId: '' },
    { id: 't2', parentId: null },
    { id: 't3', parentId: 'x' },
  ];
  assert.equal(getNextOrder(null, topics, []), 2);
  assert.equal(getNextOrder('', topics, []), 2);
});

test('getNextOrder: undefined parentId equivalent to empty string', () => {
  const topics = [{ id: 't1', parentId: undefined }, { id: 't2', parentId: '' }];
  assert.equal(getNextOrder(undefined, topics, []), 2);
});

test('getNextOrder: null topicId on item counts as root', () => {
  const items = [
    { id: 'i1', topicId: null },
    { id: 'i2', topicId: '' },
    { id: 'i3', topicId: 'x' },
  ];
  assert.equal(getNextOrder('', [], items), 2);
});
