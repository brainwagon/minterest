import { storage } from '../storage.js';

async function runTests() {
    const results = document.getElementById('results');
    const log = (msg, pass) => {
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.color = pass ? 'green' : 'red';
        results.appendChild(div);
    };

    try {
        log('Starting Loading Optimization Tests...', true);

        await storage.init();
        await storage.clearAll();

        // 1. Setup Data
        await storage.addTopic({ id: 't1', name: 'Topic 1', parentId: "" });
        await storage.addTopic({ id: 't2', name: 'Topic 2', parentId: 't1' });
        await storage.addItem({ id: 'i1', topicId: 't1', type: 'note', content: 'Item in t1' });
        await storage.addItem({ id: 'i2', topicId: 't2', type: 'note', content: 'Item in t2' });
        await storage.addItem({ id: 'i3', topicId: "", type: 'note', content: 'Root item' });

        // 2. Test getItemsByTopic
        const itemsInT1 = await storage.getItemsByTopic('t1');
        if (itemsInT1.length === 1 && itemsInT1[0].id === 'i1') {
            log('PASS: getItemsByTopic works correctly', true);
        } else {
            throw new Error('getItemsByTopic failed');
        }

        // 3. Test getTopicsByParent
        const topicsInT1 = await storage.getTopicsByParent('t1');
        if (topicsInT1.length === 1 && topicsInT1[0].id === 't2') {
            log('PASS: getTopicsByParent works correctly', true);
        } else {
            throw new Error('getTopicsByParent failed');
        }

        // 4. Test Root Loading
        const rootTopics = await storage.getTopicsByParent("");
        const rootItems = await storage.getItemsByTopic("");
        if (rootTopics.length === 1 && rootTopics[0].id === 't1' && rootItems.length === 1 && rootItems[0].id === 'i3') {
            log('PASS: Root loading works correctly', true);
        } else {
            throw new Error('Root loading failed');
        }

        log('--- TESTS FINISHED ---', true);
    } catch (err) {
        log('FAIL: ' + err.message, false);
        console.error(err);
    }
}

runTests();
