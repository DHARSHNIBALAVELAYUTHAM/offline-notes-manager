/**
 * Offline Notes Manager - Interview Assessment Solution
 * IndexedDB-based notes application with full CRUD, search, filtering, and export
 */


// DATABASE INITIALIZATION & SCHEMA DESIGN

let db;
let currentNoteId = null;
let autoSaveTimeout;

const DB_CONFIG = {
    name: "OfflineNotesDB",
    version: 2,
    store: "notes"
};

const dbRequest = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

/*DATABASE UPGRADE (SAFE)*/
dbRequest.onupgradeneeded = (event) => {
    db = event.target.result;

    let store;

    if (!db.objectStoreNames.contains(DB_CONFIG.store)) {
        store = db.createObjectStore(DB_CONFIG.store, {
            keyPath: "id",
            autoIncrement: true
        });
    } else {
        store = event.target.transaction.objectStore(DB_CONFIG.store);
    }

    const indexes = [
        "title",
        "tags",
        "content",
        "createdAt",
        "updatedAt",
        "isDeleted"
    ];

    indexes.forEach(index => {
        if (!store.indexNames.contains(index)) {
            store.createIndex(index, index, { unique: false });
        }
    });
};

dbRequest.onsuccess = () => {
    db = dbRequest.result;
    initializeApp();
};

dbRequest.onerror = () => {
    alert("Database failed to load");
};

/*DOM*/
const DOM = {
    title: document.getElementById("title"),
    tags: document.getElementById("tags"),
    content: document.getElementById("content"),
    tagsDisplay: document.getElementById("tagsDisplay"),
    metaInfo: document.getElementById("metaInfo"),

    notesList: document.getElementById("notesList"),
    emptyState: document.getElementById("emptyState"),
    emptyEditor: document.getElementById("emptyEditor"),
    editorContent: document.getElementById("editorContent"),
    status: document.getElementById("status"),

    saveBtn: document.getElementById("saveBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    newBtn: document.getElementById("newBtn"),
    exportBtn: document.getElementById("exportBtn"),
    darkModeBtn: document.getElementById("darkModeBtn"),

    search: document.getElementById("search"),
    sortBy: document.getElementById("sortBy"),
    tagFilter: document.getElementById("tagFilter"),
    notesCount: document.getElementById("notesCount")
};

/*INIT*/
function initializeApp() {
    attachEvents();
    loadNotes();
    loadDarkMode();
}

function attachEvents() {
    DOM.newBtn.onclick = createNewNote;
    DOM.saveBtn.onclick = saveNote;
    DOM.deleteBtn.onclick = deleteNote;
    DOM.exportBtn.onclick = exportJSON;
    DOM.darkModeBtn.onclick = toggleDarkMode;

    DOM.search.oninput = loadNotes;
    DOM.sortBy.onchange = loadNotes;
    DOM.tagFilter.onchange = loadNotes;

    DOM.title.oninput = debounceSave;
    DOM.tags.oninput = debounceSave;
    DOM.content.oninput = debounceSave;

    DOM.tags.onblur = renderTags;
}

/*CREATE NEW*/
function createNewNote() {
    currentNoteId = null;
    clearEditor();
    showEditor();
    DOM.title.focus();
}

/*SAVE NOTE (FIXED)*/
function saveNote() {
    const title = DOM.title.value.trim();

    if (!title) {
        showStatus("Enter title", "error");
        return;
    }

    const tx = db.transaction(DB_CONFIG.store, "readwrite");
    const store = tx.objectStore(DB_CONFIG.store);

    const now = Date.now();

    if (currentNoteId) {
        const getReq = store.get(currentNoteId);

        getReq.onsuccess = () => {
            const old = getReq.result;

            const note = {
                id: currentNoteId,
                title: title,
                tags: DOM.tags.value.trim(),
                content: DOM.content.value.trim(),
                createdAt: old.createdAt,
                updatedAt: now,
                isDeleted: false
            };

            store.put(note);
            loadNotes();
            updateMeta();
            showStatus("Updated", "success");
        };

    } else {
        const note = {
            title: title,
            tags: DOM.tags.value.trim(),
            content: DOM.content.value.trim(),
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        };

        const req = store.put(note);

        req.onsuccess = () => {
            currentNoteId = req.result;
            loadNotes();
            updateMeta();
            showStatus("Saved", "success");
        };
    }
}

/*LOAD NOTES */
function loadNotes() {
    const tx = db.transaction(DB_CONFIG.store, "readonly");
    const store = tx.objectStore(DB_CONFIG.store);
    const req = store.getAll();

    req.onsuccess = () => {
        let notes = req.result.filter(n => !n.isDeleted);

        const key = DOM.search.value.toLowerCase();

        if (key) {
            notes = notes.filter(n =>
                n.title.toLowerCase().includes(key) ||
                n.content.toLowerCase().includes(key) ||
                n.tags.toLowerCase().includes(key)
            );
        }

        const tag = DOM.tagFilter.value;
        if (tag) {
            notes = notes.filter(n => n.tags.includes(tag));
        }

        notes = sortNotes(notes);
        renderList(notes);
        renderTagFilter(notes);

        DOM.notesCount.textContent = notes.length;
    };
}

/*SORT*/
function sortNotes(notes) {
    const val = DOM.sortBy.value;

    const map = {
        "updated-desc": (a,b)=>b.updatedAt-a.updatedAt,
        "updated-asc": (a,b)=>a.updatedAt-b.updatedAt,
        "created-desc": (a,b)=>b.createdAt-a.createdAt,
        "created-asc": (a,b)=>a.createdAt-b.createdAt
    };

    return notes.sort(map[val]);
}

/*RENDER NOTES*/
function renderList(notes) {
    DOM.notesList.innerHTML = "";

    if (!notes.length) {
        DOM.emptyState.style.display = "block";
        return;
    }

    DOM.emptyState.style.display = "none";

    notes.forEach(note => {
        const div = document.createElement("div");
        div.className = "note-card";

        if (note.id === currentNoteId) {
            div.classList.add("active");
        }

        div.innerHTML = `
            <div class="note-card-header">
                <h4>${escapeHtml(note.title)}</h4>
                <span>${formatDate(note.updatedAt)}</span>
            </div>
            <p>${escapeHtml(note.content.slice(0,50))}</p>
        `;

        div.onclick = () => openNote(note);
        DOM.notesList.appendChild(div);
    });
}

/*OPEN NOTE (FIXED)*/
function openNote(note) {
    currentNoteId = note.id;

    DOM.title.value = note.title;
    DOM.tags.value = note.tags;
    DOM.content.value = note.content;

    renderTags();
    showEditor();
    loadNotes();
    updateMeta();
}

/*DELETE*/
function deleteNote() {
    if (!currentNoteId) return;

    if (!confirm("Delete note?")) return;

    const tx = db.transaction(DB_CONFIG.store, "readwrite");
    const store = tx.objectStore(DB_CONFIG.store);

    const req = store.get(currentNoteId);

    req.onsuccess = () => {
        const note = req.result;
        note.isDeleted = true;
        store.put(note);

        currentNoteId = null;
        clearEditor();
        loadNotes();
        showEmpty();
        showStatus("Deleted", "success");
    };
}

/*TAG FILTER*/
function renderTagFilter(notes) {
    const set = new Set();

    notes.forEach(n => {
        n.tags.split(",").forEach(tag => {
            if (tag.trim()) set.add(tag.trim());
        });
    });

    const current = DOM.tagFilter.value;

    DOM.tagFilter.innerHTML =
        `<option value="">All Tags</option>`;

    [...set].sort().forEach(tag => {
        DOM.tagFilter.innerHTML +=
        `<option value="${tag}">${tag}</option>`;
    });

    DOM.tagFilter.value = current;
}

/*TAG BADGES*/
function renderTags() {
    const arr = DOM.tags.value
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

    DOM.tagsDisplay.innerHTML =
        arr.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join("");
}

/*EXPORT JSON*/
function exportJSON() {
    const tx = db.transaction(DB_CONFIG.store, "readonly");
    const store = tx.objectStore(DB_CONFIG.store);
    const req = store.getAll();

    req.onsuccess = () => {
        const data = req.result.filter(n => !n.isDeleted);

        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: "application/json" }
        );

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "notes.json";
        a.click();
    };
}

/*DARK MODE*/
function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem(
        "darkMode",
        document.body.classList.contains("dark-mode")
    );
    loadDarkMode();
}

function loadDarkMode() {
    const dark = localStorage.getItem("darkMode") === "true";

    if (dark) document.body.classList.add("dark-mode");
    else document.body.classList.remove("dark-mode");

    DOM.darkModeBtn.textContent = dark ? "☀️" : "🌙";
}

/*AUTO SAVE*/
function debounceSave() {
    clearTimeout(autoSaveTimeout);

    autoSaveTimeout = setTimeout(() => {
        if (currentNoteId) saveNote();
    }, 1000);
}

/*HELPERS*/
function showEditor() {
    DOM.emptyEditor.style.display = "none";
    DOM.editorContent.style.display = "block";
}

function showEmpty() {
    DOM.emptyEditor.style.display = "flex";
    DOM.editorContent.style.display = "none";
}

function clearEditor() {
    DOM.title.value = "";
    DOM.tags.value = "";
    DOM.content.value = "";
    DOM.tagsDisplay.innerHTML = "";
    DOM.metaInfo.textContent = "";
}

function showStatus(msg, type) {
    DOM.status.textContent = msg;
    DOM.status.className = "status-message " + type;
}

function updateMeta() {
    if (!currentNoteId) return;

    const tx = db.transaction(DB_CONFIG.store, "readonly");
    const store = tx.objectStore(DB_CONFIG.store);
    const req = store.get(currentNoteId);

    req.onsuccess = () => {
        const note = req.result;

        DOM.metaInfo.textContent =
            "Created: " +
            new Date(note.createdAt).toLocaleString() +
            " | Modified: " +
            new Date(note.updatedAt).toLocaleString();
    };
}

function formatDate(ts) {
    return new Date(ts).toLocaleDateString();
}

function escapeHtml(text) {
    text = String(text || "");

    const map = {
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
    };

    return text.replace(/[&<>"']/g, m => map[m]);
}







