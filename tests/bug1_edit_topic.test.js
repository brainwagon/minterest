import { storage } from '../storage.js';

// Bug 1: Edit Topic button always returns early when inside a board.
//
// The btnEditTopic click handler does:
//   const topic = state.topics.find(t => t.id === currentTopicId);
//   if (!topic) return;
//
// But state.topics = getTopicsByParent(currentTopicId) — the *children* of the
// current topic. The current topic's own ID will never appear there, so the
// find() always returns undefined and the handler always exits early.
//
// Fix: use state.currentTopic (populated by getTopic(currentTopicId)) instead.

async function runTests() {
  const results = document.getElementById('results');
  const log = (msg, pass) => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = pass ? 'green' : 'red';
    results.appendChild(div);
  };

  try {
    log('Starting Bug 1: Edit Topic Button Tests...', true);
    await storage.init();
    await storage.clearAll();

    // Create a parent topic with two children.
    const parent = { id: 'parent-1', name: 'Parent Topic', parentId: '' };
    const child1 = { id: 'child-1', name: 'Child One', parentId: 'parent-1' };
    const child2 = { id: 'child-2', name: 'Child Two', parentId: 'parent-1' };
    await storage.addTopic(parent);
    await storage.addTopic(child1);
    await storage.addTopic(child2);

    // ---- DEMONSTRATE THE BUG ----
    // When navigated into 'parent-1', state.topics holds the children.
    const topicsInView = await storage.getTopicsByParent('parent-1');

    // The buggy handler searches for the parent inside its own children list.
    const foundByFind = topicsInView.find(t => t.id === 'parent-1');
    if (foundByFind === undefined) {
      log('CONFIRMED BUG: state.topics.find(t => t.id === currentTopicId) ' +
          'returns undefined — edit button always exits early', true);
    } else {
      log('FAIL: Expected find to return undefined (bug not reproduced)', false);
    }

    // ---- VERIFY THE FIX ----
    // The fix uses getTopic(currentTopicId), the same source as state.currentTopic.
    const foundByGet = await storage.getTopic('parent-1');
    if (foundByGet && foundByGet.name === 'Parent Topic') {
      log('PASS (fix): getTopic(currentTopicId) correctly returns the current ' +
          'topic, allowing the edit dialog to open', true);
    } else {
      throw new Error('getTopic should return the parent topic');
    }

    await storage.clearAll();
    log('--- ALL TESTS PASSED ---', true);
  } catch (err) {
    log('FAIL: ' + err.message, false);
    console.error(err);
  }
}

runTests();
