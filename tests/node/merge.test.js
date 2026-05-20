import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeData } from '../../logic.js';

test('mergeData: empty existing + non-empty incoming returns incoming', () => {
  const incoming = {
    topics: [{ id: 't1', name: 'A', parentId: '' }],
    items: [{ id: 'i1', topicId: 't1', type: 'note', content: 'hi' }],
  };
  const { topics, items } = mergeData(
    { existingTopics: [], existingItems: [] },
    incoming,
  );
  assert.deepEqual(topics, incoming.topics);
  assert.deepEqual(items, incoming.items);
});

test('mergeData: same-ID conflict — incoming wins', () => {
  const existingTopics = [{ id: 't1', name: 'OLD', parentId: '' }];
  const incoming = {
    topics: [{ id: 't1', name: 'NEW', parentId: '' }],
    items: [],
  };
  const { topics } = mergeData({ existingTopics, existingItems: [] }, incoming);
  const t1 = topics.find(t => t.id === 't1');
  assert.equal(t1.name, 'NEW');
  // Only one record for the conflicting ID.
  assert.equal(topics.filter(t => t.id === 't1').length, 1);
});

test('mergeData: null parentId on incoming topic sanitized to empty string', () => {
  const incoming = {
    topics: [{ id: 't1', name: 'A', parentId: null }],
    items: [],
  };
  const { topics } = mergeData(
    { existingTopics: [], existingItems: [] },
    incoming,
  );
  assert.equal(topics[0].parentId, '');
});

test('mergeData: undefined parentId on incoming topic sanitized to empty string', () => {
  const incoming = {
    topics: [{ id: 't1', name: 'A' }], // parentId omitted
    items: [],
  };
  const { topics } = mergeData(
    { existingTopics: [], existingItems: [] },
    incoming,
  );
  assert.equal(topics[0].parentId, '');
});

test('mergeData: null topicId on incoming item sanitized to empty string', () => {
  const incoming = {
    topics: [],
    items: [{ id: 'i1', topicId: null, type: 'note', content: 'x' }],
  };
  const { items } = mergeData(
    { existingTopics: [], existingItems: [] },
    incoming,
  );
  assert.equal(items[0].topicId, '');
});

test('mergeData: nested items inside topic are flattened and topicId backfilled', () => {
  const incoming = {
    topics: [{
      id: 't1',
      name: 'A',
      parentId: '',
      items: [
        { id: 'i1', type: 'note', content: 'hi' },
        { id: 'i2', topicId: null, type: 'note', content: 'yo' },
      ],
    }],
    items: [],
  };
  const { topics, items } = mergeData(
    { existingTopics: [], existingItems: [] },
    incoming,
  );
  // Nested items array stripped from the stored topic.
  assert.equal(topics[0].items, undefined);
  // Items flattened with topicId filled in from parent.
  assert.equal(items.length, 2);
  assert.equal(items.find(i => i.id === 'i1').topicId, 't1');
  assert.equal(items.find(i => i.id === 'i2').topicId, 't1');
});

test('mergeData: disjoint IDs are unioned', () => {
  const existingTopics = [{ id: 't1', name: 'A', parentId: '' }];
  const existingItems = [{ id: 'i1', topicId: 't1', type: 'note', content: 'a' }];
  const incoming = {
    topics: [{ id: 't2', name: 'B', parentId: '' }],
    items: [{ id: 'i2', topicId: 't2', type: 'note', content: 'b' }],
  };
  const { topics, items } = mergeData(
    { existingTopics, existingItems },
    incoming,
  );
  assert.deepEqual(topics.map(t => t.id).sort(), ['t1', 't2']);
  assert.deepEqual(items.map(i => i.id).sort(), ['i1', 'i2']);
});

test('mergeData: nested item with same ID as flat item — last write wins (incoming order)', () => {
  // Nested items are processed first, then the flat items array. The flat
  // entry should overwrite the nested one if both share an ID.
  const incoming = {
    topics: [{
      id: 't1',
      name: 'A',
      parentId: '',
      items: [{ id: 'i1', type: 'note', content: 'nested' }],
    }],
    items: [{ id: 'i1', topicId: 't1', type: 'note', content: 'flat' }],
  };
  const { items } = mergeData(
    { existingTopics: [], existingItems: [] },
    incoming,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].content, 'flat');
});

test('mergeData: does not mutate input arrays', () => {
  const existingTopics = [{ id: 't1', name: 'OLD', parentId: '' }];
  const existingItems = [];
  const incoming = {
    topics: [{ id: 't1', name: 'NEW', parentId: null }],
    items: [],
  };
  const snapshot = JSON.parse(JSON.stringify({ existingTopics, incoming }));
  mergeData({ existingTopics, existingItems }, incoming);
  assert.deepEqual({ existingTopics, incoming }, snapshot);
});
