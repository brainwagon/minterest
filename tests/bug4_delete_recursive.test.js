import { storage } from '../storage.js';

// Bug 4: deleteRecursive() in deleteTopic() finds sub-topics by filtering
// state.topics, which only contains topics in the current board view
// (direct children of currentTopicId). Topics nested deeper than one level
// below the deleted topic are not in state.topics and are therefore missed,
// leaving orphaned topics and items in the database.
//
// Fix: query the 'parentId' index directly from the open transaction instead
// of filtering the in-memory state.

async function runTests() {
  const results = document.getElementById('results');
  const log = (msg, pass) => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = pass ? 'green' : 'red';
    results.appendChild(div);
  };

  try {
    log('Starting Bug 4: deleteRecursive Stale State Tests...', true);
    await storage.init();
    await storage.clearAll();

    // Build a three-level topic tree:
    //   root (id='') -> parent -> child -> grandchild
    // with an item at each level.
    await storage.addTopic({ id: 'parent', name: 'Parent', parentId: '' });
    await storage.addTopic({ id: 'child', name: 'Child', parentId: 'parent' });
    await storage.addTopic({ id: 'grandchild', name: 'Grandchild', parentId: 'child' });
    await storage.addItem({ id: 'item-p', topicId: 'parent', type: 'note', content: 'in parent' });
    await storage.addItem({ id: 'item-c', topicId: 'child', type: 'note', content: 'in child' });
    await storage.addItem({ id: 'item-gc', topicId: 'grandchild', type: 'note', content: 'in grandchild' });

    // ---- DEMONSTRATE THE BUG ----
    // Simulated state.topics when the user is at the root: only 'parent' is loaded.
    // (getTopicsByParent('') returns only direct children of root.)
    const staleStateTopics = await storage.getTopicsByParent('');

    const buggyTx = storage.transaction(['topics', 'items'], 'readwrite');

    async function deleteRecursiveBuggy(topicId, tx) {
      await tx.objectStore('topics').delete(topicId);
      const items = await tx.objectStore('items').index('topicId').getAllKeys(topicId);
      await Promise.all(items.map(id => tx.objectStore('items').delete(id)));
      // BUG: uses stale in-memory state, which only has root-level topics.
      const subTopics = staleStateTopics.filter(t => t.parentId === topicId);
      for (const sub of subTopics) {
        await deleteRecursiveBuggy(sub.id, tx);
      }
    }

    await deleteRecursiveBuggy('parent', buggyTx);
    await buggyTx.done;

    const orphanedChild = await storage.getTopic('child');
    if (orphanedChild) {
      log('CONFIRMED BUG: child topic is orphaned (not deleted) by buggy deleteRecursive', true);
    } else {
      log('FAIL: Expected child to remain as orphan', false);
    }

    const orphanedGrandchild = await storage.getTopic('grandchild');
    if (orphanedGrandchild) {
      log('CONFIRMED BUG: grandchild topic is orphaned (not deleted)', true);
    } else {
      log('FAIL: Expected grandchild to remain as orphan', false);
    }

    const orphanedItem = await storage.getItem('item-gc');
    if (orphanedItem) {
      log('CONFIRMED BUG: item inside grandchild is orphaned (not deleted)', true);
    } else {
      log('FAIL: Expected item-gc to remain as orphan', false);
    }

    // ---- VERIFY THE FIX ----
    // Reset and rebuild the same tree.
    await storage.clearAll();
    await storage.addTopic({ id: 'parent', name: 'Parent', parentId: '' });
    await storage.addTopic({ id: 'child', name: 'Child', parentId: 'parent' });
    await storage.addTopic({ id: 'grandchild', name: 'Grandchild', parentId: 'child' });
    await storage.addItem({ id: 'item-p', topicId: 'parent', type: 'note', content: 'in parent' });
    await storage.addItem({ id: 'item-c', topicId: 'child', type: 'note', content: 'in child' });
    await storage.addItem({ id: 'item-gc', topicId: 'grandchild', type: 'note', content: 'in grandchild' });

    const fixedTx = storage.transaction(['topics', 'items'], 'readwrite');

    async function deleteRecursiveFixed(topicId, tx) {
      await tx.objectStore('topics').delete(topicId);
      const items = await tx.objectStore('items').index('topicId').getAllKeys(topicId);
      await Promise.all(items.map(id => tx.objectStore('items').delete(id)));
      // FIX: query the parentId index directly from the transaction.
      const subTopics = await tx.objectStore('topics').index('parentId').getAll(topicId);
      for (const sub of subTopics) {
        await deleteRecursiveFixed(sub.id, tx);
      }
    }

    await deleteRecursiveFixed('parent', fixedTx);
    await fixedTx.done;

    const childGone = await storage.getTopic('child');
    if (!childGone) {
      log('PASS (fix): child topic is fully deleted', true);
    } else {
      throw new Error('Child topic should have been deleted');
    }

    const grandchildGone = await storage.getTopic('grandchild');
    if (!grandchildGone) {
      log('PASS (fix): grandchild topic is fully deleted', true);
    } else {
      throw new Error('Grandchild topic should have been deleted');
    }

    const itemGone = await storage.getItem('item-gc');
    if (!itemGone) {
      log('PASS (fix): item inside grandchild is fully deleted', true);
    } else {
      throw new Error('Item inside grandchild should have been deleted');
    }

    await storage.clearAll();
    log('--- ALL TESTS PASSED ---', true);
  } catch (err) {
    log('FAIL: ' + err.message, false);
    console.error(err);
  }
}

runTests();
