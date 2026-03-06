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
        log('Starting Storage Tests...', true);

        // 1. Open
        await storage.init();
        log('PASS: Initialized storage', true);

        // 2. Add Topic
        const testTopic = { id: 'test-topic', name: 'Test Topic', parentId: null };
        await storage.addTopic(testTopic);
        log('PASS: Added topic', true);

        // 3. Get Topic
        const retrievedTopic = await storage.getTopic('test-topic');
        if (retrievedTopic && retrievedTopic.name === 'Test Topic') {
            log('PASS: Retrieved topic correctly', true);
        } else {
            throw new Error('Retrieved topic mismatch');
        }

        // 4. Add Item
        const testItem = { id: 'test-item', topicId: 'test-topic', type: 'note', content: 'Hello' };
        await storage.addItem(testItem);
        log('PASS: Added item', true);

        // 5. Get Items by Topic
        const items = await storage.getItemsByTopic('test-topic');
        if (items.length === 1 && items[0].id === 'test-item') {
            log('PASS: Retrieved items by topic', true);
        } else {
            throw new Error('Items retrieval mismatch');
        }

        // 6. Delete Item
        await storage.deleteItem('test-item');
        const itemsAfterDelete = await storage.getItemsByTopic('test-topic');
        if (itemsAfterDelete.length === 0) {
            log('PASS: Deleted item', true);
        } else {
            throw new Error('Item deletion failed');
        }

        // 7. Delete Topic
        await storage.deleteTopic('test-topic');
        const retrievedTopicAfterDelete = await storage.getTopic('test-topic');
        if (!retrievedTopicAfterDelete) {
            log('PASS: Deleted topic', true);
        } else {
            throw new Error('Topic deletion failed');
        }

        log('--- ALL TESTS PASSED ---', true);
    } catch (err) {
        log('FAIL: ' + err.message, false);
        console.error(err);
    }
}

runTests();
