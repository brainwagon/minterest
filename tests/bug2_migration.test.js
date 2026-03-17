import { storage, migrateNullIds } from '../storage.js';

// Bug 2: IndexedDB upgrade callback uses .then() chains, which fire after the
// IDB transaction has already auto-committed (the upgrade callback is
// synchronous from IDB's perspective). The null→"" parentId/topicId migration
// therefore silently does nothing.
//
// Fix: export migrateNullIds() as a named async function; call it with await
// inside an async upgrade callback so the transaction stays open.

async function runTests() {
  const results = document.getElementById('results');
  const log = (msg, pass) => {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.color = pass ? 'green' : 'red';
    results.appendChild(div);
  };

  try {
    log('Starting Bug 2: IDB Migration Tests...', true);
    await storage.init();
    await storage.clearAll();

    // Insert records that simulate a pre-migration database: parentId/topicId
    // set to null or undefined (as would have existed before v5 schema).
    await storage.db.put('topics', { id: 't-null', name: 'Topic null', parentId: null });
    await storage.db.put('topics', { id: 't-undef', name: 'Topic undef', parentId: undefined });
    await storage.db.put('topics', { id: 't-ok', name: 'Topic ok', parentId: 'some-parent' });
    await storage.db.put('items', { id: 'i-null', type: 'note', content: 'A', topicId: null });
    await storage.db.put('items', { id: 'i-undef', type: 'note', content: 'B', topicId: undefined });
    await storage.db.put('items', { id: 'i-ok', type: 'note', content: 'C', topicId: 'some-topic' });

    // ---- DEMONSTRATE THE BUG ----
    // Pre-migration: null parentIds are stored and remain null.
    const preTopic = await storage.getTopic('t-null');
    if (preTopic.parentId === null) {
      log('CONFIRMED BUG: topics with null parentId remain null before migration', true);
    } else {
      log('FAIL: Expected null parentId to be present before migration', false);
    }

    const preItem = await storage.db.get('items', 'i-null');
    if (preItem.topicId === null) {
      log('CONFIRMED BUG: items with null topicId remain null before migration', true);
    } else {
      log('FAIL: Expected null topicId to be present before migration', false);
    }

    // ---- VERIFY THE FIX ----
    // migrateNullIds() is the extracted migration function. Run it on a live tx.
    const tx = storage.transaction(['topics', 'items'], 'readwrite');
    await migrateNullIds(tx);
    await tx.done;

    const postTopicNull = await storage.getTopic('t-null');
    if (postTopicNull.parentId === '') {
      log('PASS (fix): null parentId migrated to "" for topic', true);
    } else {
      throw new Error(`Expected "", got ${JSON.stringify(postTopicNull.parentId)}`);
    }

    const postTopicUndef = await storage.getTopic('t-undef');
    if (postTopicUndef.parentId === '') {
      log('PASS (fix): undefined parentId migrated to "" for topic', true);
    } else {
      throw new Error(`Expected "" for undef, got ${JSON.stringify(postTopicUndef.parentId)}`);
    }

    const postTopicOk = await storage.getTopic('t-ok');
    if (postTopicOk.parentId === 'some-parent') {
      log('PASS (fix): non-null parentId is not changed by migration', true);
    } else {
      throw new Error(`Non-null parentId was incorrectly modified`);
    }

    const postItemNull = await storage.db.get('items', 'i-null');
    if (postItemNull.topicId === '') {
      log('PASS (fix): null topicId migrated to "" for item', true);
    } else {
      throw new Error(`Expected "" for item, got ${JSON.stringify(postItemNull.topicId)}`);
    }

    const postItemOk = await storage.db.get('items', 'i-ok');
    if (postItemOk.topicId === 'some-topic') {
      log('PASS (fix): non-null topicId is not changed by migration', true);
    } else {
      throw new Error(`Non-null topicId was incorrectly modified`);
    }

    await storage.clearAll();
    log('--- ALL TESTS PASSED ---', true);
  } catch (err) {
    log('FAIL: ' + err.message, false);
    console.error(err);
  }
}

runTests();
