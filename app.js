import Sortable from 'https://esm.sh/sortablejs@1.15.0';

// --- State & Storage ---
const STORAGE_KEY = 'minterest_data';

let state = {
    topics: []
};

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            state = JSON.parse(saved);
        } catch (e) {
            console.error("Failed to parse storage", e);
        }
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- Navigation ---
let currentTopicId = null;

function navigateToDashboard() {
    currentTopicId = null;
    window.location.hash = ''; // Clear hash
    updateView();
}

function navigateToBoard(topicId) {
    window.location.hash = `topic/${topicId}`; // Set hash
}

function updateView() {
    const hash = window.location.hash.substring(1); // Remove '#'
    
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
        delBtn.className = 'card-delete';
        delBtn.innerHTML = '🗑️';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete topic "${topic.name}"? This will delete all items inside.`)) {
                state.topics = state.topics.filter(t => t.id !== topic.id);
                saveState();
                renderTopics();
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

    // Sort by order property
    const sortedItems = [...topic.items].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedItems.forEach(item => {
        const card = createItemCard(item);
        grid.appendChild(card);
    });

    initSortable();
}

// --- Helpers ---
function getCardColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function getPastelColor(str) {
    // Generate a consistent pastel color from a string
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
        contentHtml = `
            <div class="card-content">
                <div class="card-title">${item.content}</div>
                ${item.comment ? `<div class="card-comment">${item.comment}</div>` : ''}
            </div>`;
    }

    card.innerHTML = `
        ${contentHtml}
        <div class="card-actions">
            <button class="card-btn btn-edit" title="Edit Comment">✏️</button>
            <button class="card-btn btn-delete" title="Delete Item">🗑️</button>
        </div>
    `;

    // Edit Comment Action
    card.querySelector('.btn-edit').onclick = (e) => {
        e.stopPropagation(); // Prevent drag interference if necessary
        const newComment = prompt("Add a comment:", item.comment || "");
        if (newComment !== null) {
            const topic = state.topics.find(t => t.id === currentTopicId);
            const targetItem = topic.items.find(i => i.id === item.id);
            targetItem.comment = newComment;
            saveState();
            renderItems();
        }
    };

    // Delete Action
    card.querySelector('.btn-delete').onclick = () => {
        const topic = state.topics.find(t => t.id === currentTopicId);
        topic.items = topic.items.filter(i => i.id !== item.id);
        saveState();
        renderItems();
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
        onEnd: () => {
            const topic = state.topics.find(t => t.id === currentTopicId);
            if (!topic) return;
            
            // Get IDs in new DOM order
            const itemEls = Array.from(grid.querySelectorAll('.card'));
            const newOrderIds = itemEls.map(el => el.dataset.id);
            
            // Update the order property for each item in the state
            topic.items.forEach(item => {
                const newIndex = newOrderIds.indexOf(item.id.toString());
                if (newIndex !== -1) {
                    item.order = newIndex;
                }
            });
            
            saveState();
        }
    });
}

// --- Interaction Logic ---
function addNewTopic(name) {
    const id = crypto.randomUUID();
    state.topics.push({ id, name, items: [] });
    saveState();
    renderTopics();
}

function addItemToTopic(type, content, title = '') {
    if (!currentTopicId) return;
    const topic = state.topics.find(t => t.id === currentTopicId);
    const id = crypto.randomUUID();
    topic.items.push({ id, type, content, title, order: topic.items.length });
    saveState();
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
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (currentTopicId) document.body.classList.add('drag-over');
});

window.addEventListener('dragleave', () => {
    document.body.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    if (!currentTopicId) return;

    const items = e.dataTransfer.items;
    for (let item of items) {
        if (item.kind === 'string' && item.type === 'text/uri-list') {
            const url = e.dataTransfer.getData('URL');
            if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
                addItemToTopic('image', url);
            } else {
                addItemToTopic('link', url);
            }
        } else if (item.kind === 'string' && item.type === 'text/plain') {
            const text = e.dataTransfer.getData('text/plain');
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
});

// --- Backup & Restore ---
document.getElementById('btn-export').onclick = () => {
    const dataStr = JSON.stringify(state, null, 2);
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
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (imported.topics) {
                state = imported;
                saveState();
                navigateToDashboard();
                alert("Backup restored successfully!");
            }
        } catch (err) {
            alert("Invalid backup file.");
        }
    };
    reader.readAsText(file);
};

// --- Init ---
loadState();
updateView();
