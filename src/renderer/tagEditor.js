let tagEditorCurrentPath = '';
let tagEditorCurrentTags = [];
let tagEditorIsFavorite = false;
let currentOnSaveSuccess = null;
let libraryKnownTags = [];


const PALETTE = [
    '#38bdf8', '#818cf8', '#a855f7', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#10b981', '#06b6d4', '#14b8a6'
];

export function getTagColor(tagName, categories = []) {
    if (categories && categories.length > 0) {
        for (const cat of categories) {
            if (cat.tags && cat.tags.includes(tagName)) return cat.color;
        }
    }
    let hash = 0;
    for (let i = 0; i < tagName.length; i++) {
        hash = (hash << 5) - hash + tagName.charCodeAt(i);
        hash |= 0;
    }
    return PALETTE[Math.abs(hash) % PALETTE.length];
}

export async function openTagEditorModal(filePath, tags = [], isFavorite = false, options = {}) {
    const { onSaveSuccess = null, existingTags = [] } = (options || {});
    currentOnSaveSuccess = onSaveSuccess;

    if (Array.isArray(existingTags) && existingTags.length > 0) {
        libraryKnownTags = existingTags;
    } else {
        try {
            const videos = await window.electronAPI.getLibraryVideos();
            const tagSet = new Set();
            (videos || []).forEach(v => {
                if (v.metadata && Array.isArray(v.metadata.tags)) {
                    v.metadata.tags.forEach(t => {
                        if (t && typeof t === 'string') tagSet.add(t.trim());
                    });
                }
            });
            libraryKnownTags = Array.from(tagSet);
        } catch (e) {
            libraryKnownTags = [];
        }
    }

    tagEditorCurrentPath = filePath;
    tagEditorCurrentTags = [...(tags || [])];
    tagEditorIsFavorite = !!isFavorite;

    const pathInput = document.getElementById('tagEditorFilePath');
    const favCheckbox = document.getElementById('tagEditorFavorite');
    const backdrop = document.getElementById('tagEditorBackdrop');
    const input = document.getElementById('tagEditorInput');
    const fileBadge = document.getElementById('tagEditorFileBadge');

    if (pathInput) pathInput.value = filePath;
    if (favCheckbox) favCheckbox.checked = tagEditorIsFavorite;
    
    if (fileBadge) {
        const fileName = filePath.split(/[\\/]/).pop();
        fileBadge.textContent = fileName || '';
        fileBadge.title = filePath;
    }

    renderCurrentTags();
    renderTagSuggestions();

    if (backdrop) backdrop.classList.remove('hidden');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
    }

    setupTagEditorListeners();
}

export function closeTagEditorModal() {
    const backdrop = document.getElementById('tagEditorBackdrop');
    if (backdrop) backdrop.classList.add('hidden');
}

function addTagFromInput() {
    const input = document.getElementById('tagEditorInput');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    // Support comma or semicolon separated tags
    const parts = raw.split(/[,;]+/).map(t => t.trim()).filter(t => t.length > 0);
    let changed = false;

    parts.forEach(t => {
        const normalized = t.replace(/^#/, '');
        if (normalized && !tagEditorCurrentTags.includes(normalized)) {
            tagEditorCurrentTags.push(normalized);
            changed = true;
        }
    });

    if (changed) {
        input.value = '';
        renderCurrentTags();
        renderTagSuggestions();
    }
}

async function saveAndClose() {
    const favCheckbox = document.getElementById('tagEditorFavorite');
    const isFav = favCheckbox ? favCheckbox.checked : tagEditorIsFavorite;

    // Also include any pending text in input
    addTagFromInput();

    const saveBtn = document.getElementById('saveTagsBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando...';
    }

    try {
        const result = await window.electronAPI.updateRecordingTags({
            filePath: tagEditorCurrentPath,
            tags: tagEditorCurrentTags,
            favorite: isFav
        });

        if (result && result.success) {
            closeTagEditorModal();
            if (typeof currentOnSaveSuccess === 'function') {
                currentOnSaveSuccess({
                    filePath: tagEditorCurrentPath,
                    tags: tagEditorCurrentTags,
                    favorite: isFav
                });
            }
        } else {
            alert('Erro ao salvar tags: ' + (result?.error || 'Erro desconhecido'));
        }
    } catch (err) {
        console.error('Erro ao atualizar tags:', err);
        alert('Erro ao salvar tags: ' + err.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salvar Tags';
        }
    }
}

let listenersInitialized = false;

function setupTagEditorListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    const closeBtn = document.getElementById('closeTagEditorBtn');
    const backdrop = document.getElementById('tagEditorBackdrop');
    const saveBtn = document.getElementById('saveTagsBtn');
    const input = document.getElementById('tagEditorInput');
    const addBtn = document.getElementById('addTagInputBtn');

    if (closeBtn) closeBtn.onclick = () => closeTagEditorModal();
    
    if (backdrop) {
        backdrop.onclick = (e) => {
            if (e.target === backdrop) closeTagEditorModal();
        };
    }

    if (addBtn) {
        addBtn.onclick = () => {
            addTagFromInput();
            if (input) input.focus();
        };
    }

    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.ctrlKey || input.value.trim() === '') {
                    saveAndClose();
                } else {
                    addTagFromInput();
                }
            } else if (e.key === ',') {
                e.preventDefault();
                addTagFromInput();
            } else if (e.key === 'Escape') {
                closeTagEditorModal();
            }
        };
    }

    if (saveBtn) {
        saveBtn.onclick = () => saveAndClose();
    }
}

async function renderCurrentTags() {
    const container = document.getElementById('tagEditorCurrentTags');
    if (!container) return;

    if (tagEditorCurrentTags.length === 0) {
        container.innerHTML = '<span class="help-text" style="opacity:0.6; font-size:0.8rem;">Nenhuma tag vinculada ainda. Digite ou clique nas sugestões abaixo.</span>';
        return;
    }

    const categories = await window.electronAPI.getTagCategories();
    container.innerHTML = tagEditorCurrentTags.map(tag => {
        const color = getTagColor(tag, categories);
        return `
            <span class="tag-badge tag-removable" style="background-color: ${color}22; color: ${color}; border: 1px solid ${color}55;" title="Clique para remover">
                <span>#${tag}</span>
                <span class="tag-remove-icon">&times;</span>
            </span>
        `;
    }).join('');

    container.querySelectorAll('.tag-removable').forEach((el, index) => {
        el.onclick = () => {
            tagEditorCurrentTags.splice(index, 1);
            renderCurrentTags();
            renderTagSuggestions();
        };
    });
}

async function renderTagSuggestions() {
    const container = document.getElementById('tagEditorSuggestions');
    if (!container) return;

    const categories = await window.electronAPI.getTagCategories();
    const suggestionsMap = new Map();

    // Sugerir APENAS tags que já foram inseridas anteriormente em outros vídeos
    if (Array.isArray(libraryKnownTags)) {
        for (const tag of libraryKnownTags) {
            if (!tagEditorCurrentTags.includes(tag) && !suggestionsMap.has(tag)) {
                suggestionsMap.set(tag, { tag, color: getTagColor(tag, categories) });
            }
        }
    }

    const suggestions = Array.from(suggestionsMap.values());

    if (suggestions.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="tag-suggestions-header">
            <span>💡 Sugestões de vídeos anteriores (clique para adicionar):</span>
        </div>
        <div class="tag-suggestions-chips">
            ${suggestions.map(s => `
                <button type="button" class="tag-badge tag-suggestion" style="background-color: ${s.color}18; color: ${s.color}; border: 1px solid ${s.color}44;" title="Adicionar #${s.tag}">
                    + #${s.tag}
                </button>
            `).join('')}
        </div>
    `;

    container.querySelectorAll('.tag-suggestion').forEach((el, index) => {
        el.onclick = () => {
            const selected = suggestions[index];
            if (selected && !tagEditorCurrentTags.includes(selected.tag)) {
                tagEditorCurrentTags.push(selected.tag);
                renderCurrentTags();
                renderTagSuggestions();
            }
        };
    });
}
