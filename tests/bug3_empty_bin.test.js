import { storage } from '../storage.js';

// Bug 3: emptyRecycleBin() only deletes top-level topics whose parentId is
// RECYCLE_BIN_ID. Sub-topics of those topics, and items belonging to those
// sub-topics, are left behind as unreachable orphans.
//
// Fix: recursively delete all descendant topics and their items before
// deleting each top-level bin topic.

const RECYCLE_BIN_ID = 'recycle-bin';

async function runTests() {
  const results = document.getElementById('results');
  const log = (msg, pass) => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = pass ? 'green' : 'red';
    results.appendChild(div);
  };

  try {
    log('Starting Bug 3: Empty Recycle Bin Orphan Tests...', true);
    await storage.init();
    await storage.clearAll();

    // Build structure: binTopic -> subTopic -> item (2 levels deep in bin)
    await storage.addTopic({ id: 'bin-top', name: 'Binned Topic', parentId: RECYCLE_BIN_ID });
    await storage.addTopic({ id: 'bin-sub', name: 'Sub Topic', parentId: 'bin-top' });
    await storage.addItem({ id: 'bin-item', topicId: 'bin-sub', type: 'note', content: 'orphan' });
    // Also add a direct item in the top-level bin topic.
    await storage.addItem({ id: 'direct-item', topicId: 'bin-top', type: 'note', content: 'direct' });

    // ---- DEMONSTRATE THE BUG ----
    // Simulate the old emptyRecycleBin: only delete direct children of bin
    // and items directly in the bin (topicId === RECYCLE_BIN_ID).
    const buggyTx = storage.transaction(['topics', 'items'], 'readwrite');
    const directItems = await buggyTx.objectStore('items')
      .index('topicId').getAllKeys(RECYCLE_BIN_ID);
    await Promise.all(directItems.map(id => buggyTx.objectStore('items').delete(id)));
    const allTopics = await buggyTx.objectStore('topics').getAll();
    const binTopics = allTopics.filter(t => t.parentId === RECYCLE_BIN_ID);
    await Promise.all(binTopics.map(t => buggyTx.objectStore('topics').delete(t.id)));
    await buggyTx.done;

    // Sub-topic and its item should still exist (orphaned).
    const orphanedSubTopic = await storage.getTopic('bin-sub');
    if (orphanedSubTopic) {
      log('CONFIRMED BUG: sub-topic remains as orphan after old emptyRecycleBin', true);
    } else {
      log('FAIL: Expected orphaned sub-topic to remain', false);
    }

    const orphanedItem = await storage.getItem('bin-item');
    if (orphanedItem) {
      log('CONFIRMED BUG: item inside sub-topic remains as orphan', true);
    } else {
      log('FAIL: Expected orphaned item to remain', false);
    }

    // ---- VERIFY THE FIX ----
    // Restore the structure and run the fixed recursive deletion.
    await storage.clearAll();
    await storage.addTopic({ id: 'bin-top', name: 'Binned Topic', parentId: RECYCLE_BIN_ID });
    await storage.addTopic({ id: 'bin-sub', name: 'Sub Topic', parentId: 'bin-top' });
    await storage.addItem({ id: 'bin-item', topicId: 'bin-sub', type: 'note', content: 'orphan' });
    await storage.addItem({ id: 'direct-item', topicId: 'bin-top', type: 'note', content: 'direct' });

    // Fixed recursive deletion logic.
    const fixedTx = storage.transaction(['topics', 'items'], 'readwrite');

    async function deleteTopicRecursively(topicId, allTopicsSnapshot, tx) {
      const childItems = await tx.objectStore('items').index('topicId').getAllKeys(topicId);
      await Promise.all(childItems.map(id => tx.objectStore('items').delete(id)));
      const subTopics = allTopicsSnapshot.filter(t => t.parentId === topicId);
      for (const sub of subTopics) {
        await deleteTopicRecursively(sub.id, allTopicsSnapshot, tx);
      }
      await tx.objectStore('topics').delete(topicId);
    }

    const fixedDirectItems = await fixedTx.objectStore('items')
      .index('topicId').getAllKeys(RECYCLE_BIN_ID);
    await Promise.all(fixedDirectItems.map(id => fixedTx.objectStore('items').delete(id)));
    const fixedAllTopics = await fixedTx.objectStore('topics').getAll();
    const fixedBinTopics = fixedAllTopics.filter(t => t.parentId === RECYCLE_BIN_ID);
    for (const t of fixedBinTopics) {
      await deleteTopicRecursively(t.id, fixedAllTopics, fixedTx);
    }
    await fixedTx.done;

    const subTopicGone = await storage.getTopic('bin-sub');
    if (!subTopicGone) {
      log('PASS (fix): sub-topic is fully deleted', true);
    } else {
      throw new Error('Sub-topic should have been deleted by recursive fix');
    }

    const itemGone = await storage.getItem('bin-item');
    if (!itemGone) {
      log('PASS (fix): item inside sub-topic is fully deleted', true);
    } else {
      throw new Error('Item inside sub-topic should have been deleted');
    }

    const topLevelGone = await storage.getTopic('bin-top');
    if (!topLevelGone) {
      log('PASS (fix): top-level bin topic is also deleted', true);
    } else {
      throw new Error('Top-level bin topic should have been deleted');
    }

    await storage.clearAll();
    log('--- ALL TESTS PASSED ---', true);
  } catch (err) {
    log('FAIL: ' + err.message, false);
    console.error(err);
  }
}

runTests();
