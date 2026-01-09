import Sortable from 'https://esm.sh/sortablejs@1.15.0';
import { openDB, deleteDB } from 'https://esm.sh/idb@7.1.1';
import Peer from 'https://esm.sh/peerjs@1.5.4?bundle-deps';
import QRCode from 'https://esm.sh/qrcode@1.5.3';
import JSZip from 'https://esm.sh/jszip@3.10.1';

// --- Configuration ---
const DB_NAME = 'minterest-db';
const DB_VERSION = 2;
const STORAGE_KEY_OLD = 'minterest_data'; // For migration

// --- Database & State ---
let db;
let state = { topics: [], items: [], root: { name: 'My Topics', description: 'Main Board' } }; // Flat lists

// Initialize Database
async function initDB() {
    const statusEl = document.getElementById('storage-usage');
    if (statusEl) statusEl.textContent = 'Opening DB...';

    // Timeout Promise
    const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Database connection timed out. Blocked by another tab?")), 5000)
    );

    try {
        // Race openDB against timeout
        db = await Promise.race([
            openDB(DB_NAME, DB_VERSION, {
                upgrade(db, oldVersion, newVersion, transaction) {
                    console.log(`Upgrading DB from ${oldVersion} to ${newVersion}`);
                    if (!db.objectStoreNames.contains('topics')) {
                        db.createObjectStore('topics', { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains('items')) {
                        const itemStore = db.createObjectStore('items', { keyPath: 'id' });
                        itemStore.createIndex('topicId', 'topicId');
                    }
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings', { keyPath: 'key' });
                    }
                },
                blocked() {
                    console.warn("DB Blocked");
                    if (statusEl) statusEl.textContent = 'DB Blocked! Close other tabs.';
                },
                blocking() {
                    console.warn("DB Blocking");
                    db.close();
                    if (statusEl) statusEl.textContent = 'DB Blocking upgrade. Reloading...';
                    location.reload();
                },
                terminated() {
                    console.error("DB Terminated");
                    if (statusEl) statusEl.textContent = 'DB Connection Terminated.';
                }
            }),
            timeout
        ]);

        if (statusEl) statusEl.textContent = 'Migrating...';
        await checkMigration();

        if (statusEl) statusEl.textContent = 'Loading data...';
        await refreshState();

        if (statusEl) statusEl.textContent = 'Rendering...';
        updateView(); 
        
    } catch (e) {
        console.error("Init failed:", e);
        if (statusEl) {
            statusEl.innerHTML = `Error: ${e.message} <button id="btn-reset-db" style="font-size:0.7em; padding:2px 5px; margin-left:5px;">Reset App</button>`;
            
            // Add Reset Handler
            setTimeout(() => {
                const btn = document.getElementById('btn-reset-db');
                if (btn) {
                    btn.onclick = async () => {
                        if (confirm("This will DELETE ALL DATA to fix the corruption. Are you sure?")) {
                            statusEl.textContent = 'Deleting DB...';
                            try {
                                await deleteDB(DB_NAME);
                                localStorage.clear();
                                location.reload();
                            } catch (err) {
                                alert("Failed to delete: " + err.message);
                            }
                        }
                    };
                }
            }, 100);
        }
    }
}

// Migrate from localStorage if exists
async function checkMigration() {
    const oldData = localStorage.getItem(STORAGE_KEY_OLD);
    if (oldData) {
        try {
            const parsed = JSON.parse(oldData);
            console.log("Migrating data from localStorage to IndexedDB...", parsed);
            
            const tx = db.transaction(['topics', 'items'], 'readwrite');
            
            for (const topic of parsed.topics) {
                // Separate items from topic
                const { items, ...topicData } = topic;
                await tx.objectStore('topics').put(topicData);
                
                if (items && items.length > 0) {
                    for (const item of items) {
                        // Ensure item has topicId
                        item.topicId = topic.id;
                        await tx.objectStore('items').put(item);
                    }
                }
            }
            
            await tx.done;
            localStorage.removeItem(STORAGE_KEY_OLD); // Clear old data
            console.log("Migration complete.");
        } catch (e) {
            console.error("Migration failed:", e);
        }
    }
}

// Load data from DB into memory
async function refreshState() {
    try {
        state.topics = await db.getAll('topics');
        state.items = await db.getAll('items');
        
        let rootSettings = null;
        if (db.objectStoreNames.contains('settings')) {
            try {
                rootSettings = await db.get('settings', 'root');
            } catch (e) {
                console.warn("Failed to fetch settings, ignoring:", e);
            }
        }
        
        if (rootSettings) {
            state.root = rootSettings;
        } else {
            state.root = { name: 'My Topics', description: 'Main Board' };
        }
        
        updateStorageUsage();
    } catch (e) {
        console.error("Fatal error in refreshState:", e);
        throw e;
    }
}

// --- Navigation ---
let currentTopicId = null;
let editingTopicId = null;

function navigateToDashboard() {
    currentTopicId = null;
    window.location.hash = '';
    updateView();
}

function navigateToBoard(topicId) {
    window.location.hash = `topic/${topicId}`;
}

function renderBreadcrumbs(topicId) {
    const container = document.getElementById('breadcrumbs');
    if (!container) return; // In case I missed adding it back to the single view
    container.innerHTML = '';
    
    const path = [];
    if (topicId) {
        let curr = state.topics.find(t => t.id === topicId);
        while (curr) {
            path.unshift(curr);
            curr = state.topics.find(t => t.id === curr.parentId);
        }
    }
    
    // Home
    const home = document.createElement('span');
    home.className = 'crumb';
    home.textContent = 'Home';
    home.onclick = navigateToDashboard;
    container.appendChild(home);
    
    path.forEach((t, index) => {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        container.appendChild(sep);
        
        const crumb = document.createElement('span');
        crumb.className = 'crumb';
        crumb.textContent = t.name;
        if (index === path.length - 1) {
            crumb.classList.add('active');
        } else {
            crumb.onclick = () => navigateToBoard(t.id);
        }
        container.appendChild(crumb);
    });
    
    // Update Back Button behavior
    const btnBack = document.getElementById('btn-dashboard');
    if (path.length > 0) {
        btnBack.classList.remove('hidden');
        const current = path[path.length - 1];
        if (current.parentId) {
            btnBack.onclick = () => navigateToBoard(current.parentId);
        } else {
            btnBack.onclick = navigateToDashboard;
        }
    } else {
        btnBack.classList.add('hidden');
    }
}

function updateView() {
    const hash = window.location.hash.substring(1);
    
    if (hash.startsWith('topic/')) {
        const topicId = hash.split('/')[1];
        const topic = state.topics.find(t => t.id === topicId);
        
        if (topic) {
            currentTopicId = topicId;
            document.getElementById('view-title').textContent = topic.name;
            const descEl = document.getElementById('view-description');
            if (descEl) descEl.textContent = topic.description || '';
            document.getElementById('btn-edit-topic').classList.remove('hidden');
        } else {
             // Invalid topic, go home
             navigateToDashboard();
             return;
        }
    } else {
        currentTopicId = null;
        document.getElementById('view-title').textContent = state.root.name;
        document.getElementById('view-description').textContent = state.root.description;
        document.getElementById('btn-edit-topic').classList.remove('hidden');
    }
    
    renderBreadcrumbs(currentTopicId);
    renderContent();
}

window.addEventListener('hashchange', updateView);

// --- Rendering ---
// --- Icons (Heroicons Outline) ---
const ICONS = {
    trash: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`,
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`,
    palette: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>`
};

function renderContent() {
    const grid = document.getElementById('main-grid');
    grid.innerHTML = '';

    // Get Topics (where parentId matches)
    // Note: root topics have parentId: null/undefined.
    // currentTopicId is null for root.
    const topics = state.topics.filter(t => {
        if (!currentTopicId) return !t.parentId; // Root
        return t.parentId === currentTopicId;
    });

    // Get Items (where topicId matches)
    const items = state.items.filter(i => {
         if (!currentTopicId) return !i.topicId; // Root items have null topicId
         return i.topicId === currentTopicId;
    });

    // Combine and Sort
    const content = [...topics.map(t => ({...t, _type: 'topic'})), ...items.map(i => ({...i, _type: 'item'}))];
    content.sort((a, b) => (a.order || 0) - (b.order || 0));

    if (content.length === 0) {
        grid.innerHTML = '<div class="empty-msg">Nothing here yet. Add a topic, note, or drop an image!</div>';
        return;
    }

    content.forEach(obj => {
        let card;
        if (obj._type === 'topic') {
            card = createTopicCard(obj);
        } else {
            card = createItemCard(obj);
        }
        grid.appendChild(card);
    });

    initMixedSortable();
}

// --- Unified Sortable ---
let sortableInstance = null;
function initMixedSortable() {
    const grid = document.getElementById('main-grid');
    if (sortableInstance) sortableInstance.destroy();

    sortableInstance = new Sortable(grid, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        draggable: '.card', // Both topics and items have .card class
        onEnd: async () => {
            // Get all children in DOM order
            const els = Array.from(grid.querySelectorAll('.card'));
            
            const tx = db.transaction(['topics', 'items'], 'readwrite');
            const promises = [];

            els.forEach((el, index) => {
                const id = el.dataset.id;
                const type = el.dataset.type; // 'topic' or 'item' - need to ensure create functions add this
                
                if (type === 'topic') {
                    const topic = state.topics.find(t => t.id === id);
                    if (topic && topic.order !== index) {
                        topic.order = index;
                        promises.push(tx.objectStore('topics').put(topic));
                    }
                } else if (type === 'item') {
                    const item = state.items.find(i => i.id === id);
                    if (item && item.order !== index) {
                        item.order = index;
                        promises.push(tx.objectStore('items').put(item));
                    }
                }
            });

            await Promise.all(promises);
            await tx.done;
            await refreshState();
        }
    });
}

function createTopicCard(topic) {
    const el = document.createElement('div');
    el.className = 'card topic-card';
    el.dataset.id = topic.id; 
    el.dataset.type = 'topic'; // For Sortable
    el.textContent = topic.name;
    
    // Apply color if present, else default accent
    if (topic.color) {
        el.style.backgroundColor = topic.color;
        el.style.color = '#333'; 
    } else {
            el.style.backgroundColor = 'var(--accent-color)';
            el.style.color = 'white';
    }

    el.onclick = () => navigateToBoard(topic.id);
    
    // Actions Container
    const actions = document.createElement('div');
    actions.className = 'card-actions'; 
    
    // Edit Color Button
    const colorBtn = document.createElement('button');
    colorBtn.className = 'card-btn';
    colorBtn.title = "Change Color";
    colorBtn.innerHTML = ICONS.palette;
    colorBtn.onclick = (e) => {
        e.stopPropagation();
        showEditColorDialog('topic', topic.id, topic.color || '#e60023');
    };
    
    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.className = 'card-btn';
    delBtn.title = "Delete Topic";
    delBtn.innerHTML = ICONS.trash;
    delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete topic "${topic.name}"? This will delete all content inside.`)) {
            await deleteTopic(topic.id);
        }
    };
    
    actions.appendChild(colorBtn);
    actions.appendChild(delBtn);
    el.appendChild(actions);
    return el;
}

function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;
    card.dataset.type = 'item'; // For Sortable

    let contentHtml = '';
    if (item.type === 'image') {
        contentHtml = `<img src="${item.content}" class="card-image" onerror="this.src='https://placehold.co/400x300?text=Image+Not+Found'">`;
        if (item.comment) {
             contentHtml += `<div class="card-content"><div class="card-comment">${item.comment}</div></div>`;
        }
        // Open full image on click
        card.onclick = () => {
            const w = window.open('');
            w.document.write(`
                <html>
                    <head><title>Image View</title></head>
                    <body style="margin:0; display:flex; justify-content:center; align-items:center; background:#111; height:100vh;">
                        <img src="${item.content}" style="max-width:100%; max-height:100%; box-shadow: 0 0 20px rgba(0,0,0,0.5);">
                    </body>
                </html>
            `);
            w.document.close();
        };
        card.style.cursor = 'pointer';
    } else if (item.type === 'link') {
        let hostname = 'Link';
        let faviconUrl = '';
        let validUrl = false;
        
        try {
            const url = new URL(item.content);
            hostname = url.hostname;
            // Google Favicon service
            faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
            validUrl = true;
        } catch (e) {
            console.warn('Invalid URL:', item.content);
        }
        
        if (validUrl) {
            const bgColor = getPastelColor(hostname);
            contentHtml = `
                <div class="link-preview" style="background-color: ${bgColor};">
                    <img src="${faviconUrl}" class="link-favicon" onerror="this.style.display='none'">
                    <div class="link-domain">${hostname}</div>
                </div>
                <div class="card-content">
                    <div class="card-title">${item.title || hostname}</div>
                    <a href="${item.content}" target="_blank" class="card-link">${item.content}</a>
                    ${item.comment ? `<div class="card-comment">${item.comment}</div>` : ''}
                </div>`;
        } else {
             contentHtml = `
                <div class="card-content">
                    <div class="card-title">Broken Link</div>
                    <p class="card-link">${item.content}</p>
                    ${item.comment ? `<div class="card-comment">${item.comment}</div>` : ''}
                </div>`;
        }
    } else { // note
        card.classList.add('card-note');
        if (item.color) {
            card.style.background = item.color;
        }
        
        // Apply random rotation only for notes
        const rotation = (Math.random() * 16 - 8).toFixed(1); 
        card.style.setProperty('--rotation', `${rotation}deg`);

        contentHtml = `
            <div class="card-content">
                <div class="card-title">${item.content}</div>
                ${item.comment ? `<div class="card-comment">${item.comment}</div>` : ''}
            </div>`;
    }

    card.innerHTML = `
        ${contentHtml}
        <div class="card-actions">
            ${item.type === 'image' ? `<button class="card-btn btn-download" title="Download Image">${ICONS.download}</button>` : ''}
            ${item.type === 'note' ? `<button class="card-btn btn-color" title="Change Color">${ICONS.palette}</button>` : ''}
            <button class="card-btn btn-edit" title="Edit Comment">${ICONS.pencil}</button>
            <button class="card-btn btn-delete" title="Delete Item">${ICONS.trash}</button>
        </div>
    `;

    // Download Image Action
    if (item.type === 'image') {
        card.querySelector('.btn-download').onclick = (e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = item.content;
            link.download = `minterest-image-${item.id.substring(0, 8)}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
    }

    // Change Color Action (Note only)
    if (item.type === 'note') {
        card.querySelector('.btn-color').onclick = (e) => {
            e.stopPropagation();
            showEditColorDialog('item', item.id, item.color || '#fff740'); 
        };
    }

    // Edit Comment Action
    card.querySelector('.btn-edit').onclick = async (e) => {
        e.stopPropagation();
        const newComment = prompt("Add a comment:", item.comment || "");
        if (newComment !== null) {
            item.comment = newComment;
            await db.put('items', item); 
            await refreshState();
            renderContent();
        }
    };

    // Delete Action
    card.querySelector('.btn-delete').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete this ${item.type}?`)) {
            await db.delete('items', item.id);
            await refreshState();
            renderContent();
        }
    };

    return card;
}

// --- Helpers ---
async function updateStorageUsage() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        try {
            const estimate = await navigator.storage.estimate();
            const usage = estimate.usage; // Bytes
            let display = '';
            
            if (usage < 1024) display = usage + ' B';
            else if (usage < 1024 * 1024) display = (usage / 1024).toFixed(1) + ' KB';
            else display = (usage / (1024 * 1024)).toFixed(1) + ' MB';
            
            const el = document.getElementById('storage-usage');
            if (el) el.textContent = display;
        } catch (e) {
            console.error('Storage estimate failed', e);
            const el = document.getElementById('storage-usage');
            if (el) el.textContent = 'Unknown';
        }
    } else {
        // Fallback for older browsers (approximate)
        const topics = await db.getAll('topics');
        const items = await db.getAll('items');
        const json = JSON.stringify({ topics, items });
        const bytes = new Blob([json]).size;
         let display = '';
        if (bytes < 1024) display = bytes + ' B';
        else if (bytes < 1024 * 1024) display = (bytes / 1024).toFixed(1) + ' KB';
        else display = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        const el = document.getElementById('storage-usage');
        if (el) el.textContent = '~' + display;
    }
}

function getCardColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function getPastelColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 90%)`;
}

// --- Actions (Async) ---
function getNextOrder(parentId) {
    // Count both topics and items in this parent
    const topics = state.topics.filter(t => {
        if (!parentId) return !t.parentId; // Root
        return t.parentId === parentId;
    });
    const items = state.items.filter(i => {
        if (!parentId) return !i.topicId; // Root items have null topicId
        return i.topicId === parentId;
    });
    return topics.length + items.length;
}

async function addNewTopic(name, color = null, description = '', parentId = null) {
    const id = crypto.randomUUID();
    const order = getNextOrder(parentId);
    const topic = { id, name, order, description, parentId };
    if (color) topic.color = color;
    
    await db.add('topics', topic);
    await refreshState();
    renderContent();
}

async function updateTopic(id, name, color, description) {
    const tx = db.transaction('topics', 'readwrite');
    const topic = await tx.store.get(id);
    if (topic) {
        topic.name = name;
        if (color) topic.color = color;
        topic.description = description;
        await tx.store.put(topic);
        await tx.done;
        await refreshState();
        // If viewing this board, update text
        if (currentTopicId === id) {
            document.getElementById('view-title').textContent = name;
            const descEl = document.getElementById('view-description');
            if (descEl) descEl.textContent = description;
        }
        renderContent(); // Re-render in case color changed
    }
}

async function deleteTopic(id) {
    // Recursive delete
    const tx = db.transaction(['topics', 'items'], 'readwrite');
    
    async function deleteRecursive(topicId, tx) {
        await tx.objectStore('topics').delete(topicId);
        
        // Delete Items
        const items = await tx.objectStore('items').index('topicId').getAllKeys(topicId);
        await Promise.all(items.map(itemId => tx.objectStore('items').delete(itemId)));
        
        // Find Sub-topics (in memory)
        const subTopics = state.topics.filter(t => t.parentId === topicId);
        for (const sub of subTopics) {
            await deleteRecursive(sub.id, tx);
        }
    }

    await deleteRecursive(id, tx);
    
    await tx.done;
    await refreshState();
    
    if (currentTopicId === id || !state.topics.find(t => t.id === currentTopicId)) {
        if (currentTopicId === id) { 
             navigateToDashboard(); // Deleted what we are viewing
        } else {
             // Deleted a subtopic of what we are viewing (rare but possible if we add delete logic for subs later)
             // or deleted parent of current view.
             // For safety, if current topic gone, go home.
             if (currentTopicId && !state.topics.find(t => t.id === currentTopicId)) {
                 navigateToDashboard();
             } else {
                 renderContent();
             }
        }
    } else {
        renderContent();
    }
}

async function addItemToTopic(type, content, title = '', color = null) {
    // currentTopicId can be null (Root)
    const id = crypto.randomUUID();
    const order = getNextOrder(currentTopicId);
    
    const item = { 
        id, 
        topicId: currentTopicId, 
        type, 
        content, 
        title, 
        order
    };
    
    if (color) {
        item.color = color;
    }
    
    await db.add('items', item);
    await refreshState();
    renderContent();

    if (type === 'link' && !title) {
        fetchTitle(content).then(async (fetchedTitle) => {
            const tx = db.transaction('items', 'readwrite');
            const freshItem = await tx.store.get(id);
            if (freshItem) {
                if (fetchedTitle) {
                    freshItem.title = fetchedTitle;
                } else {
                    try {
                        const url = new URL(freshItem.content);
                        freshItem.title = url.hostname;
                    } catch(e) {
                        freshItem.title = "Link";
                    }
                }
                await tx.store.put(freshItem);
                await tx.done;
                await refreshState();
                renderContent();
            }
        });
    }
}

async function fetchTitle(url) {
    try {
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
        const data = await response.json();
        if (data.contents) {
            const doc = new DOMParser().parseFromString(data.contents, "text/html");
            const title = doc.title;
            return title || null;
        }
    } catch (e) {
        console.warn("Failed to fetch page title:", e);
    }
    return null;
}

// --- Event Listeners ---
document.getElementById('app-logo').onclick = navigateToDashboard;
// btn-dashboard removed (handled by breadcrumbs/view logic)

const dlgTopic = document.getElementById('dlg-topic');
const btnConfirmTopic = document.getElementById('btn-confirm-topic');

// Add Topic Button (Combined)
document.getElementById('btn-add-topic').onclick = () => {
    editingTopicId = null;
    document.querySelector('#dlg-topic h3').textContent = 'Create New Topic';
    btnConfirmTopic.textContent = 'Create';
    
    // Reset form
    document.getElementById('topic-name-input').value = '';
    document.getElementById('topic-desc-input').value = '';
    const defaultColor = document.querySelector('input[name="topic-color"][value="#e60023"]');
    if (defaultColor) defaultColor.checked = true;
    
    dlgTopic.showModal();
};

// Edit Topic Button
const btnEditTopic = document.getElementById('btn-edit-topic');
if (btnEditTopic) {
    btnEditTopic.onclick = () => {
        let name = '';
        let description = '';
        let color = '#e60023';

        if (currentTopicId) {
            const topic = state.topics.find(t => t.id === currentTopicId);
            if (!topic) return;
            editingTopicId = currentTopicId;
            name = topic.name;
            description = topic.description || '';
            color = topic.color || '#e60023';
        } else {
            // Root
            editingTopicId = 'root';
            name = state.root.name;
            description = state.root.description;
            // Root doesn't really have a color card, but we can keep the picker for consistency or hide it.
            // Let's keep it to simple.
        }

        document.querySelector('#dlg-topic h3').textContent = currentTopicId ? 'Edit Topic' : 'Edit Dashboard';
        btnConfirmTopic.textContent = 'Save Changes';

        document.getElementById('topic-name-input').value = name;
        document.getElementById('topic-desc-input').value = description;
        
        const colorInput = document.querySelector(`input[name="topic-color"][value="${color}"]`);
        if (colorInput) colorInput.checked = true;

        dlgTopic.showModal();
    };
}

document.getElementById('btn-cancel-topic').onclick = () => dlgTopic.close();
dlgTopic.onsubmit = async (e) => {
    const input = document.getElementById('topic-name-input');
    const descInput = document.getElementById('topic-desc-input');
    let color = null;
    const colorInput = document.querySelector('input[name="topic-color"]:checked');
    if (colorInput) color = colorInput.value;

    if (editingTopicId === 'root') {
        const newRoot = { 
            key: 'root', 
            name: input.value, 
            description: descInput.value 
        };
        await db.put('settings', newRoot);
        await refreshState();
        updateView(); // Explicitly update view title
    } else if (editingTopicId) {
        updateTopic(editingTopicId, input.value, color, descInput.value);
    } else {
        // currentTopicId is the parent (can be null for root)
        addNewTopic(input.value, color, descInput.value, currentTopicId);
    }
    input.value = '';
    editingTopicId = null;
};

// Note Dialog
const dlgNote = document.getElementById('dlg-note');
document.getElementById('btn-add-note').onclick = () => {
    document.getElementById('note-content-input').value = '';
    const yellow = document.querySelector('input[name="note-color"][value="#e7ed43"]');
    if (yellow) yellow.checked = true;
    dlgNote.showModal();
};
document.getElementById('btn-cancel-note').onclick = () => dlgNote.close();
dlgNote.onsubmit = (e) => {
    const content = document.getElementById('note-content-input').value;
    const color = document.querySelector('input[name="note-color"]:checked').value;
    addItemToTopic('note', content, '', color);
};

// --- Drag & Drop Content ---
const dropZone = document.getElementById('drop-zone');
const dropZoneInput = document.getElementById('drop-zone-input');

dropZone.onclick = () => dropZoneInput.click();

dropZoneInput.onchange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
        handleFiles(files);
        dropZoneInput.value = '';
    }
};

function handleFiles(files) {
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onloadend = () => {
                addItemToTopic('image', reader.result);
            };
        } else if (file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
            handleZipFile(file);
        }
    }
}

async function handleZipFile(file) {
    try {
        const zip = await JSZip.loadAsync(file);
        
        // Convert to array to process concurrently but controlled? 
        // For simplicity, we just fire and forget loop, or Promise.all if we want to wait (but handleFiles is sync void)
        // We'll just process them.
        
        const promises = [];
        
        zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir || zipEntry.name.startsWith('__MACOSX') || zipEntry.name.startsWith('.')) return; 
            
            const lowerName = zipEntry.name.toLowerCase();
            
            // Image
            if (lowerName.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
                const mime = getMimeType(lowerName);
                const p = zipEntry.async('base64').then(b64 => {
                    addItemToTopic('image', `data:${mime};base64,${b64}`);
                });
                promises.push(p);
            } 
            // Text / Markdown
            else if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
                const p = zipEntry.async('string').then(text => {
                     if (text.trim()) {
                        addItemToTopic('note', text);
                     }
                });
                promises.push(p);
            }
        });
        
        await Promise.all(promises);
        
    } catch (e) {
        console.error("Failed to process zip:", e);
        alert("Error processing zip file: " + e.message);
    }
}

function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml'
    };
    return map[ext] || 'application/octet-stream';
}

function handleDataTransfer(dt) {
    // 1. Files
    if (dt.files && dt.files.length > 0) {
        handleFiles(dt.files);
        return;
    }

    // 2. URI / URL
    let url = dt.getData('text/uri-list');
    if (!url) url = dt.getData('URL'); // Fallback

    if (url) {
        // Some browsers include comments or multiple lines
        url = url.split('\n')[0].trim();
        // Ignore internal SortableJS drags or empty strings
        if (url && !url.startsWith('#')) {
            if (url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
                addItemToTopic('image', url);
            } else {
                addItemToTopic('link', url);
            }
            return;
        }
    }

    // 3. Plain Text
    const text = dt.getData('text/plain');
    if (text) {
        const trimmed = text.trim();
        if (trimmed) {
            if (trimmed.startsWith('http')) {
                 if (trimmed.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
                    addItemToTopic('image', trimmed);
                } else {
                    addItemToTopic('link', trimmed);
                }
            } else {
                addItemToTopic('note', trimmed);
            }
        }
    }
}

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

dropZone.addEventListener('dragenter', () => dropZone.classList.add('active'));
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));

dropZone.addEventListener('drop', async (e) => {
    dropZone.classList.remove('active');
    handleDataTransfer(e.dataTransfer);
});

window.addEventListener('dragover', (e) => {
    e.preventDefault();
    // Allow drag over anywhere
    if (!dropZone.contains(e.target)) {
        document.body.classList.add('drag-over');
    }
});

window.addEventListener('dragleave', () => {
    document.body.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
    if (dropZone.contains(e.target)) return;

    e.preventDefault();
    document.body.classList.remove('drag-over');
    
    // Ignore drops from SortableJS reordering (internal)
    handleDataTransfer(e.dataTransfer);
});

// --- Paste Support ---
window.addEventListener('paste', async (e) => {
    // Allow paste anywhere
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let handled = false;

    for (const item of items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                if (file.type.startsWith('image/')) {
                    e.preventDefault();
                    handled = true;
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onloadend = () => {
                        addItemToTopic('image', reader.result);
                    };
                } else if (file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
                    e.preventDefault();
                    handled = true;
                    handleZipFile(file);
                }
            }
        } else if (item.kind === 'string' && item.type === 'text/plain') {
            // Handle Text / URL
            item.getAsString((rawText) => {
                const text = rawText.trim();
                if (text.startsWith('http')) {
                    if (!handled) { e.preventDefault(); handled = true; } // prevent double paste if multiple items
                    if (text.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
                        addItemToTopic('image', text);
                    } else {
                        addItemToTopic('link', text);
                    }
                } else if (text.length > 0) {
                     // Only treat as note if it's not a URL and not empty
                     if (!handled) { e.preventDefault(); handled = true; }
                     addItemToTopic('note', text);
                }
            });
        }
    }
});

// --- Backup & Restore (Updated for IndexedDB) ---
document.getElementById('btn-export').onclick = async () => {
    const exportData = {
        topics: await db.getAll('topics'),
        items: await db.getAll('items')
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `minterest-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
};

document.getElementById('btn-import').onclick = () => {
    document.getElementById('import-file').click();
};

document.getElementById('import-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (imported.topics && imported.items) {
                
                // Clear existing
                const txClear = db.transaction(['topics', 'items'], 'readwrite');
                await txClear.objectStore('topics').clear();
                await txClear.objectStore('items').clear();
                await txClear.done;
                
                // Import new
                const txImport = db.transaction(['topics', 'items'], 'readwrite');
                for (const t of imported.topics) await txImport.objectStore('topics').put(t);
                for (const i of imported.items) await txImport.objectStore('items').put(i);
                await txImport.done;

                await refreshState();
                navigateToDashboard();
                alert("Backup restored successfully!");
            } else {
                alert("Invalid backup file structure.");
            }
        } catch (err) {
            console.error(err);
            alert("Error restoring backup.");
        }
    };
    reader.readAsText(file);
};

// --- P2P Sync Logic ---
const btnSync = document.getElementById('btn-sync');
const dlgSync = document.getElementById('dlg-sync');
const btnCloseSync = document.getElementById('btn-close-sync');
const tabSend = document.getElementById('tab-send');
const tabReceive = document.getElementById('tab-receive');
const panelSend = document.getElementById('panel-send');
const panelReceive = document.getElementById('panel-receive');

let peer = null;
let activeConn = null;

btnSync.onclick = () => {
    dlgSync.showModal();
    initHostMode(); // Default to host
};

btnCloseSync.onclick = () => {
    dlgSync.close();
    if (peer) {
        peer.destroy();
        peer = null;
    }
};

// Tabs
tabSend.onclick = () => {
    tabSend.classList.add('active');
    tabReceive.classList.remove('active');
    panelSend.classList.remove('hidden');
    panelReceive.classList.add('hidden');
    initHostMode();
};

tabReceive.onclick = () => {
    tabReceive.classList.add('active');
    tabSend.classList.remove('active');
    panelReceive.classList.remove('hidden');
    panelSend.classList.add('hidden');
    initJoinMode();
};

// Host Mode (Sender)
function initHostMode() {
    if (peer) peer.destroy();
    document.getElementById('send-status').textContent = 'Initializing P2P Network...';
    document.getElementById('qrcode-container').innerHTML = '';
    document.getElementById('my-peer-id').textContent = '...';

    peer = new Peer(); // Auto-generate ID

    peer.on('open', (id) => {
        document.getElementById('my-peer-id').textContent = id;
        document.getElementById('send-status').textContent = 'Waiting for peer to connect...';
        
        // Generate QR Code
        QRCode.toCanvas(id, { width: 200 }, (err, canvas) => {
            if (!err) document.getElementById('qrcode-container').appendChild(canvas);
        });
    });

    peer.on('connection', (conn) => {
        activeConn = conn;
        document.getElementById('send-status').textContent = 'Peer connected! Handshaking...';
        
        conn.on('data', async (data) => {
            if (data && data.type === 'REQUEST_SYNC') {
                document.getElementById('send-status').textContent = 'Sending data... Do not close.';
                await sendDataToPeer(conn);
                document.getElementById('send-status').textContent = 'Sync Complete!';
            }
        });
    });

    peer.on('error', (err) => {
        console.error(err);
        document.getElementById('send-status').textContent = 'Error: ' + err.type;
    });
}

async function sendDataToPeer(conn) {
    const topics = await db.getAll('topics');
    const items = await db.getAll('items');
    
    // Simple Protocol: Send 1 big chunk for now (simpler for MVP)
    // PeerJS V1 handles binary chunking automatically for us.
    conn.send({
        type: 'SYNC_DATA',
        payload: { topics, items }
    });
}

// Join Mode (Receiver)
function initJoinMode() {
    if (peer) peer.destroy();
    peer = new Peer(); // We need an ID to connect
    const statusBox = document.getElementById('receive-status');
    statusBox.classList.add('hidden');
    statusBox.textContent = '';
}

document.getElementById('btn-connect').onclick = () => {
    const remoteId = document.getElementById('remote-peer-id').value.trim();
    if (!remoteId) return alert("Please enter the code from the other device.");

    const statusBox = document.getElementById('receive-status');
    statusBox.classList.remove('hidden');
    statusBox.textContent = 'Connecting to peer...';

    const conn = peer.connect(remoteId);

    conn.on('open', () => {
        statusBox.textContent = 'Connected! Requesting data...';
        conn.send({ type: 'REQUEST_SYNC' });
    });

    conn.on('data', async (msg) => {
        if (msg && msg.type === 'SYNC_DATA') {
            statusBox.textContent = 'Data received! Saving...';
            await mergeData(msg.payload);
            statusBox.textContent = 'Sync Successful! Reloading...';
            setTimeout(() => {
                location.reload();
            }, 1000);
        }
    });

    conn.on('error', (err) => {
         statusBox.textContent = 'Connection Error: ' + err;
    });
};

async function mergeData(data) {
    const tx = db.transaction(['topics', 'items'], 'readwrite');
    
    // Simple Merge: Add missing. (Won't overwrite modified items with same ID, safer for now)
    // Ideally we'd compare timestamps.
    
    for (const t of data.topics) {
        // IDB 'put' overwrites. Let's use it to ensure we get the latest version from the sender.
        // If we wanted "safe" merge, we'd use 'add' and ignore errors.
        await tx.objectStore('topics').put(t); 
    }
    
    for (const i of data.items) {
        await tx.objectStore('items').put(i);
    }
    
    await tx.done;
}

// --- Init ---
initDB().catch(e => {
    console.error("Initialization failed:", e);
    document.getElementById('main-grid').innerHTML = `<div class="empty-msg error">Failed to load application: ${e.message}</div>`;
});

// --- Edit Color Dialog Logic ---
const dlgEditColor = document.getElementById('dlg-edit-color');
let currentEditTarget = null; // { type: 'topic'|'item', id: '...' }

function showEditColorDialog(type, id, currentColor) {
    currentEditTarget = { type, id };
    
    // Select current color in picker
    // Default to first if none matches
    const inputs = document.querySelectorAll('input[name="edit-color"]');
    let matched = false;
    inputs.forEach(input => {
        if (input.value === currentColor) {
            input.checked = true;
            matched = true;
        }
    });
    if (!matched && inputs.length > 0) inputs[0].checked = true;

    dlgEditColor.showModal();
}

document.getElementById('btn-cancel-edit-color').onclick = () => dlgEditColor.close();

dlgEditColor.onsubmit = async (e) => {
    if (!currentEditTarget) return;

    const colorInput = document.querySelector('input[name="edit-color"]:checked');
    const newColor = colorInput ? colorInput.value : null;

    if (newColor) {
        const tx = db.transaction([currentEditTarget.type === 'topic' ? 'topics' : 'items'], 'readwrite');
        const store = tx.objectStore(currentEditTarget.type === 'topic' ? 'topics' : 'items');
        
        const entity = await store.get(currentEditTarget.id);
        if (entity) {
            entity.color = newColor;
            await store.put(entity);
            await tx.done;
            await refreshState();
            renderContent();
        }
    }
    currentEditTarget = null;
};
