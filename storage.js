import { openDB, deleteDB } from 'https://esm.sh/idb@7.1.1';

const DB_NAME = 'minterest-db';
const DB_VERSION = 5;

export const storage = {
    db: null,

    async init() {
        if (this.db) return this.db;
        this.db = await openDB(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion, newVersion, transaction) {
                console.log(`Upgrading DB from ${oldVersion} to ${newVersion}`);
                if (!db.objectStoreNames.contains('topics')) {
                    const topicStore = db.createObjectStore('topics', { keyPath: 'id' });
                    topicStore.createIndex('parentId', 'parentId');
                } else if (oldVersion < 5) {
                    const topicStore = transaction.objectStore('topics');
                    if (!topicStore.indexNames.contains('parentId')) {
                        topicStore.createIndex('parentId', 'parentId');
                    }
                    // Migrate null/undefined to ""
                    topicStore.getAll().then(topics => {
                        topics.forEach(t => {
                            if (t.parentId === null || t.parentId === undefined) {
                                t.parentId = "";
                                topicStore.put(t);
                            }
                        });
                    });
                }
                
                if (!db.objectStoreNames.contains('items')) {
                    const itemStore = db.createObjectStore('items', { keyPath: 'id' });
                    itemStore.createIndex('topicId', 'topicId');
                } else if (oldVersion < 5) {
                    const itemStore = transaction.objectStore('items');
                    itemStore.getAll().then(items => {
                        items.forEach(i => {
                            if (i.topicId === null || i.topicId === undefined) {
                                i.topicId = "";
                                itemStore.put(i);
                            }
                        });
                    });
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            },
            blocked() {
                console.warn("DB Blocked");
            },
            blocking() {
                console.warn("DB Blocking");
                if (this.db) this.db.close();
                location.reload();
            }
        });
        return this.db;
    },

    async delete() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        return deleteDB(DB_NAME);
    },

    // --- Topics ---
    async getAllTopics() {
        return this.db.getAll('topics');
    },

    async getTopic(id) {
        return this.db.get('topics', id);
    },

    async getTopicsByParent(parentId) {
        return this.db.getAllFromIndex('topics', 'parentId', parentId);
    },

    async getTopicPath(topicId) {
        const path = [];
        let currentId = topicId;
        while (currentId) {
            const topic = await this.getTopic(currentId);
            if (!topic) break;
            path.unshift(topic);
            currentId = topic.parentId;
        }
        return path;
    },

    async addTopic(topic) {
        return this.db.add('topics', topic);
    },

    async putTopic(topic) {
        return this.db.put('topics', topic);
    },

    async deleteTopic(id) {
        return this.db.delete('topics', id);
    },

    // --- Items ---
    async getAllItems() {
        return this.db.getAll('items');
    },

    async getItemsByTopic(topicId) {
        return this.db.getAllFromIndex('items', 'topicId', topicId);
    },

    async getItem(id) {
        return this.db.get('items', id);
    },

    async addItem(item) {
        return this.db.add('items', item);
    },

    async putItem(item) {
        return this.db.put('items', item);
    },

    async deleteItem(id) {
        return this.db.delete('items', id);
    },

    // --- Settings ---
    async getSetting(key) {
        const setting = await this.db.get('settings', key);
        return setting;
    },

    async putSetting(key, value) {
        // We store settings as { key: '...', ...value } or just { key: '...', value: '...' }
        // The existing app uses { key: 'root', ...newRoot } and { key: 'user_palette', colors: [...] }
        if (typeof value === 'object' && value !== null) {
            return this.db.put('settings', { key, ...value });
        } else {
            return this.db.put('settings', { key, value });
        }
    },

    // --- Transactions & Advanced ---
    transaction(stores, mode) {
        return this.db.transaction(stores, mode);
    },

    async clearAll() {
        const tx = this.db.transaction(['topics', 'items'], 'readwrite');
        await tx.objectStore('topics').clear();
        await tx.objectStore('items').clear();
        await tx.done;
    }
};
