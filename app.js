import { storage } from './storage.js';
import { escapeHtml } from './utils.js';
import Peer from 'https://esm.sh/peerjs@1.5.4?bundle-deps';
import QRCode from 'https://esm.sh/qrcode@1.5.3';
import JSZip from 'https://esm.sh/jszip@3.10.1';

// --- Configuration ---
const STORAGE_KEY_OLD = 'minterest_data'; // For migration
const RECYCLE_BIN_ID = 'recycle-bin';

const DEFAULT_PALETTE = [
    '#e60023', '#f86398', '#e7ed43', '#58d3d6', 
    '#fe8e45', '#f8838a', '#ffffff', '#000000', 
    '#4a90e2', '#50e3c2', '#b8e986', '#bd10e0'
];

// --- Drag & Drop State ---
let dragState = {
    draggedId: null,
    draggedType: null,
    draggedElement: null,
    targetId: null,
    targetType: null, // 'nest' or 'reorder'
    dropPosition: null // 'before' or 'after' (for reorder)
};
let insertionMarker = null;

async function emptyRecycleBin() {
    if (!confirm("Are you sure you want to permanently delete everything in the Recycle Bin? This cannot be undone.")) {
        return;
    }

    const tx = storage.transaction(['topics', 'items'], 'readwrite');
    
    // 1. Delete all items in bin
    const items = await tx.objectStore('items').index('topicId').getAllKeys(RECYCLE_BIN_ID);
    await Promise.all(items.map(id => tx.objectStore('items').delete(id)));
    
    // 2. Delete all topics in bin and their entire descendant trees.
    const allTopics = await tx.objectStore('topics').getAll();
    const binTopics = allTopics.filter(t => t.parentId === RECYCLE_BIN_ID);

    async function deleteBinTopicRecursively(topicId, allTopicsSnapshot, transaction) {
        const childItems = await transaction.objectStore('items')
            .index('topicId').getAllKeys(topicId);
        await Promise.all(childItems.map(id => transaction.objectStore('items').delete(id)));
        const subTopics = allTopicsSnapshot.filter(t => t.parentId === topicId);
        for (const sub of subTopics) {
            await deleteBinTopicRecursively(sub.id, allTopicsSnapshot, transaction);
        }
        await transaction.objectStore('topics').delete(topicId);
    }

    for (const binTopic of binTopics) {
        await deleteBinTopicRecursively(binTopic.id, allTopics, tx);
    }

    await tx.done;
    
    await refreshState();
    renderContent();
    updateView(); 
}

function renderSpecialTopics() {
    const grid = document.getElementById('special-topics-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const card = document.createElement('div');
    card.className = 'card topic-card recycle-card';
    card.dataset.id = RECYCLE_BIN_ID;
    card.textContent = ''; // Explicitly clear any inherited text
    card.innerHTML = `
        <div style="pointer-events: none; text-align: center; display: flex; align-items: center; justify-content: center; height: 100%;">
            <img src="recycle.png" style="width: 120px; height: 120px; object-fit: contain;">
        </div>
        <div class="card-drop-overlay"></div>
    `;
    
    card.onclick = () => navigateToBoard(RECYCLE_BIN_ID);
    
    card.ondragover = (e) => { 
        e.preventDefault(); 
        e.dataTransfer.dropEffect = 'move'; 
        const overlay = card.querySelector('.card-drop-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.classList.add('drag-over-target');
        }
    };
    
    card.ondragleave = () => {
        const overlay = card.querySelector('.card-drop-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.remove('drag-over-target');
        }
    };
    
    card.ondrop = async (e) => {
        e.preventDefault();
        const overlay = card.querySelector('.card-drop-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.remove('drag-over-target');
        }

        const itemId = e.dataTransfer.getData('application/minterest-id');
        const type = e.dataTransfer.getData('application/minterest-type');
        
        if (itemId && type) {
            if (confirm("Move to Recycle Bin?")) {
                await moveToTopic(itemId, type, RECYCLE_BIN_ID);
            }
        }
    };

    grid.appendChild(card);
}

// --- Database & State ---
let state = { 
    topics: [], 
    items: [], 
    root: { name: 'My Topics', description: 'Main Board' },
    userPalette: []
}; 

// Initialize Database
async function initDB() {
    const statusEl = document.getElementById('storage-usage');
    if (statusEl) statusEl.textContent = 'Opening DB...';

    // Timeout Promise
    const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Database connection timed out. Blocked by another tab?")), 5000)
    );

    try {
        await Promise.race([storage.init(), timeout]);

        if (statusEl) statusEl.textContent = 'Migrating...';
        await checkMigration();

        if (statusEl) statusEl.textContent = 'Loading data...';
        await refreshState();

        if (statusEl) statusEl.textContent = 'Rendering...';
        updateView(); 
        
    } catch (e) {
        console.error("Init failed:", e);
        if (statusEl) {
            statusEl.innerHTML = `Error: ${e.message} <button id="btn-reset-app" style="font-size:0.7em; padding:2px 5px; margin-left:5px;">Reset App</button>`;
            
            // Add Reset Handler
            setTimeout(() => {
                const btn = document.getElementById('btn-reset-app');
                if (btn) {
                    btn.onclick = async () => {
                        if (confirm("This will DELETE ALL DATA to fix the corruption. Are you sure?")) {
                            statusEl.textContent = 'Deleting DB...';
                            try {
                                await storage.delete();
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
            
            const tx = storage.db.transaction(['topics', 'items'], 'readwrite');
            
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
            
            await tx.done; // Commit the transaction
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
        // Optimized: Only load what is needed for current view
        state.topics = await storage.getTopicsByParent(currentTopicId);
        state.items = await storage.getItemsByTopic(currentTopicId);
        
        if (currentTopicId && currentTopicId !== RECYCLE_BIN_ID) {
            state.currentTopic = await storage.getTopic(currentTopicId);
        } else {
            state.currentTopic = null;
        }

        let rootSettings = null;
        let userPalette = [];
        let themeSetting = null;

        if (storage.db.objectStoreNames.contains('settings')) {
            try {
                rootSettings = await storage.getSetting('root');
                userPalette = await storage.getSetting('user_palette') || [];
                themeSetting = await storage.getSetting('theme');
            } catch (e) {
                console.warn("Failed to fetch settings, ignoring:", e);
            }
        }
        
        if (rootSettings) {
            state.root = rootSettings;
        } else {
            state.root = { name: 'My Topics', description: 'Main Board' };
        }
        state.userPalette = userPalette.colors || []; 
        
        // Apply theme
        if (themeSetting) {
            applyTheme(themeSetting.isDark, false); // Don't re-save what we just loaded
        } else {
            // Default to system preference? For now just light mode
            applyTheme(false, false);
        }

        updateStorageUsage();
    } catch (e) {
        console.error("Fatal error in refreshState:", e);
        throw e;
    }
}

// --- Navigation ---
let currentTopicId = ""; // "" for Root
let editingTopicId = null;
let editingItem = null;

/**
 * Navigates to the main dashboard (root board).
 */
function navigateToDashboard() {
    if (window.location.hash === '') {
        updateView();
    } else {
        window.location.hash = '';
    }
}

/**
 * Navigates to a specific topic board.
 * @param {string} topicId - The ID of the topic to navigate to.
 */
function navigateToBoard(topicId) {
    const newHash = `#topic/${topicId}`;
    if (window.location.hash === newHash) {
        updateView();
    } else {
        window.location.hash = newHash;
    }
}

/**
 * Renders the breadcrumb navigation path.
 * @param {Array<Object>} path - Array of topic objects representing the path from root.
 */
async function renderBreadcrumbs(path) {
    const container = document.getElementById('breadcrumbs');
    if (!container) return; 
    container.innerHTML = '';

    /**
     * Attaches drag-and-drop listeners to a breadcrumb element.
     * @param {HTMLElement} el 
     * @param {string} targetId 
     */
    const attachDrop = (el, targetId) => {
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.classList.add('drag-over-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over-target'));
        el.addEventListener('drop', async (e) => {
            e.preventDefault();
            el.classList.remove('drag-over-target');
            const itemId = e.dataTransfer.getData('application/minterest-id');
            const type = e.dataTransfer.getData('application/minterest-type');
            if (itemId && type) {
                await moveToTopic(itemId, type, targetId || "");
            }
        });
    };

    // Home
    const home = document.createElement('span');
    home.className = 'crumb';
    home.textContent = 'Home';
    home.onclick = navigateToDashboard;
    attachDrop(home, ""); // Drop to root
    container.appendChild(home);

    path.forEach((t, index) => {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        container.appendChild(sep);

        const crumb = document.createElement('span');
        crumb.className = 'crumb';
        crumb.textContent = t.name;

        attachDrop(crumb, t.id);

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

        // Re-clone to remove old listeners if any (simple way to reset)
        const newBtn = btnBack.cloneNode(true);
        btnBack.parentNode.replaceChild(newBtn, btnBack);

        attachDrop(newBtn, current.parentId || "");

        if (current.parentId) {
            newBtn.onclick = () => navigateToBoard(current.parentId);
        } else {
            newBtn.onclick = navigateToDashboard;
        }
    } else {
        btnBack.classList.add('hidden');
    }
}

/**
 * Updates the application view based on the current URL hash.
 * Fetches necessary data from storage and triggers rendering.
 */
async function updateView() {
    const hash = window.location.hash.substring(1);
    const statusEl = document.getElementById('storage-usage');

    // Reset standard buttons visibility
    document.getElementById('btn-add-topic').classList.remove('hidden');
    document.getElementById('btn-add-note').classList.remove('hidden');
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('btn-edit-topic').classList.add('hidden');

    if (hash.startsWith('topic/')) {
        currentTopicId = hash.split('/')[1];
    } else {
        currentTopicId = "";
    }

    const grid = document.getElementById('main-grid');
    if (grid) grid.classList.add('loading');
    if (statusEl) statusEl.textContent = 'Loading...';

    await refreshState();

    const path = await storage.getTopicPath(currentTopicId);

    if (currentTopicId === RECYCLE_BIN_ID) {
        document.getElementById('view-title').textContent = 'Recycle Bin';
        document.getElementById('view-description').textContent = 'Items here are pending permanent deletion.';
        document.getElementById('btn-add-topic').classList.add('hidden');
        document.getElementById('btn-add-note').classList.add('hidden');
        document.getElementById('drop-zone').classList.add('hidden');
        path.push({ id: RECYCLE_BIN_ID, name: 'Recycle Bin', parentId: "" });
    } else if (currentTopicId) {
        const topic = state.currentTopic;
        if (topic) {
            document.getElementById('view-title').textContent = topic.name;
            const descEl = document.getElementById('view-description');
            if (descEl) descEl.textContent = topic.description || '';
            document.getElementById('btn-edit-topic').classList.remove('hidden');
        } else {
            // Handle missing topic (maybe deleted?)
            navigateToDashboard();
            return;
        }
    } else {
        document.getElementById('view-title').textContent = state.root.name;
        document.getElementById('view-description').textContent = state.root.description;
        document.getElementById('btn-edit-topic').classList.remove('hidden');
    }

    // Special Topics Grid Logic
    const specialGrid = document.getElementById('special-topics-grid');
    if (specialGrid) {
        if (!currentTopicId) { // Root
            specialGrid.style.display = 'flex';
            renderSpecialTopics();
        } else {
            specialGrid.style.display = 'none';
        }
    }

    // Empty Bin Button Logic
    const btnEmpty = document.getElementById('btn-empty-bin');
    if (btnEmpty) {
        if (currentTopicId === RECYCLE_BIN_ID) {
            btnEmpty.classList.remove('hidden');
            btnEmpty.onclick = emptyRecycleBin;
        } else {
            btnEmpty.classList.add('hidden');
        }
    }

    await renderBreadcrumbs(path);
    renderContent();
    scanCurrentView();
    if (grid) grid.classList.remove('loading');
    if (statusEl) statusEl.textContent = 'Ready';
}

window.addEventListener('hashchange', updateView);

// --- Rendering ---
// --- Icons (Heroicons Outline) ---
const ICONS = {
    trash: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`,
    pencil: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`,
    palette: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    moveUp: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9l3-3m0 0l3 3m-3-3v10M5 21h14" /></svg>`
};

// --- Expiration Logic ---
async function checkExpiration(node, type) {
    if (!node.expiresAt) return false;
    
    const expiry = new Date(node.expiresAt).getTime();
    if (Date.now() > expiry) {
        console.log(`Node ${node.id} expired. Moving to Recycle Bin.`);
        
        const tx = storage.db.transaction([type === 'topic' ? 'topics' : 'items'], 'readwrite');
        const store = tx.objectStore(type === 'topic' ? 'topics' : 'items');
        
        const freshNode = await store.get(node.id);
        if (freshNode) {
            // Unset expiry
            delete freshNode.expiresAt;
            
            // Move to bin
            if (type === 'topic') {
                freshNode.parentId = RECYCLE_BIN_ID;
            } else {
                freshNode.topicId = RECYCLE_BIN_ID;
            }
            
            await store.put(freshNode);
        }
        await tx.done;
        return true;
    }
    return false;
}

async function scanCurrentView() {
    // Only check if we are NOT in the recycle bin already
    if (currentTopicId === RECYCLE_BIN_ID) return;

    let changesMade = false;

    for (const t of state.topics) {
        if (await checkExpiration(t, 'topic')) changesMade = true;
    }

    for (const i of state.items) {
        if (await checkExpiration(i, 'item')) changesMade = true;
    }

    if (changesMade) {
        await refreshState();
        renderContent();
    }
}

// Global Interval (5 minutes)
setInterval(scanCurrentView, 5 * 60 * 1000);

function renderContent() {
    const grid = document.getElementById('main-grid');
    grid.innerHTML = '';

    // state.topics and state.items are already filtered by refreshState for the current view
    const topics = state.topics;
    const items = state.items;

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

    setupNativeDnD();
}

// --- Native Drag & Drop ---
function setupNativeDnD() {
    const grid = document.getElementById('main-grid');
    
    // Create/Ensure Insertion Marker
    if (!insertionMarker) {
        insertionMarker = document.createElement('div');
        insertionMarker.className = 'insertion-marker';
    }
    
    if (!grid.contains(insertionMarker)) {
        grid.appendChild(insertionMarker);
    }

    grid.removeEventListener('dragstart', handleDragStart); // Avoid duplicates
    grid.removeEventListener('dragover', handleDragOver);
    grid.removeEventListener('dragleave', handleDragLeave);
    grid.removeEventListener('drop', handleDrop);
    grid.removeEventListener('dragend', handleDragEnd);

    grid.addEventListener('dragstart', handleDragStart);
    grid.addEventListener('dragover', handleDragOver);
    grid.addEventListener('dragleave', handleDragLeave);
    grid.addEventListener('drop', handleDrop);
    grid.addEventListener('dragend', handleDragEnd);
}

function handleDragStart(e) {
    const card = e.target.closest('.card');
    if (!card) return;

    dragState.draggedId = card.dataset.id;
    dragState.draggedType = card.dataset.type;
    dragState.draggedElement = card;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/minterest-id', card.dataset.id);
    e.dataTransfer.setData('application/minterest-type', card.dataset.type);

    // Delay adding class so visual drag image is taken normally
    setTimeout(() => card.classList.add('dragging'), 0);
    
    // Enable drop overlays on all topic cards
    document.querySelectorAll('.topic-card .card-drop-overlay').forEach(el => {
        el.style.display = 'flex';
    });
}

function handleDragOver(e) {
    e.preventDefault(); // Allow drop
    e.dataTransfer.dropEffect = 'move';

    let targetCard = e.target.closest('.card');
    
    // If hovering over grid gap, find closest card
    if (!targetCard) {
        targetCard = getClosestCard(e.clientX, e.clientY);
    }

    if (!targetCard || targetCard === dragState.draggedElement) {
        clearVisuals();
        return;
    }

    const rect = targetCard.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Check for Nesting (Center of Topic Card)
    if (targetCard.classList.contains('topic-card') && targetCard.dataset.id !== dragState.draggedId) {
        // Inner 50% (Increase reorder margin to 25%)
        const marginX = rect.width * 0.25;
        const marginY = rect.height * 0.25;
        
        if (
            mouseX > rect.left + marginX &&
            mouseX < rect.right - marginX &&
            mouseY > rect.top + marginY &&
            mouseY < rect.bottom - marginY
        ) {
            // We are in NEST zone
            clearVisuals();
            const overlay = targetCard.querySelector('.card-drop-overlay');
            if (overlay) overlay.classList.add('drag-over-target');
            
            dragState.targetId = targetCard.dataset.id;
            dragState.targetType = 'nest';
            return;
        }
    }

    // Check for Reordering (Edges / Between Items)
    // Decide based on left/right half for masonry grid (simplified)
    const midX = rect.left + rect.width / 2;
    
    clearVisuals();
    
    // Gap size is 1rem (16px). Center of gap is roughly 8px from edge.
    // We want the 6px marker centered in that 16px gap.
    // Left gap center = offsetLeft - 8px. Marker left = offsetLeft - 8 - 3 = -11px relative to card?
    // Let's rely on offsetLeft.
    
    if (mouseX < midX) {
        // Left Side -> Insert Before
        insertionMarker.style.display = 'block';
        insertionMarker.style.height = rect.height + 'px';
        insertionMarker.style.top = (targetCard.offsetTop) + 'px';
        // Place in the middle of the left gutter (approx -8px from edge)
        insertionMarker.style.left = (targetCard.offsetLeft - 11) + 'px'; 
        
        dragState.targetId = targetCard.dataset.id;
        dragState.targetType = 'reorder';
        dragState.dropPosition = 'before';
    } else {
        // Right Side -> Insert After
        insertionMarker.style.display = 'block';
        insertionMarker.style.height = rect.height + 'px';
        insertionMarker.style.top = (targetCard.offsetTop) + 'px';
        // Place in the middle of the right gutter (approx +8px from right edge)
        insertionMarker.style.left = (targetCard.offsetLeft + rect.width + 5) + 'px';
        
        dragState.targetId = targetCard.dataset.id;
        dragState.targetType = 'reorder';
        dragState.dropPosition = 'after';
    }
}

function getClosestCard(x, y) {
    const grid = document.getElementById('main-grid');
    const cards = Array.from(grid.querySelectorAll('.card:not(.dragging)'));
    
    return cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        // Calculate distance from center of box to cursor
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const dist = Math.hypot(x - centerX, y - centerY);
        
        if (dist < closest.dist) {
            return { dist: dist, element: child };
        } else {
            return closest;
        }
    }, { dist: Number.POSITIVE_INFINITY }).element;
}

function handleDragLeave(e) {
    // Basic cleanup if leaving the grid entirely, but tricky because dragleave fires when entering children
    // Usually handled by dragover clearing visuals if target changes
}

async function handleDrop(e) {
    e.preventDefault();
    const draggedId = dragState.draggedId;

    if (!draggedId) return;

    e.stopPropagation(); // Prevent bubbling to window drop handler.

    if (dragState.targetType === 'nest' && dragState.targetId) {
        await moveToTopic(draggedId, dragState.draggedType, dragState.targetId);
    } else if (dragState.targetType === 'reorder' && dragState.targetId) {
        await reorderItem(draggedId, dragState.targetId, dragState.dropPosition);
    }

    handleDragEnd();
}

function handleDragEnd() {
    if (dragState.draggedElement) {
        dragState.draggedElement.classList.remove('dragging');
    }
    
    clearVisuals();
    
    // Hide overlays
    document.querySelectorAll('.topic-card .card-drop-overlay').forEach(el => {
        el.style.display = 'none';
    });

    // Reset State
    dragState = {
        draggedId: null,
        draggedType: null,
        draggedElement: null,
        targetId: null,
        targetType: null,
        dropPosition: null
    };
}

function clearVisuals() {
    if (insertionMarker) insertionMarker.style.display = 'none';
    document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target'));
}

async function moveToTopic(itemId, type, targetTopicId) {
    // Cycle Check
    if (type === 'topic') {
        let curr = state.topics.find(t => t.id === targetTopicId);
        while (curr) {
            if (curr.id === itemId) {
                alert("Cannot move a topic into its own sub-topic!");
                return;
            }
            curr = state.topics.find(t => t.id === curr.parentId);
        }
    }
    
    // Prevent moving into self (if item is topic)
    if (itemId === targetTopicId) return;

    const tx = storage.db.transaction(['topics', 'items'], 'readwrite');
    
    if (type === 'topic') {
        const topic = await tx.objectStore('topics').get(itemId);
        if (topic) {
            topic.parentId = targetTopicId;
            topic.order = 999999; 
            await tx.objectStore('topics').put(topic);
        }
    } else {
        const item = await tx.objectStore('items').get(itemId);
        if (item) {
            item.topicId = targetTopicId;
            item.order = 999999;
            await tx.objectStore('items').put(item);
        }
    }

    await tx.done;
    await refreshState();
    renderContent();
}

async function reorderItem(draggedId, targetId, position) {
    // 1. Get List of current items in view (sorted by order)
    const grid = document.getElementById('main-grid');
    const cards = Array.from(grid.querySelectorAll('.card'));
    const currentOrder = cards.map(c => c.dataset.id);
    
    // 2. Calculate new order
    const fromIndex = currentOrder.indexOf(draggedId);
    let toIndex = currentOrder.indexOf(targetId);
    
    if (position === 'after') toIndex++;
    
    // Adjust if moving downwards
    if (fromIndex < toIndex) toIndex--;
    
    if (fromIndex === toIndex) return;
    
    // 3. Move in Array
    const newOrderIds = [...currentOrder];
    newOrderIds.splice(fromIndex, 1);
    newOrderIds.splice(toIndex, 0, draggedId);
    
    // 4. Update DB Orders
    const tx = storage.db.transaction(['topics', 'items'], 'readwrite');
    const promises = [];
    
    newOrderIds.forEach((id, index) => {
        // Find in state (fast)
        let obj = state.topics.find(t => t.id === id);
        let store = 'topics';
        if (!obj) {
            obj = state.items.find(i => i.id === id);
            store = 'items';
        }
        
        if (obj && obj.order !== index) {
            obj.order = index;
            promises.push(tx.objectStore(store).put(obj));
        }
    });
    
    await Promise.all(promises);
    await tx.done;
    await refreshState();
    renderContent();
}

function createTopicCard(topic) {
    const el = document.createElement('div');
    el.className = 'card topic-card';
    el.draggable = true; // Native DnD
    el.dataset.id = topic.id; 
    el.dataset.type = 'topic'; 
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
    
    // Explicit Drop Overlay (Visual Only, Logic in Grid Delegate)
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'card-drop-overlay';
    el.appendChild(dropOverlay);
    
    // Actions Container
    const actions = document.createElement('div');
    actions.className = 'card-actions'; 
    
    // Expiration Button
    const clockBtn = document.createElement('button');
    clockBtn.className = 'card-btn';
    clockBtn.title = "Set Expiration";
    clockBtn.innerHTML = ICONS.clock;
    if (topic.expiresAt) {
        clockBtn.style.color = '#d9534f'; // Red if set
    }
    clockBtn.onclick = (e) => {
        e.stopPropagation();
        showExpirationDialog('topic', topic.id, topic.expiresAt);
    };

    // Edit Color Button
    const colorBtn = document.createElement('button');
    colorBtn.className = 'card-btn';
    colorBtn.title = "Change Color";
    colorBtn.innerHTML = ICONS.palette;
    colorBtn.onclick = (e) => {
        e.stopPropagation();
        showEditColorDialog('topic', topic.id, topic.color || '#e60023');
    };

    // Edit Button
    const editBtn = document.createElement('button');
    editBtn.className = 'card-btn';
    editBtn.title = "Edit Topic";
    editBtn.innerHTML = ICONS.pencil;
    editBtn.onclick = (e) => {
        e.stopPropagation();
        showEditTopicDialog(topic);
    };
    
    // Move Up Button
    const moveUpBtn = document.createElement('button');
    moveUpBtn.className = 'card-btn';
    moveUpBtn.title = 'Move up one level';
    moveUpBtn.innerHTML = ICONS.moveUp;
    if (currentTopicId === '') {
        moveUpBtn.disabled = true;
        moveUpBtn.style.opacity = '0.3';
    }
    moveUpBtn.onclick = async (e) => {
        e.stopPropagation();
        const grandparentId = state.currentTopic ? state.currentTopic.parentId : '';
        await moveToTopic(topic.id, 'topic', grandparentId);
    };

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.className = 'card-btn';
    delBtn.title = "Delete Topic";
    delBtn.innerHTML = ICONS.trash;
    delBtn.onclick = async (e) => {
        e.stopPropagation();
        await deleteTopic(topic.id);
    };

    actions.appendChild(clockBtn);
    actions.appendChild(colorBtn);
    actions.appendChild(editBtn);
    actions.appendChild(moveUpBtn);
    actions.appendChild(delBtn);
    el.appendChild(actions);
    return el;
}

function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true; // Native DnD
    card.dataset.id = item.id;
    card.dataset.type = 'item'; 

    // Apply User Color Override
    if (item.color) {
        card.style.background = item.color;
    }

    let contentHtml = '';
    if (item.type === 'image') {
        contentHtml = `<img src="${escapeHtml(item.content)}" class="card-image" onerror="this.src='https://placehold.co/400x300?text=Image+Not+Found'">`;
        if (item.comment) {
             contentHtml += `<div class="card-content"><div class="card-comment">${escapeHtml(item.comment)}</div></div>`;
        }
        // Open full image on click
        card.onclick = () => {
            const w = window.open('');
            w.document.write(`
                <html>
                    <head><title>Image View</title></head>
                    <body style="margin:0; display:flex; justify-content:center; align-items:center; background:#111; height:100vh;">
                        <img src="${escapeHtml(item.content)}" style="max-width:100%; max-height:100%; box-shadow: 0 0 20px rgba(0,0,0,0.5);">
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
            // Use item.color if present, else pastel
            const bgColor = item.color ? 'transparent' : getPastelColor(hostname);

            contentHtml = `
                <div class="link-title-bar" style="background-color: ${bgColor};">
                    <div class="link-card-title">${escapeHtml(item.title || hostname)}</div>
                    <img src="${faviconUrl}" class="link-favicon" onerror="this.style.display='none'">
                </div>
                <div class="card-content">
                    <div class="link-domain">${escapeHtml(hostname)}</div>
                    ${item.comment ? `<div class="card-comment">${escapeHtml(item.comment)}</div>` : ''}
                </div>`;
        } else {
             contentHtml = `
            <div class="card-content">
                <div class="card-title">Broken Link</div>
                <p class="card-link">${escapeHtml(item.content)}</p>
                ${item.comment ? `<div class="card-comment">${escapeHtml(item.comment)}</div>` : ''}
            </div>`;
        }

        // Make entire card clickable for links
        card.style.cursor = 'pointer';
        card.onclick = (e) => {
            // Don't navigate if selecting text
            if (window.getSelection().toString().length > 0) return;
            window.open(item.content, '_blank');
        };

    } else { // note
        card.classList.add('card-note');
        // Notes use background already set on card, but need rotation

        // Apply random rotation only for notes
        const rotation = (Math.random() * 16 - 8).toFixed(1);
        card.style.setProperty('--rotation', `${rotation}deg`);

        contentHtml = `
            <div class="card-content">
                <div class="card-title">${escapeHtml(item.content)}</div>
                ${item.comment ? `<div class="card-comment">${escapeHtml(item.comment)}</div>` : ''}
            </div>`;
    }

    card.innerHTML = `
        ${contentHtml}
        <div class="card-actions">
            <button class="card-btn btn-expiration" title="Set Expiration" style="${item.expiresAt ? 'color: #d9534f;' : ''}">${ICONS.clock}</button>
            ${item.type === 'image' ? `<button class="card-btn btn-download" title="Download Image">${ICONS.download}</button>` : ''}
            <button class="card-btn btn-color" title="Change Color">${ICONS.palette}</button>
            <button class="card-btn btn-edit" title="Edit Comment">${ICONS.pencil}</button>
            <button class="card-btn btn-delete" title="Delete Item">${ICONS.trash}</button>
        </div>
    `;

    // Expiration Action
    card.querySelector('.btn-expiration').onclick = (e) => {
        e.stopPropagation();
        showExpirationDialog('item', item.id, item.expiresAt);
    };

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

    // Change Color Action (All types)
    card.querySelector('.btn-color').onclick = (e) => {
        e.stopPropagation();
        showEditColorDialog('item', item.id, item.color || '#ffffff'); 
    };

    // Edit Comment / Content Action
    card.querySelector('.btn-edit').onclick = async (e) => {
        e.stopPropagation();
        
        if (item.type === 'note') {
            editingItem = item;
            document.querySelector('#dlg-note h3').textContent = 'Edit Note';
            document.getElementById('btn-confirm-note').textContent = 'Save Changes';
            
            document.getElementById('note-content-input').value = item.content;
            document.getElementById('note-comment-input').value = item.comment || '';
            
            const colorToSelect = item.color || '#e7ed43';
            const colorInput = document.querySelector(`input[name="note-color"][value="${colorToSelect}"]`);
            if (colorInput) colorInput.checked = true;
            
            dlgNote.showModal();
        } else if (item.type === 'link') {
            let hostname = 'Link';
            try { hostname = new URL(item.content).hostname; } catch (e) {}
            const dlgEditLink = document.getElementById('dlg-edit-link');
            document.getElementById('link-title-input').value = item.title || hostname;
            document.getElementById('link-comment-input').value = item.comment || '';
            dlgEditLink.showModal();
            await new Promise((resolve) => {
                const onSubmit = async () => {
                    const newTitle = document.getElementById('link-title-input').value.trim();
                    item.title = newTitle || hostname;
                    item.comment = document.getElementById('link-comment-input').value;
                    await storage.db.put('items', item);
                    await refreshState();
                    renderContent();
                    cleanup();
                    resolve();
                };
                const onCancel = () => { cleanup(); resolve(); };
                function cleanup() {
                    dlgEditLink.removeEventListener('submit', onSubmit);
                    document.getElementById('btn-cancel-edit-link').removeEventListener('click', onCancel);
                }
                dlgEditLink.addEventListener('submit', onSubmit);
                document.getElementById('btn-cancel-edit-link').addEventListener('click', onCancel);
            });
        } else {
            const newComment = prompt("Add a comment:", item.comment || "");
            if (newComment !== null) {
                item.comment = newComment;
                await storage.db.put('items', item);
                await refreshState();
                renderContent();
            }
        }
    };

    // Delete Action
    card.querySelector('.btn-delete').onclick = async (e) => {
        e.stopPropagation();
        
        const isPermanent = (currentTopicId === RECYCLE_BIN_ID) || (item.topicId === RECYCLE_BIN_ID);
        const msg = isPermanent ? `Permanently delete this ${item.type}?` : `Move this ${item.type} to Recycle Bin?`;
        
        if (confirm(msg)) {
            if (isPermanent) {
                await storage.db.delete('items', item.id);
            } else {
                item.topicId = RECYCLE_BIN_ID;
                await storage.db.put('items', item);
            }
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
        const topics = await storage.db.getAll('topics');
        const items = await storage.db.getAll('items');
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
    const topics = state.topics.filter(t => (t.parentId || "") === (parentId || ""));
    const items = state.items.filter(i => (i.topicId || "") === (parentId || ""));
    return topics.length + items.length;
}

async function addNewTopic(name, color = null, description = '', parentId = "") {
    const id = crypto.randomUUID();
    const order = getNextOrder(parentId);
    const topic = { id, name, order, description, parentId: parentId || "" };
    if (color) topic.color = color;
    
    await storage.db.add('topics', topic);
    await refreshState();
    renderContent();
}

async function updateTopic(id, name, color, description) {
    const tx = storage.db.transaction('topics', 'readwrite');
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

async function deleteTopic(id, forcePermanent = false) {
    const topic = state.topics.find(t => t.id === id);
    if (!topic) return;

    // Check if already in bin
    const inBin = topic.parentId === RECYCLE_BIN_ID;
    
    // Soft Delete (Move to Bin)
    if (!forcePermanent && !inBin) {
        if (confirm(`Move topic "${topic.name}" to Recycle Bin?`)) {
            const tx = storage.db.transaction('topics', 'readwrite');
            const t = await tx.store.get(id);
            if (t) {
                t.parentId = RECYCLE_BIN_ID;
                await tx.store.put(t);
            }
            await tx.done;
            await refreshState();
            renderContent();
        }
        return;
    }

    // Permanent Delete
    // Skip confirm if forced (assumed confirmed by caller like emptyRecycleBin)
    if (!forcePermanent && !confirm(`Permanently delete topic "${topic.name}"? This cannot be undone.`)) {
        return;
    }

    // Recursive delete
    const tx = storage.db.transaction(['topics', 'items'], 'readwrite');
    
    async function deleteRecursive(topicId, tx) {
        await tx.objectStore('topics').delete(topicId);
        
        // Delete Items
        const items = await tx.objectStore('items').index('topicId').getAllKeys(topicId);
        await Promise.all(items.map(itemId => tx.objectStore('items').delete(itemId)));
        
        // Find Sub-topics by querying the index directly (not stale in-memory state).
        const subTopics = await tx.objectStore('topics').index('parentId').getAll(topicId);
        for (const sub of subTopics) {
            await deleteRecursive(sub.id, tx);
        }
    }

    await deleteRecursive(id, tx);
    
    await tx.done;
    await refreshState();
    
    // Navigation logic
    if (currentTopicId === id || !state.topics.find(t => t.id === currentTopicId)) {
        if (currentTopicId === id) { 
             navigateToDashboard(); // Deleted what we are viewing
        } else {
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

async function addItemToTopic(type, content, title = '', color = null, comment = '') {
    // currentTopicId can be null (Root)
    const id = crypto.randomUUID();
    const order = getNextOrder(currentTopicId);
    
    const item = { 
        id, 
        topicId: currentTopicId, 
        type, 
        content, 
        title, 
        order,
        comment
    };
    
    if (color) {
        item.color = color;
    }
    
    await storage.db.add('items', item);
    await refreshState();
    renderContent();
}


function showEditTopicDialog(topicOrId) {
    let name = '';
    let description = '';
    let color = '#e60023';
    let title = '';

    if (topicOrId === 'root' || !topicOrId) {
        editingTopicId = 'root';
        name = state.root.name;
        description = state.root.description;
        title = 'Edit Dashboard';
    } else {
        const topic = typeof topicOrId === 'string' 
            ? (state.topics.find(t => t.id === topicOrId) || state.currentTopic) 
            : topicOrId;
            
        if (!topic) return;
        editingTopicId = topic.id;
        name = topic.name;
        description = topic.description || '';
        color = topic.color || '#e60023';
        title = 'Edit Topic';
    }

    document.querySelector('#dlg-topic h3').textContent = title;
    btnConfirmTopic.textContent = 'Save Changes';

    document.getElementById('topic-name-input').value = name;
    document.getElementById('topic-desc-input').value = description;
    
    const colorInput = document.querySelector(`input[name="topic-color"][value="${color}"]`);
    if (colorInput) colorInput.checked = true;

    dlgTopic.showModal();
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
        showEditTopicDialog(currentTopicId || 'root');
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
        await storage.db.put('settings', newRoot);
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
const btnConfirmNote = document.getElementById('btn-confirm-note');

document.getElementById('btn-add-note').onclick = () => {
    editingItem = null;
    document.querySelector('#dlg-note h3').textContent = 'Add a Note';
    btnConfirmNote.textContent = 'Add Note';
    
    document.getElementById('note-content-input').value = '';
    document.getElementById('note-comment-input').value = '';
    
    const yellow = document.querySelector('input[name="note-color"][value="#e7ed43"]');
    if (yellow) yellow.checked = true;
    
    dlgNote.showModal();
};

document.getElementById('btn-cancel-note').onclick = () => dlgNote.close();

dlgNote.onsubmit = async (e) => {
    const content = document.getElementById('note-content-input').value;
    const comment = document.getElementById('note-comment-input').value;
    const color = document.querySelector('input[name="note-color"]:checked').value;

    if (editingItem) {
        editingItem.content = content;
        editingItem.comment = comment;
        editingItem.color = color;
        
        await storage.db.put('items', editingItem);
        await refreshState();
        renderContent();
    } else {
        addItemToTopic('note', content, '', color, comment);
    }
    
    editingItem = null;
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

    // Ignore internal card reorder/nest drags — these carry our custom MIME type
    // and are handled (with stopPropagation) by handleDrop on the grid.
    if (e.dataTransfer.getData('application/minterest-id')) return;

    e.preventDefault();
    document.body.classList.remove('drag-over');

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

/**
 * Applies the selected theme (light or dark) to the application.
 * @param {boolean} isDark - Whether to apply the dark theme.
 * @param {boolean} [save=true] - Whether to persist the setting to storage.
 */
function applyTheme(isDark, save = true) {
    const body = document.body;
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    const sunIcon = btn.querySelector('.sun-icon');
    const moonIcon = btn.querySelector('.moon-icon');

    if (isDark) {
        body.classList.add('dark-mode');
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    } else {
        body.classList.remove('dark-mode');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    }

    if (save) {
        storage.putSetting('theme', { isDark });
    }
}

// --- Theme Toggle ---
document.getElementById('btn-theme-toggle').onclick = () => {
    const isDark = !document.body.classList.contains('dark-mode');
    applyTheme(isDark, true);
};

// --- Backup & Restore (Updated for IndexedDB) ---
document.getElementById('btn-export').onclick = async () => {
    const exportData = {
        topics: await storage.db.getAll('topics'),
        items: await storage.db.getAll('items')
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
                const mode = await promptRestoreMode();
                if (!mode) return;
                if (mode === 'replace') {
                    await replaceData(imported);
                } else {
                    await mergeData(imported);
                }
                await refreshState();
                navigateToDashboard();
                alert(mode === 'replace' ? 'Backup restored successfully!' : 'Backup merged successfully!');
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
    const topics = await storage.db.getAll('topics');
    const items = await storage.db.getAll('items');
    
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
            statusBox.textContent = 'Data received!';
            const mode = await promptRestoreMode();
            if (!mode) { statusBox.textContent = 'Cancelled.'; return; }
            if (mode === 'replace') {
                await replaceData(msg.payload);
            } else {
                await mergeData(msg.payload);
            }
            statusBox.textContent = 'Sync Successful! Reloading...';
            setTimeout(() => location.reload(), 1000);
        }
    });

    conn.on('error', (err) => {
         statusBox.textContent = 'Connection Error: ' + err;
    });
};

/**
 * Shows the restore-mode dialog and resolves with 'replace', 'merge', or null (cancelled).
 * @returns {Promise<'replace'|'merge'|null>}
 */
function promptRestoreMode() {
  return new Promise((resolve) => {
    const dlg = document.getElementById('dlg-restore-mode');
    const onReplace = () => { cleanup(); resolve('replace'); };
    const onMerge  = () => { cleanup(); resolve('merge'); };
    const onCancel = () => { cleanup(); resolve(null); };

    function cleanup() {
      document.getElementById('btn-restore-replace').removeEventListener('click', onReplace);
      document.getElementById('btn-restore-merge').removeEventListener('click', onMerge);
      document.getElementById('btn-restore-cancel').removeEventListener('click', onCancel);
      dlg.close();
    }

    document.getElementById('btn-restore-replace').addEventListener('click', onReplace);
    document.getElementById('btn-restore-merge').addEventListener('click', onMerge);
    document.getElementById('btn-restore-cancel').addEventListener('click', onCancel);
    dlg.showModal();
  });
}

/**
 * Replaces all local topics and items with data from a backup.
 * @param {Object} data - The data object containing topics and items arrays.
 */
async function replaceData(data) {
  await storage.clearAll();
  await mergeData(data);
}

/**
 * Merges data received from a peer during P2P sync into the local database.
 * Sanitizes IDs and handles nested items for compatibility.
 * @param {Object} data - The data object containing topics and items arrays.
 */
async function mergeData(data) {
    const tx = storage.db.transaction(['topics', 'items'], 'readwrite');

    for (const t of data.topics) {
        const { items: nestedItems, ...topicData } = t;
        
        // Sanitize parentId
        if (topicData.parentId === null || topicData.parentId === undefined) {
            topicData.parentId = "";
        }
        
        // Process nested items if they exist
        if (nestedItems && Array.isArray(nestedItems)) {
            for (const ni of nestedItems) {
                if (ni.topicId === null || ni.topicId === undefined) {
                    ni.topicId = topicData.id;
                }
                await tx.objectStore('items').put(ni);
            }
        }
        
        // IDB 'put' overwrites. Let's use it to ensure we get the latest version from the sender.
        // If we wanted "safe" merge, we'd use 'add' and ignore errors.
        await tx.objectStore('topics').put(topicData);
    }

    for (const i of data.items) {
        // Sanitize topicId
        if (i.topicId === null || i.topicId === undefined) {
            i.topicId = "";
        }
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
    renderColorSwatches(currentColor);
    
    // Set custom picker to current color (or white if none)
    const picker = document.getElementById('custom-color-input');
    picker.value = currentColor && currentColor.startsWith('#') ? currentColor : '#ffffff';
    
    // Uncheck radios if using custom picker interaction
    picker.oninput = () => {
        document.querySelectorAll('input[name="edit-color"]').forEach(r => r.checked = false);
    };

    dlgEditColor.showModal();
}

function renderColorSwatches(selectedColor) {
    const container = document.getElementById('color-swatches');
    container.innerHTML = '';
    
    // Combine defaults and user palette (unique)
    const allColors = [...new Set([...DEFAULT_PALETTE, ...state.userPalette])];
    
    allColors.forEach(color => {
        const label = document.createElement('label');
        label.className = 'color-option';
        
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'edit-color';
        input.value = color;
        if (color.toLowerCase() === (selectedColor || '').toLowerCase()) {
            input.checked = true;
        }
        
        // Update custom picker when swatch picked
        input.onclick = () => {
            document.getElementById('custom-color-input').value = color;
        };
        
        const span = document.createElement('span');
        span.className = 'color-swatch';
        span.style.backgroundColor = color;
        
        label.appendChild(input);
        label.appendChild(span);
        container.appendChild(label);
    });
}

document.getElementById('btn-save-color').onclick = async () => {
    const picker = document.getElementById('custom-color-input');
    const newColor = picker.value;
    
    // Add if not exists
    if (!state.userPalette.includes(newColor) && !DEFAULT_PALETTE.includes(newColor)) {
        state.userPalette.push(newColor);
        
        // Save to DB
        try {
            await storage.db.put('settings', { key: 'user_palette', colors: state.userPalette });
        } catch (e) {
            console.error("Failed to save palette:", e);
        }
        
        renderColorSwatches(newColor);
    }
};

document.getElementById('btn-cancel-edit-color').onclick = () => dlgEditColor.close();

dlgEditColor.onsubmit = async (e) => {
    if (!currentEditTarget) return;

    // Priority: Radio Selection -> Custom Input
    const radio = document.querySelector('input[name="edit-color"]:checked');
    const picker = document.getElementById('custom-color-input');
    
    const newColor = radio ? radio.value : picker.value;

    if (newColor) {
        const tx = storage.db.transaction([currentEditTarget.type === 'topic' ? 'topics' : 'items'], 'readwrite');
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

// --- Expiration Dialog Logic ---
const dlgExpiration = document.getElementById('dlg-expiration');
let expirationTarget = null; // { type: 'topic'|'item', id: '...' }

function showExpirationDialog(type, id, currentExpiry) {
    expirationTarget = { type, id };
    const input = document.getElementById('expiration-input');
    
    // Reset
    input.value = '';
    
    if (currentExpiry) {
        // datetime-local expects YYYY-MM-DDTHH:mm
        try {
            const date = new Date(currentExpiry);
            // offset timezone
            date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
            input.value = date.toISOString().slice(0, 16);
        } catch (e) {}
    }
    
    dlgExpiration.showModal();
}

document.getElementById('btn-cancel-expiration').onclick = () => dlgExpiration.close();

document.getElementById('btn-clear-expiration').onclick = async () => {
    if (!expirationTarget) return;
    await saveExpiration(null);
    dlgExpiration.close();
};

dlgExpiration.onsubmit = async (e) => {
    if (!expirationTarget) return;
    const input = document.getElementById('expiration-input');
    
    if (input.value) {
        const date = new Date(input.value);
        await saveExpiration(date.toISOString());
    }
    dlgExpiration.close();
};

async function saveExpiration(isoDateString) {
    const tx = storage.db.transaction([expirationTarget.type === 'topic' ? 'topics' : 'items'], 'readwrite');
    const store = tx.objectStore(expirationTarget.type === 'topic' ? 'topics' : 'items');
    
    const entity = await store.get(expirationTarget.id);
    if (entity) {
        if (isoDateString) {
            entity.expiresAt = isoDateString;
        } else {
            delete entity.expiresAt;
        }
        await store.put(entity);
        await tx.done;
        await refreshState();
        renderContent();
    }
}

// --- Remote Backup Logic ---
const dlgRemoteBackup = document.getElementById('dlg-remote-backup');
const btnRemoteBackup = document.getElementById('btn-remote-backup');
const btnCloseRemote = document.getElementById('btn-close-remote');
const btnRemoteRegister = document.getElementById('btn-remote-register');
const btnRemoteLogin = document.getElementById('btn-remote-login');
const btnRemotePush = document.getElementById('btn-remote-push');
const remoteStatus = document.getElementById('remote-status');
const remoteBackupsContainer = document.getElementById('remote-backups-container');
const remoteBackupsList = document.getElementById('remote-backups-list');

if (btnRemoteBackup) {
    btnRemoteBackup.onclick = () => {
        const storedUrl = localStorage.getItem('minterestd_url') || '';
        const storedUser = localStorage.getItem('minterestd_user') || '';
        document.getElementById('remote-server-url').value = storedUrl;
        document.getElementById('remote-username').value = storedUser;
        document.getElementById('remote-password').value = '';
        
        remoteStatus.classList.add('hidden');
        remoteBackupsContainer.classList.add('hidden');
        dlgRemoteBackup.showModal();
    };
}

if (btnCloseRemote) {
    btnCloseRemote.onclick = () => dlgRemoteBackup.close();
}

function getRemoteAuth() {
    const user = document.getElementById('remote-username').value;
    const pass = document.getElementById('remote-password').value;
    return 'Basic ' + btoa(user + ':' + pass);
}

function getRemoteUrl() {
    let url = document.getElementById('remote-server-url').value.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    localStorage.setItem('minterestd_url', url);
    localStorage.setItem('minterestd_user', document.getElementById('remote-username').value);
    return url;
}

function showRemoteStatus(msg, isError = false) {
    remoteStatus.textContent = msg;
    remoteStatus.classList.remove('hidden');
    remoteStatus.style.color = isError ? '#d9534f' : '#4cae4c';
}

if (btnRemoteRegister) {
    btnRemoteRegister.onclick = async () => {
        const url = getRemoteUrl();
        const user = document.getElementById('remote-username').value;
        const pass = document.getElementById('remote-password').value;
        
        if (!url || !user || !pass) return showRemoteStatus('Please fill all fields', true);
        
        try {
            showRemoteStatus('Registering...');
            const res = await fetch(`${url}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();
            if (res.ok) {
                showRemoteStatus('Registered successfully! You can now list backups.');
            } else {
                showRemoteStatus(data.error || 'Registration failed', true);
            }
        } catch (e) {
            showRemoteStatus('Connection error: ' + e.message, true);
        }
    };
}

if (btnRemoteLogin) {
    btnRemoteLogin.onclick = async () => {
        const url = getRemoteUrl();
        if (!url) return showRemoteStatus('Please provide server URL', true);
        
        try {
            showRemoteStatus('Fetching backups...');
            const res = await fetch(`${url}/api/backups`, {
                headers: { 'Authorization': getRemoteAuth() }
            });
            
            if (res.status === 401) {
                return showRemoteStatus('Invalid credentials', true);
            }
            
            const backups = await res.json();
            if (res.ok) {
                showRemoteStatus('');
                remoteStatus.classList.add('hidden');
                renderRemoteBackups(backups);
            } else {
                showRemoteStatus(backups.error || 'Failed to list backups', true);
            }
        } catch (e) {
            showRemoteStatus('Connection error: ' + e.message, true);
        }
    };
}

function renderRemoteBackups(backups) {
    remoteBackupsContainer.classList.remove('hidden');
    remoteBackupsList.innerHTML = '';
    
    if (backups.length === 0) {
        remoteBackupsList.innerHTML = '<li style="padding:0.5rem; text-align:center; color:#666;">No backups found</li>';
        return;
    }
    
    backups.forEach(b => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '0.5rem 0';
        li.style.borderBottom = '1px solid #eee';
        
        const date = new Date(b.timestamp).toLocaleString();
        
        li.innerHTML = `
            <span style="font-size:0.9rem;">${date}</span>
            <div>
                <button class="btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.8rem;" onclick="restoreRemoteBackup(${b.id})">Restore</button>
                <button class="btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.8rem; color:#d9534f;" onclick="deleteRemoteBackup(${b.id})">Delete</button>
            </div>
        `;
        remoteBackupsList.appendChild(li);
    });
}

if (btnRemotePush) {
    btnRemotePush.onclick = async () => {
        const url = getRemoteUrl();
        if (!confirm('Create a new remote backup of your current data?')) return;
        
        try {
            showRemoteStatus('Creating backup...');
            const exportData = {
                topics: await storage.db.getAll('topics'),
                items: await storage.db.getAll('items')
            };
            
            const res = await fetch(`${url}/api/backups`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': getRemoteAuth()
                },
                body: JSON.stringify(exportData)
            });
            
            const data = await res.json();
            if (res.ok) {
                showRemoteStatus('Backup successful!');
                btnRemoteLogin.click(); // Refresh list
            } else {
                showRemoteStatus(data.error || 'Backup failed', true);
            }
        } catch (e) {
            showRemoteStatus('Connection error: ' + e.message, true);
        }
    };
}

window.restoreRemoteBackup = async (id) => {
    const mode = await promptRestoreMode();
    if (!mode) return;

    const url = getRemoteUrl();
    try {
        showRemoteStatus('Fetching backup...');
        const res = await fetch(`${url}/api/backups/${id}`, {
            headers: { 'Authorization': getRemoteAuth() }
        });

        if (!res.ok) {
            const data = await res.json();
            return showRemoteStatus(data.error || 'Fetch failed', true);
        }

        const imported = await res.json();
        if (imported.topics && imported.items) {
            if (mode === 'replace') {
                await replaceData(imported);
            } else {
                await mergeData(imported);
            }
            showRemoteStatus((mode === 'replace' ? 'Restored' : 'Merged') + ' successfully! Reloading...');
            setTimeout(() => location.reload(), 1000);
        } else {
            showRemoteStatus('Invalid backup format', true);
        }
    } catch (e) {
        showRemoteStatus('Connection error: ' + e.message, true);
    }
};

window.deleteRemoteBackup = async (id) => {
    if (!confirm('Delete this remote backup?')) return;
    
    const url = getRemoteUrl();
    try {
        showRemoteStatus('Deleting...');
        const res = await fetch(`${url}/api/backups/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': getRemoteAuth() }
        });
        
        if (!res.ok) {
             const data = await res.json();
             return showRemoteStatus(data.error || 'Delete failed', true);
        }
        
        showRemoteStatus('Deleted successfully');
        btnRemoteLogin.click(); // Refresh list
    } catch (e) {
        showRemoteStatus('Connection error: ' + e.message, true);
    }
};
