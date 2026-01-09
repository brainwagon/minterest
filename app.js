import Sortable from 'https://esm.sh/sortablejs@1.15.0';
import { openDB } from 'https://esm.sh/idb@7.1.1';

// --- Configuration ---
const DB_NAME = 'minterest-db';
const DB_VERSION = 1;
const STORAGE_KEY_OLD = 'minterest_data'; // For migration

// --- Database & State ---
let db;
let state = { topics: [] }; // In-memory mirror for fast rendering

// Initialize Database
async function initDB() {
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            // Create object stores if they don't exist
            if (!db.objectStoreNames.contains('topics')) {
                db.createObjectStore('topics', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('items')) {
                const itemStore = db.createObjectStore('items', { keyPath: 'id' });
                itemStore.createIndex('topicId', 'topicId');
            }
        },
    });
    await checkMigration();
    await refreshState();
    updateView(); // Initial render based on URL
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
    const topics = await db.getAll('topics');
    const items = await db.getAll('items');

    // Stitch items back into topics for the UI
    state.topics = topics.map(t => ({
        ...t,
        items: items.filter(i => i.topicId === t.id).sort((a, b) => (a.order || 0) - (b.order || 0))
    }));
    
    updateStorageUsage();
}

// --- Navigation ---
let currentTopicId = null;

function navigateToDashboard() {
    currentTopicId = null;
    window.location.hash = '';
    updateView();
}

function navigateToBoard(topicId) {
    window.location.hash = `topic/${topicId}`;
}

function updateView() {
    const hash = window.location.hash.substring(1);
    
    // Simple routing
    if (hash.startsWith('topic/')) {
        const topicId = hash.split('/')[1];
        const topic = state.topics.find(t => t.id === topicId);
        
        if (topic) {
            currentTopicId = topicId;
            document.getElementById('dashboard-view').classList.add('hidden');
            document.getElementById('board-view').classList.remove('hidden');
            document.getElementById('btn-dashboard').classList.remove('hidden');
            document.getElementById('board-title').textContent = topic.name;
            renderItems();
            return;
        }
    }
    
    // Default to Dashboard
    currentTopicId = null;
    document.getElementById('dashboard-view').classList.remove('hidden');
    document.getElementById('board-view').classList.add('hidden');
    document.getElementById('btn-dashboard').classList.add('hidden');
    renderTopics();
}

window.addEventListener('hashchange', updateView);

// --- Rendering ---
// --- Icons (Heroicons Outline) ---
const ICONS = {
    trash: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`,
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`
};

function renderTopics() {
    const grid = document.getElementById('topics-grid');
    grid.innerHTML = '';

    if (state.topics.length === 0) {
        grid.innerHTML = '<div class="empty-msg">No topics yet. Create one to get started!</div>';
        return;
    }

    state.topics.forEach(topic => {
        const el = document.createElement('div');
        el.className = 'card topic-card';
        el.textContent = topic.name;
        el.onclick = () => navigateToBoard(topic.id);
        
        const delBtn = document.createElement('button');
        delBtn.className = 'card-delete card-btn'; // Use card-btn for consistency
        delBtn.style.position = 'absolute';
        delBtn.style.top = '8px';
        delBtn.style.right = '8px';
        delBtn.title = "Delete Topic";
        delBtn.innerHTML = ICONS.trash;
        
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Delete topic "${topic.name}"? This will delete all items inside.`)) {
                await deleteTopic(topic.id);
            }
        };
        el.appendChild(delBtn);
        grid.appendChild(el);
    });
}

function renderItems() {
    const grid = document.getElementById('items-grid');
    grid.innerHTML = '';
    const topic = state.topics.find(t => t.id === currentTopicId);
    if (!topic) return;

    if (topic.items.length === 0) {
        grid.innerHTML = '<div class="empty-msg">This topic is empty. Drag links, images, or add a note!</div>';
        return;
    }

    topic.items.forEach(item => {
        const card = createItemCard(item);
        grid.appendChild(card);
    });

    initSortable();
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
            
            document.getElementById('storage-usage').textContent = display;
        } catch (e) {
            console.error('Storage estimate failed', e);
            document.getElementById('storage-usage').textContent = 'Unknown';
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
        document.getElementById('storage-usage').textContent = '~' + display;
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

function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;

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
            w.document.close(); // Important: Stops the loading spinner
        };
        card.style.cursor = 'pointer';
    } else if (item.type === 'link') {
        const url = new URL(item.content);
        const bgColor = getPastelColor(url.hostname);
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
        
        contentHtml = `
            <div class="link-preview" style="background-color: ${bgColor};">
                <img src="${faviconUrl}" class="link-favicon" onerror="this.style.display='none'">
                <div class="link-domain">${url.hostname}</div>
            </div>
            <div class="card-content">
                <div class="card-title">${item.title || url.hostname}</div>
                <a href="${item.content}" target="_blank" class="card-link">${item.content}</a>
                ${item.comment ? `<div class="card-comment">${item.comment}</div>` : ''}
            </div>`;
    } else { // note
        card.classList.add('card-note');
        
        // Apply random rotation only for notes
        const rotation = (Math.random() * 16 - 8).toFixed(1); // Between -8 and 8 degrees
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

    // Edit Comment Action
    card.querySelector('.btn-edit').onclick = async (e) => {
        e.stopPropagation();
        const newComment = prompt("Add a comment:", item.comment || "");
        if (newComment !== null) {
            item.comment = newComment;
            await db.put('items', item); // IDB Update
            await refreshState();
            renderItems();
        }
    };

    // Delete Action
    card.querySelector('.btn-delete').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete this ${item.type}?`)) {
            await db.delete('items', item.id); // IDB Delete
            await refreshState();
            renderItems();
        }
    };

    return card;
}

// --- Drag & Drop Reordering ---
let sortableInstance = null;
function initSortable() {
    const grid = document.getElementById('items-grid');
    if (sortableInstance) sortableInstance.destroy();

    sortableInstance = new Sortable(grid, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        draggable: '.card',
        onEnd: async () => {
            const topic = state.topics.find(t => t.id === currentTopicId);
            if (!topic) return;
            
            // Get IDs in new DOM order
            const itemEls = Array.from(grid.querySelectorAll('.card'));
            const newOrderIds = itemEls.map(el => el.dataset.id);
            
            // Update order in DB
            const tx = db.transaction('items', 'readwrite');
            const promises = [];
            
            topic.items.forEach(item => {
                const newIndex = newOrderIds.indexOf(item.id.toString());
                if (newIndex !== -1 && item.order !== newIndex) {
                    item.order = newIndex;
                    promises.push(tx.store.put(item));
                }
            });
            
            await Promise.all(promises);
            await tx.done;
            // No need to refresh full state here as DOM is already correct, 
            // but we sync memory state
            await refreshState(); 
        }
    });
}

// --- Actions (Async) ---
async function addNewTopic(name) {
    const id = crypto.randomUUID();
    await db.add('topics', { id, name });
    await refreshState();
    renderTopics();
}

async function deleteTopic(id) {
    // Delete topic and all its items
    const tx = db.transaction(['topics', 'items'], 'readwrite');
    await tx.objectStore('topics').delete(id);
    
    // Find items for this topic to delete
    // Note: A real 'index' based delete would be better but requires cursor or 'getAllKeys'
    const items = await tx.objectStore('items').index('topicId').getAllKeys(id);
    await Promise.all(items.map(itemId => tx.objectStore('items').delete(itemId)));
    
    await tx.done;
    await refreshState();
    renderTopics();
}

async function addItemToTopic(type, content, title = '') {
    if (!currentTopicId) return;
    const topic = state.topics.find(t => t.id === currentTopicId);
    
    const id = crypto.randomUUID();
    const item = { 
        id, 
        topicId: currentTopicId, 
        type, 
        content, 
        title, 
        order: topic.items.length 
    };
    
    await db.add('items', item);
    await refreshState();
    renderItems();
}

// --- Event Listeners ---
document.getElementById('app-logo').onclick = navigateToDashboard;
document.getElementById('btn-dashboard').onclick = navigateToDashboard;

const dlgTopic = document.getElementById('dlg-topic');
document.getElementById('btn-add-topic').onclick = () => dlgTopic.showModal();
document.getElementById('btn-cancel-topic').onclick = () => dlgTopic.close();
dlgTopic.onsubmit = (e) => {
    const input = document.getElementById('topic-name-input');
    addNewTopic(input.value);
    input.value = '';
};

document.getElementById('btn-add-note').onclick = () => {
    const note = prompt("Enter your note:");
    if (note) addItemToTopic('note', note);
};

// --- Drag & Drop Content ---
const dropZone = document.getElementById('drop-zone');
const dropZoneInput = document.getElementById('drop-zone-input');

// Handle Click to Upload
dropZone.onclick = () => dropZoneInput.click();

dropZoneInput.onchange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
        handleFiles(files);
        dropZoneInput.value = ''; // Reset for next selection
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
    if (!currentTopicId) return;

    const dt = e.dataTransfer;
    const files = dt.files;

    if (files && files.length > 0) {
        handleFiles(files);
    } else {
        // Handle Links/Text from other tabs
        const items = dt.items;
        for (let item of items) {
            if (item.kind === 'string' && item.type === 'text/uri-list') {
                const url = dt.getData('URL');
                if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
                    addItemToTopic('image', url);
                } else {
                    addItemToTopic('link', url);
                }
            } else if (item.kind === 'string' && item.type === 'text/plain') {
                const text = dt.getData('text/plain');
                if (text.startsWith('http')) {
                     if (text.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
                        addItemToTopic('image', text);
                    } else {
                        addItemToTopic('link', text);
                    }
                } else {
                    addItemToTopic('note', text);
                }
            }
        }
    }
});

// Window level drag support
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (currentTopicId && !dropZone.contains(e.target)) {
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
    if (!currentTopicId) return;

    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) {
        handleFiles(dt.files);
    } else {
        const items = dt.items;
        for (let item of items) {
            if (item.kind === 'string' && item.type === 'text/uri-list') {
                const url = dt.getData('URL');
                if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
                    addItemToTopic('image', url);
                } else {
                    addItemToTopic('link', url);
                }
            } else if (item.kind === 'string' && item.type === 'text/plain') {
                const text = dt.getData('text/plain');
                if (text.startsWith('http')) {
                     if (text.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
                        addItemToTopic('image', text);
                    }
                } else {
                    addItemToTopic('note', text);
                }
            }
        }
    }
});

// --- Paste Support ---
window.addEventListener('paste', async (e) => {
    if (!currentTopicId) return;

    // prevent pasting into input fields from triggering this
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;

    for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            // Handle Image File (e.g. screenshot)
            const file = item.getAsFile();
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onloadend = () => {
                addItemToTopic('image', reader.result);
            };
        } else if (item.kind === 'string' && item.type === 'text/plain') {
            // Handle Text / URL
            item.getAsString((text) => {
                if (text.startsWith('http')) {
                    if (text.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
                        addItemToTopic('image', text);
                    } else {
                        addItemToTopic('link', text);
                    }
                } else {
                    // Optional: could handle plain text as a note, but might be annoying if accidental.
                    // Let's stick to URLs for now, or maybe long text as note?
                    // User asked for "cut a url... paste it".
                    // Let's enable notes too if it looks like a note (not a url)
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

// --- Init ---
initDB();
