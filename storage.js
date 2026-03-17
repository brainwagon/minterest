import { openDB, deleteDB } from 'https://esm.sh/idb@7.1.1';

/**
 * Migrates null/undefined parentId (topics) and topicId (items) to "".
 * Must be called with an active readwrite transaction covering both stores.
 * Exported for testing.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export async function migrateNullIds(tx) {
  const topicStore = tx.objectStore('topics');
  const topics = await topicStore.getAll();
  for (const t of topics) {
    if (t.parentId === null || t.parentId === undefined) {
      t.parentId = '';
      await topicStore.put(t);
    }
  }
  const itemStore = tx.objectStore('items');
  const items = await itemStore.getAll();
  for (const i of items) {
    if (i.topicId === null || i.topicId === undefined) {
      i.topicId = '';
      await itemStore.put(i);
    }
  }
}

const DB_NAME = 'minterest-db';
const DB_VERSION = 5;

/**
 * @typedef {Object} Topic
 * @property {string} id
 * @property {string} name
 * @property {string} parentId
 * @property {string} [description]
 * @property {string} [color]
 * @property {number} [order]
 */

/**
 * @typedef {Object} Item
 * @property {string} id
 * @property {string} topicId
 * @property {string} type - 'note', 'link', or 'image'
 * @property {string} content
 * @property {string} [title]
 * @property {string} [comment]
 * @property {string} [color]
 * @property {number} [order]
 */

/**
 * Centralized storage module for minterest.
 * Handles all IndexedDB operations using the 'idb' library.
 */
export const storage = {
  db: null,

  /**
   * Initializes the database and handles upgrades.
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    this.db = await openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, newVersion, transaction) {
        console.log(`Upgrading DB from ${oldVersion} to ${newVersion}`);
        if (!db.objectStoreNames.contains('topics')) {
          const topicStore = db.createObjectStore('topics', { keyPath: 'id' });
          topicStore.createIndex('parentId', 'parentId');
        } else if (oldVersion < 5) {
          const topicStore = transaction.objectStore('topics');
          if (!topicStore.indexNames.contains('parentId')) {
            topicStore.createIndex('parentId', 'parentId');
          }
        }

        if (!db.objectStoreNames.contains('items')) {
          const itemStore = db.createObjectStore('items', { keyPath: 'id' });
          itemStore.createIndex('topicId', 'topicId');
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // Migrate null/undefined parentId and topicId to "" (Bug 2 fix).
        // Must run after all stores/indexes are created so the transaction
        // covers all required stores. Using await keeps the transaction open.
        if (oldVersion < 5) {
          await migrateNullIds(transaction);
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

  /**
   * Deletes the entire database.
   * @returns {Promise<void>}
   */
  async delete() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    return deleteDB(DB_NAME);
  },

  // --- Topics ---

  /**
   * Fetches all topics from the database.
   * @returns {Promise<Topic[]>}
   */
  async getAllTopics() {
    return this.db.getAll('topics');
  },

  /**
   * Fetches a single topic by ID.
   * @param {string} id
   * @returns {Promise<Topic|undefined>}
   */
  async getTopic(id) {
    return this.db.get('topics', id);
  },

  /**
   * Fetches all topics with a specific parent ID.
   * @param {string} parentId
   * @returns {Promise<Topic[]>}
   */
  async getTopicsByParent(parentId) {
    return this.db.getAllFromIndex('topics', 'parentId', parentId);
  },

  /**
   * Fetches the hierarchical path from the root to the specified topic.
   * @param {string} topicId
   * @returns {Promise<Topic[]>}
   */
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

  /**
   * Adds a new topic to the database.
   * @param {Topic} topic
   * @returns {Promise<string>} The topic ID.
   */
  async addTopic(topic) {
    return this.db.add('topics', topic);
  },

  /**
   * Updates an existing topic or adds it if it doesn't exist.
   * @param {Topic} topic
   * @returns {Promise<string>} The topic ID.
   */
  async putTopic(topic) {
    return this.db.put('topics', topic);
  },

  /**
   * Deletes a topic by ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteTopic(id) {
    return this.db.delete('topics', id);
  },

  // --- Items ---

  /**
   * Fetches all items from the database.
   * @returns {Promise<Item[]>}
   */
  async getAllItems() {
    return this.db.getAll('items');
  },

  /**
   * Fetches all items belonging to a specific topic.
   * @param {string} topicId
   * @returns {Promise<Item[]>}
   */
  async getItemsByTopic(topicId) {
    return this.db.getAllFromIndex('items', 'topicId', topicId);
  },

  /**
   * Fetches a single item by ID.
   * @param {string} id
   * @returns {Promise<Item|undefined>}
   */
  async getItem(id) {
    return this.db.get('items', id);
  },

  /**
   * Adds a new item to the database.
   * @param {Item} item
   * @returns {Promise<string>} The item ID.
   */
  async addItem(item) {
    return this.db.add('items', item);
  },

  /**
   * Updates an existing item or adds it if it doesn't exist.
   * @param {Item} item
   * @returns {Promise<string>} The item ID.
   */
  async putItem(item) {
    return this.db.put('items', item);
  },

  /**
   * Deletes an item by ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteItem(id) {
    return this.db.delete('items', id);
  },

  // --- Settings ---

  /**
   * Fetches a setting by key.
   * @param {string} key
   * @returns {Promise<*>}
   */
  async getSetting(key) {
    return this.db.get('settings', key);
  },

  /**
   * Updates a setting or adds it if it doesn't exist.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<string>} The setting key.
   */
  async putSetting(key, value) {
    if (typeof value === 'object' && value !== null) {
      return this.db.put('settings', { key, ...value });
    } else {
      return this.db.put('settings', { key, value });
    }
  },

  // --- Transactions & Advanced ---

  /**
   * Starts a new transaction.
   * @param {string|string[]} stores
   * @param {string} mode - 'readonly' or 'readwrite'
   * @returns {IDBTransaction}
   */
  transaction(stores, mode) {
    return this.db.transaction(stores, mode);
  },

  /**
   * Clears all topics and items from the database.
   * @returns {Promise<void>}
   */
  async clearAll() {
    const tx = this.db.transaction(['topics', 'items'], 'readwrite');
    await tx.objectStore('topics').clear();
    await tx.objectStore('items').clear();
    await tx.done;
  }
};
